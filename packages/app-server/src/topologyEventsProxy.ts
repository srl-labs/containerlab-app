import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import type { EndpointResolver } from "./endpointResolver.ts";
import {
  disableStreamTimeouts,
  startSseHeartbeat,
  streamResponseHeaders,
} from "./streamResponseHeaders.ts";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.ts";

interface ForwardTopologyEventsOptions {
  shouldSuppressLine?: (line: string) => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function writeTopologyEventError(reply: FastifyReply, message: string): void {
  reply.raw.write(
    `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`,
  );
}

function isTopologyDocumentEventLine(line: string): boolean {
  try {
    const value = JSON.parse(line) as unknown;
    return isRecord(value) && value.type === "topology-doc";
  } catch {
    return false;
  }
}

async function forwardTopologyEvents(
  lines: AsyncIterable<string>,
  reply: FastifyReply,
  isAborted: () => boolean,
  options: ForwardTopologyEventsOptions = {},
): Promise<void> {
  let eventId = 0;
  for await (const line of lines) {
    if (isAborted()) {
      break;
    }
    if (options.shouldSuppressLine?.(line) !== true) {
      eventId += 1;
      reply.raw.write(`id: ${eventId}\ndata: ${line}\n\n`);
    }
  }
}

export function registerTopologyEventsProxy(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
  sessions: StandaloneTopologySessionManager,
): void {
  app.get<{ Querystring: { endpointId?: string; sessionId?: string } }>(
    "/api/topology/events",
    async (
      request: FastifyRequest<{
        Querystring: { endpointId?: string; sessionId?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const resolved = resolveEndpoint(
        request,
        reply,
        request.query.endpointId,
      );
      if (!resolved) {
        return reply.status(401).send({ error: "Not authenticated" });
      }

      const sessionId = request.query.sessionId?.trim() ?? "";
      if (!sessionId) {
        return reply.status(400).send({ error: "Missing sessionId" });
      }

      const { backend, endpoint } = resolved;
      const sessionLease = sessions.acquireSession(sessionId, endpoint.id);
      if (!sessionLease) {
        return reply.status(404).send({ error: "Topology session not found" });
      }
      const { session } = sessionLease;

      let aborted = false;
      let closeListenerAttached = false;
      let stopHeartbeat: (() => void) | undefined;
      const abortController = new AbortController();
      const abort = (): void => {
        aborted = true;
        abortController.abort();
      };

      try {
        disableStreamTimeouts(request, reply);

        reply.raw.writeHead(
          200,
          streamResponseHeaders(request, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          }),
        );
        reply.raw.write(":ok\n\n");
        stopHeartbeat = startSseHeartbeat(reply);
        reply.raw.on("close", abort);
        closeListenerAttached = true;

        const lines = await backend.watchTopology(
          session.topologyRef.labName,
          session.topologyRef.yamlPath,
          abortController.signal,
        );

        await forwardTopologyEvents(lines, reply, () => aborted, {
          shouldSuppressLine: (line) =>
            session.isInternalUpdate() && isTopologyDocumentEventLine(line),
        });
      } catch (error) {
        if (!aborted) {
          const message =
            error instanceof Error
              ? error.message
              : "Topology event stream error";
          writeTopologyEventError(reply, message);
        }
      } finally {
        stopHeartbeat?.();
        sessionLease.release();
        if (closeListenerAttached) {
          reply.raw.off("close", abort);
        }
        if (!aborted && !reply.raw.writableEnded) {
          reply.raw.end();
        }
      }
    },
  );
}
