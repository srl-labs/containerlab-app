/**
 * Lab lifecycle action proxy - deploy, destroy, redeploy, start, stop, restart.
 */

import type { TopologyRef } from "@srl-labs/clab-ui/session";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getHttpErrorStatus, type ClabApiClient } from "./clabApiClient.ts";
import type { EndpointEntry } from "./endpointSessionStore.ts";
import {
  extractEndpointIdFromTopologyId,
  resolveCanonicalStandaloneTopologyRef,
  resolveRunningLabNameForTopology
} from "./topologyIdentity.ts";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.ts";
import { streamResponseHeaders } from "./streamResponseHeaders.ts";

interface LabTarget {
  endpointId?: string;
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

const LAB_NODE_LIFECYCLE_ENDPOINTS = ["start", "stop", "restart"] as const;
type LabNodeLifecycleEndpoint = (typeof LAB_NODE_LIFECYCLE_ENDPOINTS)[number];
type LifecycleStreamEndpoint = "deploy" | "destroy" | "redeploy" | LabNodeLifecycleEndpoint;

interface LifecycleStreamOptions {
  cleanup?: boolean;
  path?: string;
}

type EndpointResolver = (
  request: FastifyRequest,
  reply: FastifyReply,
  endpointId?: string
) => { client: ClabApiClient; endpoint: EndpointEntry } | null;

class RequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

function lifecycleStreamErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  const message = String(error).trim();
  return message.length > 0 ? message : "Lifecycle stream interrupted.";
}

function writeNdjsonLifecycleError(reply: FastifyReply, error: unknown): void {
  if (reply.raw.destroyed || reply.raw.writableEnded) {
    return;
  }
  reply.raw.write(
    `${JSON.stringify({
      type: "error",
      error: lifecycleStreamErrorMessage(error)
    })}\n`
  );
}

async function forwardNdjsonStream(
  request: FastifyRequest,
  reply: FastifyReply,
  response: Response,
  isAborted: () => boolean
): Promise<void> {
  reply.raw.writeHead(200, streamResponseHeaders(request, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff"
  }));

  if (!response.body) {
    writeNdjsonLifecycleError(reply, new Error("Lifecycle stream has no response body"));
    reply.raw.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (!isAborted()) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value && !isAborted() && !reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.write(Buffer.from(value));
      }
    }
  } catch (error) {
    if (!isAborted()) {
      writeNdjsonLifecycleError(reply, error);
    }
  } finally {
    reader.cancel().catch(() => {});
    if (!isAborted() && !reply.raw.writableEnded) {
      reply.raw.end();
    }
  }
}

async function resolveLabTarget(
  endpoint: EndpointEntry,
  client: ClabApiClient,
  sessions: StandaloneTopologySessionManager,
  target: LabTarget
): Promise<ResolvedLabTarget> {
  const sessionId = target.sessionId?.trim() ?? "";
  if (sessionId) {
    const session = sessions.getSession(sessionId, endpoint.id);
    if (!session) {
      throw new RequestError("Topology session not found", 404);
    }
    const labName = await resolveRunningLabNameForTopology(
      client,
      endpoint.token,
      session.topologyRef,
      session.topologyRef.labName
    );
    return {
      labName,
      topologyRef: session.topologyRef,
      yamlPath: session.topologyRef.yamlPath
    };
  }

  if (target.topologyRef) {
    const topologyRef = await resolveCanonicalStandaloneTopologyRef(
      client,
      endpoint.token,
      target.topologyRef,
      endpoint.id
    );
    const labName = await resolveRunningLabNameForTopology(
      client,
      endpoint.token,
      topologyRef,
      topologyRef.labName
    );
    return { labName, topologyRef, yamlPath: topologyRef.yamlPath };
  }

  throw new RequestError("Missing topologyRef or sessionId", 400);
}

function handleRouteError(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RequestError) {
    return reply.status(error.statusCode).send({ error: message });
  }
  return reply.status(getHttpErrorStatus(error) ?? 500).send({ error: message });
}

async function openAndForwardLifecycleStream(
  request: FastifyRequest,
  reply: FastifyReply,
  client: ClabApiClient,
  token: string,
  action: LifecycleStreamEndpoint,
  labName: string,
  options: LifecycleStreamOptions = {}
): Promise<FastifyReply | void> {
  let aborted = false;
  const abortController = new AbortController();
  const abort = (): void => {
    aborted = true;
    abortController.abort();
  };

  reply.raw.on("close", abort);
  try {
    const streamResponse = await client.openLifecycleStream(token, action, labName, options, {
      signal: abortController.signal
    });
    await forwardNdjsonStream(request, reply, streamResponse, () => aborted);
  } catch (error) {
    if (!aborted) {
      return handleRouteError(reply, error);
    }
  } finally {
    reply.raw.off("close", abort);
  }
}

export function registerLabProxy(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
  sessions: StandaloneTopologySessionManager
): void {
  const registerLabNodeLifecycleProxy = (action: LabNodeLifecycleEndpoint): void => {
    app.post<{ Body: LabActionBody }>(
      `/api/lab/${action}`,
      async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
        const resolved = resolveEndpoint(
          request,
          reply,
          request.body.endpointId ?? extractEndpointIdFromTopologyId(request.body.topologyRef?.topologyId)
        );
        if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

        try {
          const { client, endpoint } = resolved;
          const target = await resolveLabTarget(endpoint, client, sessions, request.body);
          const lifecycle = await client.controlLabLifecycle(endpoint.token, target.labName, action, {
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
      `/api/lab/${action}/stream`,
      async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
        const resolved = resolveEndpoint(
          request,
          reply,
          request.body.endpointId ?? extractEndpointIdFromTopologyId(request.body.topologyRef?.topologyId)
        );
        if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

        try {
          const { client, endpoint } = resolved;
          const target = await resolveLabTarget(endpoint, client, sessions, request.body);
          return await openAndForwardLifecycleStream(
            request,
            reply,
            client,
            endpoint.token,
            action,
            target.labName
          );
        } catch (error) {
          return handleRouteError(reply, error);
        }
      }
    );
  };

  app.post<{ Body: LabStatusBody }>(
    "/api/lab/status",
    async (request: FastifyRequest<{ Body: LabStatusBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(
        request,
        reply,
        request.body.endpointId ?? extractEndpointIdFromTopologyId(request.body.topologyRef?.topologyId)
      );
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const running = await client.isLabRunning(endpoint.token, target.labName);
        return reply.send({ success: true, running });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/deploy",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(
        request,
        reply,
        request.body.endpointId ?? extractEndpointIdFromTopologyId(request.body.topologyRef?.topologyId)
      );
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const lifecycle = await client.deployLab(endpoint.token, target.labName, {
          path: target.yamlPath,
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
    "/api/lab/deploy/stream",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(
        request,
        reply,
        request.body.endpointId ?? extractEndpointIdFromTopologyId(request.body.topologyRef?.topologyId)
      );
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        return await openAndForwardLifecycleStream(
          request,
          reply,
          client,
          endpoint.token,
          "deploy",
          target.labName,
          {
            path: target.yamlPath,
            cleanup: request.body.cleanup === true
          }
        );
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/destroy",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(
        request,
        reply,
        request.body.endpointId ?? extractEndpointIdFromTopologyId(request.body.topologyRef?.topologyId)
      );
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const lifecycle = await client.destroyLab(endpoint.token, target.labName, {
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
      const resolved = resolveEndpoint(
        request,
        reply,
        request.body.endpointId ?? extractEndpointIdFromTopologyId(request.body.topologyRef?.topologyId)
      );
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        return await openAndForwardLifecycleStream(
          request,
          reply,
          client,
          endpoint.token,
          "destroy",
          target.labName,
          {
            cleanup: request.body.cleanup === true
          }
        );
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: LabActionBody }>(
    "/api/lab/redeploy",
    async (request: FastifyRequest<{ Body: LabActionBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(
        request,
        reply,
        request.body.endpointId ?? extractEndpointIdFromTopologyId(request.body.topologyRef?.topologyId)
      );
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const lifecycle = await client.redeployLab(endpoint.token, target.labName, {
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
      const resolved = resolveEndpoint(
        request,
        reply,
        request.body.endpointId ?? extractEndpointIdFromTopologyId(request.body.topologyRef?.topologyId)
      );
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        return await openAndForwardLifecycleStream(
          request,
          reply,
          client,
          endpoint.token,
          "redeploy",
          target.labName,
          {
            cleanup: request.body.cleanup === true
          }
        );
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  for (const action of LAB_NODE_LIFECYCLE_ENDPOINTS) {
    registerLabNodeLifecycleProxy(action);
  }
}
