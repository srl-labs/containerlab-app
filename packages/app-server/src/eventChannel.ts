/**
 * Every live event stream of a browser tab over one WebSocket.
 *
 * Browsers allow only six HTTP/1.1 connections per host, and an SSE stream
 * holds one for as long as it is open. A tab follows the events of each lab
 * host, its workspace files and the open topology, so with a few lab hosts or
 * tabs the streams alone used up the connections and the next request waited
 * until a tab closed. WebSockets do not count against that limit, and plain
 * HTTP (the desktop app, or the web app without TLS) has no HTTP/2 to share
 * connections.
 *
 * The client opens and closes streams with
 * `{type:"open", id, stream, endpointId?, sessionId?}` and `{type:"close", id}`.
 * The server answers per stream with `{id, type:"open"}`, then
 * `{id, type:"event", data}` for each event, `{id, type:"error", error}` when the
 * stream fails, and `{id, type:"end"}` once it ends; a refused stream gets
 * `{id, type:"refused", status, error}` instead. `{type:"ping"}` keeps the
 * socket busy for proxies and lets the client notice a dead connection.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import WebSocket, { type RawData } from "ws";

import {
  EventStreamRefusal,
  pumpEventStream,
  type EventStream,
  type EventStreamSource,
} from "./eventStreams.ts";

const PING_INTERVAL_MS = 25_000;
/** Far more than a tab needs; keeps one socket from opening upstream streams without bound. */
const MAX_STREAMS_PER_SOCKET = 64;

interface OpenMessage {
  type: "open";
  id: string;
  stream: string;
  endpointId?: string;
  sessionId?: string;
}

interface CloseMessage {
  type: "close";
  id: string;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseClientMessage(data: RawData): OpenMessage | CloseMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(String(data));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const id = optionalString(record.id);
  if (id === undefined) return null;
  if (record.type === "close") return { type: "close", id };
  if (record.type !== "open" || typeof record.stream !== "string") return null;
  return {
    type: "open",
    id,
    stream: record.stream,
    endpointId: optionalString(record.endpointId),
    sessionId: optionalString(record.sessionId),
  };
}

export function registerEventChannel(
  app: FastifyInstance,
  sources: Readonly<Record<string, EventStreamSource>>,
): void {
  app.get("/api/events/socket", { websocket: true }, (socket, request) => {
    const streams = new Map<string, AbortController>();
    const send = (message: unknown): void => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };

    const pingTimer = setInterval(() => send({ type: "ping" }), PING_INTERVAL_MS);
    pingTimer.unref();

    const open = (message: OpenMessage): void => {
      if (streams.has(message.id)) return;
      const source = Object.hasOwn(sources, message.stream) ? sources[message.stream] : undefined;
      if (!source) {
        send({ id: message.id, type: "refused", status: 404, error: `Unknown event stream "${message.stream}"` });
        return;
      }
      if (streams.size >= MAX_STREAMS_PER_SOCKET) {
        send({ id: message.id, type: "refused", status: 429, error: "Too many event streams" });
        return;
      }

      let stream: EventStream;
      try {
        // The upgrade request carries the session cookie; there is no reply to set one on.
        stream = source(request, {} as FastifyReply, {
          endpointId: message.endpointId,
          sessionId: message.sessionId,
        });
      } catch (error) {
        const status = error instanceof EventStreamRefusal ? error.status : 500;
        const reason = error instanceof Error ? error.message : "Event stream refused";
        send({ id: message.id, type: "refused", status, error: reason });
        return;
      }

      const controller = new AbortController();
      streams.set(message.id, controller);
      send({ id: message.id, type: "open" });
      void pumpEventStream(stream, controller.signal, {
        event: (data) => send({ id: message.id, type: "event", data }),
        error: (reason) => send({ id: message.id, type: "error", error: reason }),
      }).finally(() => {
        if (streams.get(message.id) !== controller) return;
        streams.delete(message.id);
        if (!controller.signal.aborted) send({ id: message.id, type: "end" });
      });
    };

    socket.on("message", (data: RawData) => {
      const message = parseClientMessage(data);
      if (!message) return;
      if (message.type === "open") {
        open(message);
        return;
      }
      streams.get(message.id)?.abort();
      streams.delete(message.id);
    });

    const closeAll = (): void => {
      clearInterval(pingTimer);
      for (const controller of streams.values()) controller.abort();
      streams.clear();
    };
    socket.on("close", closeAll);
    socket.on("error", (error: Error) => {
      app.log.warn({ err: error }, "event channel websocket error");
      closeAll();
    });
  });
}
