import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import WebSocket, { type RawData } from "ws";
import { isValidCloseCode } from "@srl-labs/containerlab-lab-backend/api";

import { getCaptureSessionEndpoint, setCaptureSessionEndpoint } from "./captureSessionStore.ts";
import type { EndpointResolver, ResolvedEndpoint } from "./endpointResolver.ts";

type ResolvedCaptureEndpoint = ResolvedEndpoint;

function closeSocket(socket: WebSocket, code: number | undefined, reason: string): void {
  if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
    return;
  }
  if (code !== undefined && isValidCloseCode(code)) {
    socket.close(code, reason);
    return;
  }
  socket.close();
}

function rawBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}

function requestQueryString(request: FastifyRequest): string {
  const rawUrl = request.raw.url ?? "";
  const queryIndex = rawUrl.indexOf("?");
  return queryIndex >= 0 ? rawUrl.slice(queryIndex) : "";
}

function resolveCaptureEndpoint(
  request: FastifyRequest<{ Querystring: { endpointId?: string } }>,
  sessionId: string,
  resolveEndpoint: EndpointResolver
): ResolvedCaptureEndpoint | null {
  const requestedEndpointId = request.query.endpointId?.trim() || undefined;
  const mappedEndpointId = getCaptureSessionEndpoint(sessionId);
  const preferredEndpointId = mappedEndpointId ?? requestedEndpointId;
  const candidateIds = [
    preferredEndpointId,
    requestedEndpointId,
    mappedEndpointId,
    undefined
  ].filter((value, index, values) => index === values.indexOf(value));

  for (const candidateId of candidateIds) {
    const resolved = resolveEndpoint(request, {} as FastifyReply, candidateId);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function requestedWebSocketProtocols(request: FastifyRequest): string[] {
  const requestedProtocolHeader = request.headers["sec-websocket-protocol"];
  if (typeof requestedProtocolHeader !== "string") {
    return [];
  }
  return requestedProtocolHeader
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function registerCaptureVncStreamProxy(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver
): void {
  type CaptureWsRequest = FastifyRequest<{
    Params: { sessionId: string; "*"?: string };
    Querystring: { endpointId?: string };
  }>;

  const createHandler = (
    suffixResolver: (request: CaptureWsRequest) => string
  ) =>
    (
      socket: WebSocket,
      request: CaptureWsRequest
    ) => {
      const sessionId = request.params.sessionId.trim();
      const resolved = resolveCaptureEndpoint(request, sessionId, resolveEndpoint);
      if (!resolved) {
        closeSocket(socket, 1008, "Not authenticated");
        return;
      }
      setCaptureSessionEndpoint(sessionId, resolved.endpoint.id);

      const suffix = suffixResolver(request);
      const query = requestQueryString(request);

      const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
      const upstream = resolved.backend.connectWiresharkVnc(sessionId, `/websockify${suffix}${query}`, {
        protocols: requestedWebSocketProtocols(request),
        origin
      });

      const forwardUpstreamError = (error: Error): void => {
        app.log.warn({ err: error, sessionId }, "capture vnc upstream websocket error");
        closeSocket(socket, 1011, "Upstream VNC websocket failed");
      };

      upstream.onOpen(() => {
        socket.on("message", (data: RawData, isBinary: boolean) => {
          upstream.send(isBinary ? rawBytes(data) : String(data), isBinary);
        });
      });

      upstream.onMessage((data, isBinary) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(data, { binary: isBinary });
        }
      });

      upstream.onClose((code, reason) => {
        closeSocket(socket, code, reason || "VNC websocket closed");
      });

      upstream.onError(forwardUpstreamError);

      socket.on("close", () => {
        upstream.close(1000, "Client closed");
      });

      socket.on("error", (error: Error) => {
        app.log.warn({ err: error, sessionId }, "capture vnc websocket proxy error");
        upstream.close(1011, "Proxy socket error");
      });
    };

  app.get<{ Params: { sessionId: string; "*": string }; Querystring: { endpointId?: string } }>(
    "/api/runtime/capture/wireshark-vnc-sessions/:sessionId/vnc/websockify",
    { websocket: true },
    createHandler(() => "")
  );

  app.get<{ Params: { sessionId: string; "*": string }; Querystring: { endpointId?: string } }>(
    "/api/runtime/capture/wireshark-vnc-sessions/:sessionId/vnc/websockify/*",
    { websocket: true },
    createHandler((request) => {
      const wildcard = request.params["*"] ?? "";
      return wildcard.length > 0 ? `/${wildcard}` : "";
    })
  );
}
