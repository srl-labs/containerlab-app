/**
 * Live streams of a running lab over WebSockets: a node's container log as it
 * is written, and the CPU and memory usage of the lab's nodes.
 *
 * Browsers allow only six HTTP/1.1 connections per host, and the app already
 * keeps event streams open on several of them; WebSockets do not count
 * against that limit, so these streams cannot starve other requests.
 *
 * The client sends one JSON message with its target once connected. The
 * server answers with `{type:"line"}` or `{type:"stats"}` messages, then
 * `{type:"end"}` when the stream ends, or `{type:"error", error, status?}`.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import WebSocket, { type RawData } from "ws";
import { getHttpErrorStatus } from "@srl-labs/containerlab-lab-backend/api";

import type { EndpointResolver } from "./endpointResolver.ts";
import {
  RequestError,
  resolveLabTarget,
  resolveNodeTarget,
  type RuntimeTargetBody
} from "./runtimeProxy.ts";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.ts";

interface NodeLogStreamRequest extends RuntimeTargetBody {
  nodeName?: string;
  tail?: string;
}

interface LabStatsStreamRequest extends RuntimeTargetBody {
  intervalSeconds?: number;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() || "Stream interrupted.";
}

function send(socket: WebSocket, message: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function parseRequest<T>(data: RawData): T | undefined {
  try {
    const value = JSON.parse(String(data)) as unknown;
    return typeof value === "object" && value !== null ? (value as T) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Serves one stream per socket: waits for the request, opens the stream and
 * forwards each value until it ends, the socket closes or an error occurs.
 */
function serveStream<TRequest, TValue>(
  socket: WebSocket,
  open: (request: TRequest, signal: AbortSignal) => Promise<AsyncIterable<TValue>>,
  toMessage: (value: TValue) => unknown
): void {
  const abortController = new AbortController();
  socket.on("close", () => abortController.abort());
  socket.on("error", () => abortController.abort());
  socket.once("message", (data: RawData) => {
    const request = parseRequest<TRequest>(data);
    if (!request) {
      send(socket, { type: "error", error: "Invalid stream request.", status: 400 });
      socket.close(1008, "Invalid stream request");
      return;
    }
    void (async () => {
      try {
        const values = await open(request, abortController.signal);
        for await (const value of values) {
          if (abortController.signal.aborted) return;
          send(socket, toMessage(value));
        }
        send(socket, { type: "end" });
      } catch (error) {
        if (abortController.signal.aborted) return;
        const status = error instanceof RequestError ? error.statusCode : getHttpErrorStatus(error);
        send(socket, { type: "error", error: errorMessage(error), ...(status ? { status } : {}) });
      } finally {
        abortController.abort();
        if (socket.readyState === WebSocket.OPEN) socket.close(1000, "Stream ended");
      }
    })();
  });
}

export function registerRuntimeStreamProxy(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
  sessions: StandaloneTopologySessionManager
): void {
  app.get<{ Querystring: { endpointId?: string } }>(
    "/api/runtime/logs/socket",
    { websocket: true },
    (socket, request) => {
      const resolved = resolveEndpoint(request, {} as FastifyReply, request.query.endpointId);
      if (!resolved) {
        socket.close(1008, "Not authenticated");
        return;
      }
      const { backend, endpoint } = resolved;
      serveStream<NodeLogStreamRequest, { line: string; stream?: "stdout" | "stderr" }>(
        socket,
        async (body, signal) => {
          const target = await resolveLabTarget(endpoint, backend, sessions, body);
          const node = await resolveNodeTarget(backend, target.labName, body.nodeName ?? "");
          const tail = typeof body.tail === "string" ? body.tail.trim() : "";
          return backend.streamNodeLogs(target.labName, node.container.name, {
            tail: tail || "200",
            signal
          });
        },
        (line) => ({ type: "line", ...line })
      );
    }
  );

  app.get<{ Querystring: { endpointId?: string } }>(
    "/api/runtime/stats/socket",
    { websocket: true },
    (socket, request) => {
      const resolved = resolveEndpoint(request, {} as FastifyReply, request.query.endpointId);
      if (!resolved) {
        socket.close(1008, "Not authenticated");
        return;
      }
      const { backend, endpoint } = resolved;
      serveStream<LabStatsStreamRequest, unknown>(
        socket,
        async (body, signal) => {
          const target = await resolveLabTarget(endpoint, backend, sessions, body);
          const interval = Number(body.intervalSeconds);
          return backend.streamLabStats(target.labName, {
            ...(Number.isFinite(interval) && interval > 0 ? { intervalSeconds: interval } : {}),
            signal
          });
        },
        (sample) => sample
      );
    }
  );
}
