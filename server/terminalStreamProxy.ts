import type { FastifyInstance, FastifyRequest } from "fastify";
import WebSocket, { type RawData } from "ws";

import { buildWebSocketUrl } from "./clabApiClient.js";
import type { FastifyReply } from "fastify";
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

export function registerTerminalStreamProxy(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver
): void {
  app.get<{ Params: { sessionId: string }; Querystring: { endpointId?: string } }>(
    "/api/runtime/terminal-sessions/:sessionId/stream",
    { websocket: true },
    (socket, request) => {
      const resolved = resolveEndpoint(request, {} as FastifyReply, request.query.endpointId);
      if (!resolved) {
        closeSocket(socket, 1008, "Not authenticated");
        return;
      }

      const sessionId = request.params.sessionId.trim();
      const { client, endpoint } = resolved;
      const upstream = new WebSocket(
        buildWebSocketUrl(client.getBaseUrl(), `/api/v1/terminal-sessions/${encodeURIComponent(sessionId)}/stream`),
        {
          headers: {
            Authorization: `Bearer ${endpoint.token}`
          }
        }
      );

      const forwardUpstreamError = (error: Error): void => {
        app.log.warn({ err: error, sessionId }, "terminal upstream websocket error");
        closeSocket(socket, 1011, "Upstream terminal connection failed");
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
        closeSocket(socket, code, reason.toString() || "Terminal closed");
      });

      upstream.on("error", forwardUpstreamError);

      socket.on("close", () => {
        closeSocket(upstream, 1000, "Client closed");
      });

      socket.on("error", (error: Error) => {
        app.log.warn({ err: error, sessionId }, "terminal proxy websocket error");
        closeSocket(upstream, 1011, "Proxy socket error");
      });
    }
  );
}
