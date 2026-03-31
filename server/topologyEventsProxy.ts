import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import type { ClabApiClient } from "./clabApiClient.js";
import { getTokenFromRequest } from "./middleware.js";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.js";

type ClientResolver = (request: FastifyRequest) => ClabApiClient;

export function registerTopologyEventsProxy(
  app: FastifyInstance,
  getClient: ClientResolver,
  sessions: StandaloneTopologySessionManager
): void {
  app.get<{ Querystring: { sessionId?: string } }>(
    "/api/topology/events",
    async (
      request: FastifyRequest<{ Querystring: { sessionId?: string } }>,
      reply: FastifyReply
    ) => {
      const token = getTokenFromRequest(request);
      if (!token) {
        return reply.status(401).send({ error: "Not authenticated" });
      }

      const sessionId = request.query.sessionId?.trim() ?? "";
      if (!sessionId) {
        return reply.status(400).send({ error: "Missing sessionId" });
      }

      const client = getClient(request);
      const session = sessions.getSession(sessionId, token, client.getBaseUrl());
      if (!session) {
        return reply.status(404).send({ error: "Topology session not found" });
      }

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      reply.raw.write(":ok\n\n");

      let eventId = 0;
      let aborted = false;
      request.raw.on("close", () => {
        aborted = true;
      });

      try {
        const response = await client.openTopologyEventStream(
          token,
          session.topologyRef.labName,
          session.topologyRef.yamlPath
        );
        if (!response.body) {
          reply.raw.write("event: error\ndata: No topology event stream body\n\n");
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
            eventId += 1;
            reply.raw.write(`id: ${eventId}\ndata: ${trimmed}\n\n`);
          }
        }

        reader.cancel().catch(() => {});
      } catch (error) {
        if (!aborted) {
          const message = error instanceof Error ? error.message : "Topology event stream error";
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
        }
      }

      if (!aborted) {
        reply.raw.end();
      }
    }
  );
}
