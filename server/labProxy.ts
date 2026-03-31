/**
 * Lab lifecycle action proxy - deploy, destroy, redeploy.
 */

import type { TopologyRef } from "@srl-labs/clab-ui/session";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ClabApiClient } from "./clabApiClient.js";
import { getTokenFromRequest } from "./middleware.js";
import {
  resolveCanonicalStandaloneTopologyRef
} from "./topologyIdentity.js";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.js";

interface LabTarget {
  sessionId?: string;
  topologyRef?: TopologyRef;
}

interface LabActionBody extends LabTarget {
  cleanup?: boolean;
}

interface LabStatusBody extends LabTarget {}

interface ResolvedLabTarget {
  labName: string;
  topologyRef?: TopologyRef;
  yamlPath?: string;
}

type ClientResolver = (request: FastifyRequest) => ClabApiClient;

class RequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

async function forwardNdjsonStream(reply: FastifyReply, response: Response): Promise<void> {
  reply.raw.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff"
  });

  if (!response.body) {
    reply.raw.write(
      `${JSON.stringify({ type: "error", error: "Lifecycle stream has no response body" })}\n`
    );
    reply.raw.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        reply.raw.write(Buffer.from(value));
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  reply.raw.end();
}

async function resolveLabTarget(
  request: FastifyRequest,
  token: string,
  client: ClabApiClient,
  sessions: StandaloneTopologySessionManager,
  target: LabTarget
): Promise<ResolvedLabTarget> {
  const sessionId = target.sessionId?.trim() ?? "";
  if (sessionId) {
    const session = sessions.getSession(sessionId, token, client.getBaseUrl());
    if (!session) {
      throw new RequestError("Topology session not found", 404);
    }
    return {
      labName: session.topologyRef.labName,
      topologyRef: session.topologyRef,
      yamlPath: session.topologyRef.yamlPath
    };
  }

  if (target.topologyRef) {
    const topologyRef = await resolveCanonicalStandaloneTopologyRef(client, token, target.topologyRef);
    return {
      labName: topologyRef.labName,
      topologyRef,
      yamlPath: topologyRef.yamlPath
    };
  }

  throw new RequestError("Missing topologyRef or sessionId", 400);
}

function handleRouteError(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RequestError) {
    return reply.status(error.statusCode).send({ error: message });
  }
  return reply.status(500).send({ error: message });
}

export function registerLabProxy(
  app: FastifyInstance,
  getClient: ClientResolver,
  sessions: StandaloneTopologySessionManager
): void {
  app.post<{ Body: LabStatusBody }>(
    "/api/lab/status",
    async (request: FastifyRequest<{ Body: LabStatusBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const running = await client.isLabRunning(token, target.labName);
        return reply.send({ success: true, running });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/deploy",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const lifecycle = await client.deployLab(token, target.labName, {
          path: target.yamlPath,
          includeLogs: true
        });
        return reply.send({
          success: true,
          result: lifecycle.result,
          message: lifecycle.message,
          logs: lifecycle.logs ?? []
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/deploy/stream",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const streamResponse = await client.openLifecycleStream(token, "deploy", target.labName, {
          path: target.yamlPath
        });
        await forwardNdjsonStream(reply, streamResponse);
        return;
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/destroy",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const lifecycle = await client.destroyLab(token, target.labName, {
          cleanup: request.body.cleanup === true,
          includeLogs: true
        });
        return reply.send({
          success: true,
          result: lifecycle.result,
          message: lifecycle.message,
          logs: lifecycle.logs ?? []
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/destroy/stream",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const streamResponse = await client.openLifecycleStream(token, "destroy", target.labName, {
          cleanup: request.body.cleanup === true
        });
        await forwardNdjsonStream(reply, streamResponse);
        return;
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/redeploy",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const lifecycle = await client.redeployLab(token, target.labName, {
          cleanup: request.body.cleanup === true,
          includeLogs: true
        });
        return reply.send({
          success: true,
          result: lifecycle.result,
          message: lifecycle.message,
          logs: lifecycle.logs ?? []
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/redeploy/stream",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const streamResponse = await client.openLifecycleStream(token, "redeploy", target.labName, {
          cleanup: request.body.cleanup === true
        });
        await forwardNdjsonStream(reply, streamResponse);
        return;
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );
}
