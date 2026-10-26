import type { FastifyInstance, FastifyRequest } from "fastify";

import type { EndpointResolver } from "./endpointResolver.ts";
import {
  EventStreamRefusal,
  sendSseEventStream,
  type EventStreamSource,
} from "./eventStreams.ts";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTopologyDocumentEventLine(line: string): boolean {
  try {
    const value = JSON.parse(line) as unknown;
    return isRecord(value) && value.type === "topology-doc";
  } catch {
    return false;
  }
}

/**
 * The document events of a topology session's file. Document events caused by
 * the session's own writes are left out.
 */
export function topologyEventStreams(
  resolveEndpoint: EndpointResolver,
  sessions: StandaloneTopologySessionManager,
): EventStreamSource {
  return (request, reply, params) => {
    const resolved = resolveEndpoint(request, reply, params.endpointId);
    if (!resolved) {
      throw new EventStreamRefusal(401, "Not authenticated");
    }

    const sessionId = params.sessionId?.trim() ?? "";
    if (!sessionId) {
      throw new EventStreamRefusal(400, "Missing sessionId");
    }

    const { backend, endpoint } = resolved;
    const sessionLease = sessions.acquireSession(sessionId, endpoint.id);
    if (!sessionLease) {
      throw new EventStreamRefusal(404, "Topology session not found");
    }
    const { session } = sessionLease;

    return {
      failureMessage: "Topology event stream error",
      release: () => sessionLease.release(),
      async open(signal) {
        const lines = await backend.watchTopology(
          session.topologyRef.labName,
          session.topologyRef.yamlPath,
          signal,
        );
        return (async function* () {
          for await (const line of lines) {
            if (session.isInternalUpdate() && isTopologyDocumentEventLine(line)) continue;
            yield line;
          }
        })();
      },
    };
  };
}

export function registerTopologyEventsProxy(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
  sessions: StandaloneTopologySessionManager,
): void {
  const streams = topologyEventStreams(resolveEndpoint, sessions);
  app.get<{ Querystring: { endpointId?: string; sessionId?: string } }>(
    "/api/topology/events",
    (
      request: FastifyRequest<{
        Querystring: { endpointId?: string; sessionId?: string };
      }>,
      reply,
    ) =>
      sendSseEventStream(request, reply, streams, {
        endpointId: request.query.endpointId,
        sessionId: request.query.sessionId,
      }),
  );
}
