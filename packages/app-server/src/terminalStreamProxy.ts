import type { FastifyInstance, FastifyReply } from "fastify";
import WebSocket, { type RawData } from "ws";
import type { TerminalClientMessage } from "@srl-labs/containerlab-lab-backend";
import { isValidCloseCode } from "@srl-labs/containerlab-lab-backend/api";

import type { EndpointResolver } from "./endpointResolver.ts";

/** Tells the browser that another client attached to its terminal session. */
const TERMINAL_CLOSE_TAKEN_OVER = 4001;

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

function parseClientMessage(data: RawData): TerminalClientMessage | null {
  try {
    const value = JSON.parse(String(data)) as unknown;
    return typeof value === "object" && value !== null && "type" in value
      ? (value as TerminalClientMessage)
      : null;
  } catch {
    return null;
  }
}

/**
 * Bridges the browser's terminal WebSocket to the endpoint's terminal session.
 * Both sides speak the clab-api-server terminal protocol. When the browser
 * goes away the upstream is only disconnected: a resumable session stays for
 * the page to attach again after a reload, any other session ends.
 */
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
      const pending: TerminalClientMessage[] = [];
      let send = (message: TerminalClientMessage): void => {
        pending.push(message);
      };
      let detach = (): void => {};
      let clientClosed = false;

      socket.on("message", (data: RawData) => {
        const message = parseClientMessage(data);
        if (message) send(message);
      });
      socket.on("close", () => {
        clientClosed = true;
        detach();
      });
      socket.on("error", (error: Error) => {
        app.log.warn({ err: error, sessionId }, "terminal proxy websocket error");
        detach();
      });

      resolved.backend.attachTerminal(sessionId).then(
        (stream) => {
          if (clientClosed) {
            stream.close();
            return;
          }
          stream.onMessage((message) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify(message));
            }
          });
          stream.onClose((reason, { takenOver }) =>
            closeSocket(socket, takenOver ? TERMINAL_CLOSE_TAKEN_OVER : 1000, reason)
          );
          send = (message) => stream.send(message);
          detach = () => stream.close();
          for (const message of pending.splice(0)) stream.send(message);
        },
        (error: unknown) => {
          app.log.warn({ err: error, sessionId }, "terminal upstream websocket error");
          closeSocket(socket, 1011, "Upstream terminal connection failed");
        }
      );
    }
  );
}
