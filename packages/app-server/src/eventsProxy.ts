/**
 * SSE bridge for containerlab events.
 *
 * Opens the endpoint's long-lived event stream and sends each event as an
 * SSE message to the browser's EventSource. Browsers get the same stream over
 * the event channel (`eventChannel.ts`) and use this route only without it.
 */

import type { FastifyInstance } from "fastify";

import type { EndpointResolver } from "./endpointResolver.ts";
import {
  EventStreamRefusal,
  sendSseEventStream,
  type EventStreamSource,
} from "./eventStreams.ts";

const DEFAULT_INTERFACE_STATS_INTERVAL = "1s";

function resolveInterfaceStatsInterval(): string {
  const value = process.env.CLAB_STANDALONE_INTERFACE_STATS_INTERVAL?.trim();
  return value && value.length > 0 ? value : DEFAULT_INTERFACE_STATS_INTERVAL;
}

/** The lab events of an endpoint, with its current state first. */
export function labEventStreams(resolveEndpoint: EndpointResolver): EventStreamSource {
  return (request, reply, params) => {
    const resolved = resolveEndpoint(request, reply, params.endpointId);
    if (!resolved) {
      throw new EventStreamRefusal(401, "Not authenticated");
    }

    const { backend } = resolved;
    return {
      failureMessage: "Event stream error",
      async open(signal) {
        const events = await backend.events(
          {
            initialState: true,
            interfaceStats: true,
            interfaceStatsInterval: resolveInterfaceStatsInterval(),
          },
          signal,
        );
        return (async function* () {
          for await (const event of events) yield JSON.stringify(event);
        })();
      },
    };
  };
}

export function registerEventsProxy(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
): void {
  const streams = labEventStreams(resolveEndpoint);
  app.get("/api/events", (request, reply) =>
    sendSseEventStream(request, reply, streams, {}),
  );
}
