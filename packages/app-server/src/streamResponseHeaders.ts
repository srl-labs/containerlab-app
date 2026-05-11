import type { FastifyRequest } from "fastify";

type StreamHeaders = Record<string, string>;

export function streamResponseHeaders(
  request: FastifyRequest,
  headers: StreamHeaders
): StreamHeaders {
  const origin = request.headers.origin;
  if (typeof origin !== "string" || origin.trim().length === 0) {
    return headers;
  }

  return {
    ...headers,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin"
  };
}
