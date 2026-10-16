/**
 * SSE bridge for containerlab events.
 *
 * Opens the endpoint's long-lived event stream and sends each event as an
 * SSE message to the browser's EventSource.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import type { EndpointResolver } from "./endpointResolver.ts";
import {
  disableStreamTimeouts,
  startSseHeartbeat,
  streamResponseHeaders,
} from "./streamResponseHeaders.ts";

const DEFAULT_INTERFACE_STATS_INTERVAL = "1s";

function resolveInterfaceStatsInterval(): string {
  const value = process.env.CLAB_STANDALONE_INTERFACE_STATS_INTERVAL?.trim();
  return value && value.length > 0 ? value : DEFAULT_INTERFACE_STATS_INTERVAL;
}

export function registerEventsProxy(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
): void {
  app.get(
    "/api/events",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) {
        return reply.status(401).send({ error: "Not authenticated" });
      }

      const { backend } = resolved;

      disableStreamTimeouts(request, reply);

      // Set SSE headers
      reply.raw.writeHead(
        200,
        streamResponseHeaders(request, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        }),
      );

      // Send initial SSE comment to establish connection
      reply.raw.write(":ok\n\n");
      const stopHeartbeat = startSseHeartbeat(reply);

      let aborted = false;
      const abortController = new AbortController();

      const abort = (): void => {
        aborted = true;
        abortController.abort();
      };
      reply.raw.on("close", abort);

      try {
        const events = await backend.events(
          {
            initialState: true,
            interfaceStats: true,
            interfaceStatsInterval: resolveInterfaceStatsInterval(),
          },
          abortController.signal,
        );

        let eventId = 0;
        for await (const event of events) {
          if (aborted) break;
          eventId++;
          reply.raw.write(`id: ${eventId}\ndata: ${JSON.stringify(event)}\n\n`);
        }
      } catch (error) {
        if (!aborted) {
          const message =
            error instanceof Error ? error.message : "Event stream error";
          reply.raw.write(
            `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`,
          );
        }
      } finally {
        stopHeartbeat();
        reply.raw.off("close", abort);
        if (!aborted && !reply.raw.writableEnded) {
          reply.raw.end();
        }
      }
    },
  );
}
