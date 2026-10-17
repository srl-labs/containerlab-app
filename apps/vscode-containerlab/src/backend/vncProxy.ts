import * as http from "http";

import type { LabBackend } from "@srl-labs/containerlab-lab-backend";
import WebSocket, { WebSocketServer, type RawData } from "ws";

const SKIPPED_REQUEST_HEADERS = new Set([
  "host",
  "authorization",
  "content-length",
  "connection",
  "upgrade"
]);
// The backend hands over the decoded body, so its length and encoding change.
const SKIPPED_RESPONSE_HEADERS = new Set([
  "transfer-encoding",
  "connection",
  "content-encoding",
  "content-length"
]);

function requestHeaders(request: http.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string" && !SKIPPED_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers[key] = value;
    }
  }
  return headers;
}

function rawBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}

function closeCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1011;
}

export interface VncProxy {
  /** `http://127.0.0.1:<port>/`, the session's noVNC page. */
  url: string;
  close(): void;
}

/**
 * Serves one Wireshark VNC session of a lab host on a local port, so the
 * webview loads noVNC from a plain local URL while the backend adds the
 * credentials. WebSocket upgrades are bridged the same way.
 */
export async function startVncProxy(backend: LabBackend, sessionId: string): Promise<VncProxy> {
  const sockets = new Set<WebSocket>();
  const server = http.createServer((request, response) => {
    backend
      .fetchWiresharkVnc(sessionId, {
        method: request.method ?? "GET",
        path: request.url ?? "/",
        headers: requestHeaders(request)
      })
      .then((upstream) => {
        const headers: Record<string, string> = {};
        for (const [key, value] of upstream.headers) {
          if (!SKIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) headers[key] = value;
        }
        headers["content-length"] = String(upstream.body.byteLength);
        response.writeHead(upstream.status, headers);
        response.end(Buffer.from(upstream.body));
      })
      .catch((error: unknown) => {
        response.writeHead(502, { "content-type": "text/plain" });
        response.end(error instanceof Error ? error.message : String(error));
      });
  });

  const webSockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const protocols = (request.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const upstream = backend.connectWiresharkVnc(sessionId, request.url ?? "/websockify", {
      protocols
    });
    webSockets.handleUpgrade(request, socket, head, (client) => {
      sockets.add(client);
      const pending: Array<[Uint8Array | string, boolean]> = [];
      let open = false;
      upstream.onOpen(() => {
        open = true;
        for (const [data, isBinary] of pending.splice(0)) upstream.send(data, isBinary);
      });
      client.on("message", (data: RawData, isBinary: boolean) => {
        const payload = isBinary ? rawBytes(data) : String(data);
        if (open) upstream.send(payload, isBinary);
        else pending.push([payload, isBinary]);
      });
      upstream.onMessage((data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
      });
      upstream.onClose((code, reason) => {
        if (client.readyState === WebSocket.OPEN) client.close(closeCode(code), reason);
      });
      upstream.onError(() => {
        if (client.readyState === WebSocket.OPEN) client.close(1011, "VNC connection failed");
      });
      client.on("close", () => {
        sockets.delete(client);
        upstream.close(1000, "Client closed");
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => {
      for (const socket of sockets) socket.terminate();
      webSockets.close();
      server.close();
      server.closeAllConnections();
    }
  };
}
