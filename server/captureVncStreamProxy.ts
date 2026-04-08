import type { FastifyInstance, FastifyRequest } from "fastify";
import type { FastifyReply } from "fastify";
import WebSocket, { type RawData } from "ws";

import { buildWebSocketUrl } from "./clabApiClient.js";
import { getCaptureSessionEndpoint, setCaptureSessionEndpoint } from "./captureSessionStore.js";
import type { EndpointEntry } from "./endpointSessionStore.js";

type EndpointResolver = (
  request: FastifyRequest,
  reply: FastifyReply,
  endpointId?: string
) => { endpoint: EndpointEntry; client: { getBaseUrl(): string } } | null;

function isValidCloseCode(code: number): boolean {
  return (
    Number.isInteger(code) &&
    ((code >= 1000 &&
      code <= 1014 &&
      code !== 1004 &&
      code !== 1005 &&
      code !== 1006) ||
      (code >= 3000 && code <= 4999))
  );
}

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

function requestQueryString(request: FastifyRequest): string {
  const rawUrl = request.raw.url ?? "";
  const queryIndex = rawUrl.indexOf("?");
  return queryIndex >= 0 ? rawUrl.slice(queryIndex) : "";
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
      const requestedEndpointId = request.query.endpointId?.trim() || undefined;
      const mappedEndpointId = getCaptureSessionEndpoint(sessionId);
      const preferredEndpointId = mappedEndpointId ?? requestedEndpointId;

      let resolved = resolveEndpoint(request, {} as FastifyReply, preferredEndpointId);
      if (!resolved && requestedEndpointId && requestedEndpointId !== preferredEndpointId) {
        resolved = resolveEndpoint(request, {} as FastifyReply, requestedEndpointId);
      }
      if (!resolved && mappedEndpointId && mappedEndpointId !== preferredEndpointId) {
        resolved = resolveEndpoint(request, {} as FastifyReply, mappedEndpointId);
      }
      if (!resolved) {
        resolved = resolveEndpoint(request, {} as FastifyReply);
      }
      if (!resolved) {
        closeSocket(socket, 1008, "Not authenticated");
        return;
      }
      setCaptureSessionEndpoint(sessionId, resolved.endpoint.id);

      const requestedProtocolHeader = request.headers["sec-websocket-protocol"];
      const requestedProtocols =
        typeof requestedProtocolHeader === "string"
          ? requestedProtocolHeader
              .split(",")
              .map((value) => value.trim())
              .filter((value) => value.length > 0)
          : [];

      const suffix = suffixResolver(request);
      const query = requestQueryString(request);

      const upstreamPath =
        `/api/v1/capture/wireshark-vnc-sessions/${encodeURIComponent(sessionId)}/vnc/websockify` +
        suffix +
        query;

      const upstreamUrl = buildWebSocketUrl(resolved.client.getBaseUrl(), upstreamPath);
      const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
      const upstreamHeaders: Record<string, string> = {
        Authorization: `Bearer ${resolved.endpoint.token}`
      };
      if (origin) {
        upstreamHeaders.Origin = origin;
      }

      const upstream =
        requestedProtocols.length > 0
          ? new WebSocket(upstreamUrl, requestedProtocols, {
              headers: upstreamHeaders,
              perMessageDeflate: false
            })
          : new WebSocket(upstreamUrl, {
              headers: upstreamHeaders,
              perMessageDeflate: false
            });

      const forwardUpstreamError = (error: Error): void => {
        app.log.warn({ err: error, sessionId }, "capture vnc upstream websocket error");
        closeSocket(socket, 1011, "Upstream VNC websocket failed");
      };

      upstream.on("open", () => {
        socket.on("message", (data: RawData, isBinary: boolean) => {
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(data, { binary: isBinary });
          }
        });
      });

      upstream.on("message", (data: RawData, isBinary: boolean) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(data, { binary: isBinary });
        }
      });

      upstream.on("close", (code: number, reason: Buffer) => {
        closeSocket(socket, code, reason.toString() || "VNC websocket closed");
      });

      upstream.on("error", forwardUpstreamError);

      socket.on("close", () => {
        closeSocket(upstream, 1000, "Client closed");
      });

      socket.on("error", (error: Error) => {
        app.log.warn({ err: error, sessionId }, "capture vnc websocket proxy error");
        closeSocket(upstream, 1011, "Proxy socket error");
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
