import type { FastifyReply, FastifyRequest } from "fastify";

type StreamHeaders = Record<string, string>;
const SSE_HEARTBEAT_INTERVAL_MS = 25_000;

function clearTimeoutIfSupported(value: unknown): void {
  if (
    typeof value === "object" &&
    value !== null &&
    "setTimeout" in value &&
    typeof value.setTimeout === "function"
  ) {
    value.setTimeout(0, () => {});
  }
}

export function streamResponseHeaders(
  request: FastifyRequest,
  headers: StreamHeaders,
): StreamHeaders {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || origin.trim().length === 0) {
    return headers;
  }

  return {
    ...headers,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

export function disableStreamTimeouts(
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  clearTimeoutIfSupported(request.raw);
  clearTimeoutIfSupported(request.raw.socket);
  clearTimeoutIfSupported(reply.raw);
  clearTimeoutIfSupported(reply.raw.socket);
}

export function startSseHeartbeat(
  reply: FastifyReply,
  intervalMs = SSE_HEARTBEAT_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    if (reply.raw.destroyed || reply.raw.writableEnded) {
      return;
    }
    reply.raw.write(":keepalive\n\n");
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
