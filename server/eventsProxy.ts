/**
 * NDJSON-to-SSE bridge for clab-api-server events.
 *
 * Opens a long-lived NDJSON stream from the API server and converts each
 * line into an SSE event for the browser's EventSource.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ClabApiClient } from "./clabApiClient.js";
import { getTokenFromRequest } from "./middleware.js";

type ClientResolver = (request: FastifyRequest) => ClabApiClient;
const DEFAULT_INTERFACE_STATS_INTERVAL = "1s";

function resolveInterfaceStatsInterval(): string {
  const value = process.env.CLAB_STANDALONE_INTERFACE_STATS_INTERVAL?.trim();
  return value && value.length > 0 ? value : DEFAULT_INTERFACE_STATS_INTERVAL;
}

export function registerEventsProxy(app: FastifyInstance, getClient: ClientResolver): void {
  app.get("/api/events", async (request: FastifyRequest, reply: FastifyReply) => {
    const token = getTokenFromRequest(request);
    if (!token) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const client = getClient(request);

    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    // Send initial SSE comment to establish connection
    reply.raw.write(":ok\n\n");

    let eventId = 0;
    let aborted = false;

    request.raw.on("close", () => {
      aborted = true;
    });

    try {
      const response = await client.openEventStream(token, {
        initialState: true,
        interfaceStats: true,
        interfaceStatsInterval: resolveInterfaceStatsInterval()
      });

      if (!response.body) {
        reply.raw.write("event: error\ndata: No event stream body\n\n");
        reply.raw.end();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (aborted) break;
          const trimmed = line.trim();
          if (!trimmed) continue;

          eventId++;
          reply.raw.write(`id: ${eventId}\ndata: ${trimmed}\n\n`);
        }
      }

      reader.cancel().catch(() => {});
    } catch (error) {
      if (!aborted) {
        const message = error instanceof Error ? error.message : "Event stream error";
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      }
    }

    if (!aborted) {
      reply.raw.end();
    }
  });
}
