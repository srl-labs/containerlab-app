import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { WebSocketServer } from "ws";

import { errorStatus } from "@srl-labs/containerlab-lab-backend";
import { LocalLabBackend } from "@srl-labs/containerlab-lab-backend/local";

import {
  enhancedPacketBlock,
  icmpEchoFrame,
  interfaceDescriptionBlock,
  sectionHeaderBlock
} from "./pcapng";

export interface FakeClabApiServer {
  url: string;
  token: string;
  close(): Promise<void>;
}

async function readBody(request: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function sendJson(response: http.ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

/**
 * The workspace and topology file routes of clab-api-server, served from a
 * local folder. Enough to run the file part of the lab backend contract
 * through `ApiLabBackend` and its HTTP client.
 */
/** What the fake server says about itself on `/health`. */
export interface FakeClabApiServerHealth {
  /** Left out, like a server older than c9s support; `docker` by default. */
  runtime?: "docker" | "podman" | "c9s" | null;
  namespaceMode?: "per-lab" | "fixed";
  features?: string[];
  /**
   * What `GET /api/v1/lab-host` adds for a c9s server, served when `features`
   * lists `lab-host-info`; these defaults otherwise.
   */
  c9s?: Partial<FakeServerC9sHost>;
}

/** The c9s part of `GET /api/v1/lab-host`. */
interface FakeServerC9sHost {
  context: string;
  cluster: string;
  namespacePattern: string;
  sharedNamespacePattern: string;
  exposeType: string;
  persistence: boolean;
  imagePullSecret: string;
  labQuota: boolean;
  metrics: boolean;
}

const FAKE_SERVER_C9S_HOST: FakeServerC9sHost = {
  context: "c9s-provisioner",
  cluster: "c9s",
  namespacePattern: "c9s-alice-{lab}",
  sharedNamespacePattern: "c9s-shared-{lab}",
  exposeType: "None",
  persistence: true,
  imagePullSecret: "",
  labQuota: false,
  metrics: false
};

/**
 * A running c9s lab the fake captures on when `/health` lists
 * `capture-stream`: nodes n1 and n2, linked n1:eth1 to n2:eth1, pinging.
 */
export const FAKE_CAPTURE_LAB = "capture-lab";

const CAPTURE_INTERFACES = [
  { node: "n1", interface: "eth1", peerNode: "n2", peerInterface: "eth1" },
  { node: "n2", interface: "eth1", peerNode: "n1", peerInterface: "eth1" }
];

const TICKET_TTL_MS = 60_000;

interface CaptureRequest {
  targets: string[];
  durationMs?: number;
  packetLimit?: number;
}

/** Go durations the fake understands: whole `ms`, `s` and `m`. */
function parseDuration(value: string | null | undefined): number | undefined | "invalid" {
  if (value === null || value === undefined || value === "") return undefined;
  const match = /^(\d+)(ms|s|m)$/.exec(value);
  if (!match || Number(match[1]) === 0) return "invalid";
  return Number(match[1]) * { ms: 1, s: 1000, m: 60_000 }[match[2] as "ms" | "s" | "m"];
}

/** The targets as `<node>:<interface>`, or an error message naming the capturable ones. */
function checkTargets(targets: string[]): string | undefined {
  if (targets.length === 0) return "at least one target is required";
  const known = CAPTURE_INTERFACES.map((entry) => `${entry.node}:${entry.interface}`);
  const unknown = targets.find((target) => !known.includes(target));
  if (unknown) return `${unknown} is not capturable; capturable: ${known.join(", ")}`;
  if (new Set(targets).size !== targets.length) return "duplicate target";
  return undefined;
}

/**
 * Writes the capture like clab-api-server: one pcapng section, one interface
 * per target, then a ping on the link every 50 ms until the duration or
 * packet limit, or until `signal` aborts.
 */
async function writeCapture(
  request: CaptureRequest,
  write: (data: Uint8Array) => Promise<void> | void,
  signal: AbortSignal
): Promise<void> {
  await write(sectionHeaderBlock("containerlab"));
  for (const target of request.targets) await write(interfaceDescriptionBlock(target));
  const deadline = request.durationMs !== undefined ? Date.now() + request.durationMs : Infinity;
  let packets = 0;
  for (let sequence = 0; !signal.aborted && Date.now() < deadline; sequence += 1) {
    for (const [id] of request.targets.entries()) {
      for (const reply of [false, true]) {
        if (request.packetLimit !== undefined && packets >= request.packetLimit) return;
        const now = BigInt(Date.now()) * 1_000_000n;
        await write(enhancedPacketBlock(id, now, icmpEchoFrame(sequence, reply)));
        packets += 1;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function startFakeClabApiServer(
  workspaceRoot: string,
  health: FakeClabApiServerHealth = {}
): Promise<FakeClabApiServer> {
  const local = new LocalLabBackend({ workspaceRoot });
  const token = "contract-token";
  const watchers = new Set<AbortController>();
  const captureEnabled = (health.features ?? []).includes("capture-stream");
  /** Tickets by their SHA-256, like the server keeps them. */
  const tickets = new Map<string, { targets: string[]; expiresAt: number; durationMs?: number }>();
  const hashTicket = (ticket: string) => createHash("sha256").update(ticket).digest("hex");
  /** The valid ticket of a Packetflix path, used up on the way. */
  const ticketFromPath = (pathname: string, redeem = false) => {
    const match = /^\/api\/v1\/capture\/packetflix\/([^/]+)(?:\/capture)?$/.exec(pathname);
    if (!match) return undefined;
    const key = hashTicket(match[1]);
    const ticket = tickets.get(key);
    if (!ticket || ticket.expiresAt < Date.now()) return undefined;
    if (redeem) tickets.delete(key);
    return ticket;
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://fake");
      const query = (key: string) => url.searchParams.get(key) ?? "";
      if (request.method === "GET" && url.pathname === "/health") {
        // Public, like clab-api-server's: the runtime and the optional features.
        const runtime = health.runtime === undefined ? "docker" : health.runtime;
        sendJson(response, 200, {
          status: "healthy",
          features: health.features ?? [],
          ...(runtime !== null ? { runtime } : {}),
          ...(health.namespaceMode ? { namespaceMode: health.namespaceMode } : {})
        });
        return;
      }
      const discover = /^\/api\/v1\/capture\/packetflix\/([^/]+)\/discover\/mobyshark$/.exec(url.pathname);
      if (captureEnabled && discover && request.method === "GET") {
        // cshargextcap asks before it connects; this does not use up the ticket.
        sendJson(response, 200, { containers: [] });
        return;
      }
      if (captureEnabled && /^\/api\/v1\/capture\/packetflix\//.test(url.pathname)) {
        // The websocket is served on upgrade; a plain request is refused.
        sendJson(response, ticketFromPath(url.pathname) ? 400 : 404, { error: "websocket upgrade required" });
        return;
      }
      if (request.headers.authorization !== `Bearer ${token}`) {
        sendJson(response, 401, { error: "Unauthorized" });
        return;
      }
      const route = `${request.method} ${url.pathname}`;
      if (route === "GET /api/v1/lab-host" && (health.features ?? []).includes("lab-host-info")) {
        const runtime = health.runtime ?? "docker";
        sendJson(response, 200, {
          runtime,
          ...(runtime === "c9s" ? { c9s: { ...FAKE_SERVER_C9S_HOST, ...health.c9s } } : {})
        });
        return;
      }
      const capture = /^\/api\/v1\/labs\/([^/]+)(\/capture\/(interfaces|stream|tickets))?$/.exec(url.pathname);
      if (captureEnabled && capture) {
        const labName = decodeURIComponent(capture[1]);
        if (labName !== FAKE_CAPTURE_LAB) {
          sendJson(response, 404, { error: `Lab '${labName}' not found` });
          return;
        }
        const action = capture[3];
        if (!action && request.method === "GET") {
          sendJson(
            response,
            200,
            ["n1", "n2"].map((node) => ({ name: `${labName}-${node}`, nodeName: node, lab_name: labName, kind: "linux", state: "running" }))
          );
          return;
        }
        if (action === "interfaces" && request.method === "GET") {
          sendJson(response, 200, CAPTURE_INTERFACES);
          return;
        }
        if (action === "stream" && request.method === "GET") {
          const targets = url.searchParams.getAll("target");
          const durationMs = parseDuration(url.searchParams.get("duration"));
          const packetLimit = url.searchParams.has("packetLimit") ? Number(url.searchParams.get("packetLimit")) : undefined;
          const problem =
            checkTargets(targets) ??
            (durationMs === "invalid" ? "invalid duration" : undefined) ??
            (packetLimit !== undefined && !(Number.isInteger(packetLimit) && packetLimit > 0) ? "invalid packetLimit" : undefined);
          if (problem) {
            sendJson(response, 400, { error: problem });
            return;
          }
          const download = ["1", "true"].includes(url.searchParams.get("download") ?? "");
          response.writeHead(200, {
            "Content-Type": "application/x-pcapng",
            ...(download ? { "Content-Disposition": `attachment; filename="${labName}-20261027T140000Z.pcapng"` } : {})
          });
          const disconnected = new AbortController();
          response.on("close", () => disconnected.abort());
          await writeCapture(
            { targets, ...(typeof durationMs === "number" ? { durationMs } : {}), ...(packetLimit !== undefined ? { packetLimit } : {}) },
            (data) => {
              if (!response.write(data)) return new Promise<void>((resolve) => response.once("drain", () => resolve()));
            },
            disconnected.signal
          );
          response.end();
          return;
        }
        if (action === "tickets" && request.method === "POST") {
          const body = JSON.parse((await readBody(request)).toString("utf8")) as {
            targets?: { node?: string; interface?: string }[];
            duration?: string;
          };
          const targets = (body.targets ?? []).map((target) => `${target.node ?? ""}:${target.interface ?? ""}`);
          const durationMs = parseDuration(body.duration);
          const problem = checkTargets(targets) ?? (durationMs === "invalid" ? "invalid duration" : undefined);
          if (problem) {
            sendJson(response, 400, { error: problem });
            return;
          }
          const ticket = randomBytes(32).toString("base64url");
          const expiresAt = Date.now() + TICKET_TTL_MS;
          tickets.set(hashTicket(ticket), { targets, expiresAt, ...(typeof durationMs === "number" ? { durationMs } : {}) });
          const container = JSON.stringify({ name: labName, type: "c9s-lab", "network-interfaces": targets });
          const host = request.headers.host ?? "127.0.0.1";
          sendJson(response, 201, {
            ticket,
            packetflixUri: `packetflix:ws://${host}/api/v1/capture/packetflix/${ticket}?container=${encodeURIComponent(container)}`,
            expiresAt: new Date(expiresAt).toISOString()
          });
          return;
        }
      }
      const topologyFile = /^\/api\/v1\/labs\/([^/]+)\/topology\/file(\/rename)?$/.exec(url.pathname);
      switch (route) {
        case "GET /api/v1/labs/workspace/tree":
          sendJson(response, 200, await local.fs.list(query("path")));
          return;
        case "GET /api/v1/labs/workspace/file": {
          const file = await local.fs.read(query("path"));
          response.writeHead(200, { "Content-Type": file.contentType, "Content-Length": file.data.byteLength });
          response.end(Buffer.from(file.data));
          return;
        }
        case "PUT /api/v1/labs/workspace/file":
          await local.fs.write(query("path"), await readBody(request));
          sendJson(response, 200, { success: true });
          return;
        case "DELETE /api/v1/labs/workspace/file":
          await local.fs.delete(query("path"), { recursive: ["1", "true", "yes"].includes(query("recursive")) });
          sendJson(response, 200, { success: true });
          return;
        case "POST /api/v1/labs/workspace/file/rename": {
          const body = JSON.parse((await readBody(request)).toString("utf8")) as { oldPath: string; newPath: string };
          await local.fs.rename(body.oldPath, body.newPath);
          sendJson(response, 200, { success: true });
          return;
        }
        case "POST /api/v1/labs/workspace/directory": {
          const body = JSON.parse((await readBody(request)).toString("utf8")) as { path: string };
          await local.fs.mkdir(body.path);
          sendJson(response, 200, { success: true });
          return;
        }
        case "GET /api/v1/labs/workspace/events": {
          const controller = new AbortController();
          watchers.add(controller);
          request.on("close", () => controller.abort());
          const events = await local.fs.watch(controller.signal);
          response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
          response.write("\n");
          for await (const event of events) response.write(`${JSON.stringify(event)}\n`);
          response.end();
          watchers.delete(controller);
          return;
        }
        case "GET /api/v1/labs/topology/files":
          sendJson(response, 200, await local.listTopologies());
          return;
      }
      if (topologyFile) {
        const labName = decodeURIComponent(topologyFile[1]);
        const files = local.topologyFiles({ labName });
        if (topologyFile[2]) {
          const body = JSON.parse((await readBody(request)).toString("utf8")) as { oldPath: string; newPath: string };
          await files.rename(body.oldPath, body.newPath);
          sendJson(response, 200, { success: true });
          return;
        }
        const filePath = query("path");
        const revision = await files.revision(filePath);
        switch (request.method) {
          case "GET": {
            const content = await files.readFile(filePath);
            response.writeHead(200, {
              "Content-Type": "text/plain; charset=utf-8",
              ...(revision ? { "X-Topology-Document-Revision": revision } : {})
            });
            response.end(content);
            return;
          }
          case "HEAD":
            response.writeHead(
              (await files.exists(filePath)) ? 200 : 404,
              revision ? { "X-Topology-Document-Revision": revision } : {}
            );
            response.end();
            return;
          case "PUT":
            await files.writeFile(filePath, (await readBody(request)).toString("utf8"));
            sendJson(response, 200, { success: true });
            return;
          case "DELETE":
            await files.unlink(filePath);
            sendJson(response, 200, { success: true });
            return;
        }
      }
      sendJson(response, 404, { error: `No route ${route}` });
    })().catch((error: unknown) => {
      const missing = (error as { code?: unknown } | null)?.code === "ENOENT";
      const status = errorStatus(error) ?? (missing ? 404 : 500);
      if (!response.headersSent) {
        sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
      } else {
        response.end();
      }
    });
  });

  // The Packetflix websocket: no bearer token, the single-use ticket is the credential.
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://fake").pathname;
    const ticket = captureEnabled ? ticketFromPath(pathname, true) : undefined;
    if (!ticket) {
      socket.end("HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\n\r\n{\"error\":\"unknown, used or expired ticket\"}");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      const closed = new AbortController();
      ws.on("close", () => closed.abort());
      void writeCapture(
        { targets: ticket.targets, ...(ticket.durationMs !== undefined ? { durationMs: ticket.durationMs } : {}) },
        (data) => ws.send(data, { binary: true }),
        closed.signal
      ).then(() => {
        if (!closed.signal.aborted) ws.close(1000, "capture ended");
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    async close() {
      for (const watcher of watchers) watcher.abort();
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await local.dispose();
    }
  };
}
