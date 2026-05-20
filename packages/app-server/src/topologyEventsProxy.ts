import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import type { ClabApiClient } from "./clabApiClient.ts";
import type { EndpointEntry } from "./endpointSessionStore.ts";
import {
  disableStreamTimeouts,
  startSseHeartbeat,
  streamResponseHeaders,
} from "./streamResponseHeaders.ts";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.ts";

type EndpointResolver = (
  request: FastifyRequest,
  reply: FastifyReply,
  endpointId?: string,
) => { client: ClabApiClient; endpoint: EndpointEntry } | null;

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
  body: ReadableStream<Uint8Array>,
  reply: FastifyReply,
  isAborted: () => boolean,
  options: ForwardTopologyEventsOptions = {},
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventId = 0;

  try {
    while (!isAborted()) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (isAborted()) {
          break;
        }
        const trimmed = line.trim();
        if (trimmed && options.shouldSuppressLine?.(trimmed) !== true) {
          eventId += 1;
          reply.raw.write(`id: ${eventId}\ndata: ${trimmed}\n\n`);
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
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

      const { client, endpoint } = resolved;
      const session = sessions.getSession(sessionId, endpoint.id);
      if (!session) {
        return reply.status(404).send({ error: "Topology session not found" });
      }

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
      const stopHeartbeat = startSseHeartbeat(reply);

      let aborted = false;
      const abortController = new AbortController();
      const abort = (): void => {
        aborted = true;
        abortController.abort();
      };
      reply.raw.on("close", abort);

      try {
        const response = await client.openTopologyEventStream(
          endpoint.token,
          session.topologyRef.labName,
          session.topologyRef.yamlPath,
          { signal: abortController.signal },
        );
        if (!response.body) {
          reply.raw.write(
            "event: error\ndata: No topology event stream body\n\n",
          );
          reply.raw.end();
          return;
        }

        await forwardTopologyEvents(response.body, reply, () => aborted, {
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
        stopHeartbeat();
        reply.raw.off("close", abort);
        if (!aborted && !reply.raw.writableEnded) {
          reply.raw.end();
        }
      }
    },
  );
}
