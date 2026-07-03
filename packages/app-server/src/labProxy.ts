/**
 * Lab lifecycle action proxy - deploy, destroy, redeploy, start, stop, restart.
 */

import type { TopologyRef } from "@srl-labs/clab-ui/session";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  getHttpErrorStatus,
  isUpstreamNetworkError,
  type ClabApiClient,
  type LifecycleActionResult
} from "./clabApiClient.ts";
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

interface LabApplyBody extends LabTarget {
  dryRun?: boolean;
}

interface LabStatusBody extends LabTarget {}

interface ResolvedLabTarget {
  labName: string;
  topologyRef?: TopologyRef;
  yamlPath?: string;
}

const LAB_NODE_LIFECYCLE_ENDPOINTS = ["start", "stop", "restart"] as const;
type LabNodeLifecycleEndpoint = (typeof LAB_NODE_LIFECYCLE_ENDPOINTS)[number];
type LifecycleStreamEndpoint = "deploy" | "destroy" | "redeploy" | "apply" | LabNodeLifecycleEndpoint;

const LIFECYCLE_RECONCILE_TIMEOUT_MS = 30000;
const LIFECYCLE_RECONCILE_INTERVAL_MS = 1000;

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

function lifecycleExpectedRunning(action: LifecycleStreamEndpoint): boolean | undefined {
  switch (action) {
    case "deploy":
    case "apply":
      return true;
    case "destroy":
      return false;
    case "redeploy":
    case "start":
    case "restart":
    case "stop":
      return undefined;
  }
}

function lifecycleUnknownMessage(action: LifecycleStreamEndpoint): string {
  return `Lifecycle ${action} result is unknown after the upstream connection was interrupted. Retry after a short delay or refresh lab state.`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForLabRunningState(
  client: ClabApiClient,
  token: string,
  labName: string,
  expectedRunning: boolean
): Promise<{ matched: boolean; running?: boolean; error?: unknown }> {
  const deadline = Date.now() + LIFECYCLE_RECONCILE_TIMEOUT_MS;
  let lastRunning: boolean | undefined;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    try {
      const running = await client.isLabRunning(token, labName);
      lastRunning = running;
      if (running === expectedRunning) {
        return { matched: true, running };
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(LIFECYCLE_RECONCILE_INTERVAL_MS);
  }

  return { matched: false, running: lastRunning, error: lastError };
}

async function reconcileIndeterminateLifecycleError(
  reply: FastifyReply,
  error: unknown,
  client: ClabApiClient,
  token: string,
  labName: string,
  action: LifecycleStreamEndpoint,
  preRunning?: boolean
): Promise<FastifyReply | undefined> {
  if (!isUpstreamNetworkError(error)) {
    return undefined;
  }

  const expectedRunning = lifecycleExpectedRunning(action);
  if (expectedRunning === undefined) {
    reply.header("Retry-After", "5");
    return reply.status(503).send({
      success: false,
      reconciled: false,
      error: lifecycleUnknownMessage(action)
    });
  }

  const state = await waitForLabRunningState(client, token, labName, expectedRunning);
  const canTrustState =
    action === "destroy" ||
    ((action === "deploy" || action === "apply") && preRunning === false);
  if (state.matched && canTrustState) {
    return reply.send({
      success: true,
      reconciled: true,
      result: {
        labName,
        running: state.running
      },
      message: `Lifecycle ${action} result reconciled after the upstream connection was interrupted.`,
      logs: []
    });
  }

  reply.header("Retry-After", "5");
  return reply.status(503).send({
    success: false,
    reconciled: false,
    running: state.running,
    error: lifecycleUnknownMessage(action)
  });
}

async function sendLifecycleJsonAction(
  reply: FastifyReply,
  client: ClabApiClient,
  token: string,
  labName: string,
  action: LifecycleStreamEndpoint,
  run: () => Promise<LifecycleActionResult>,
  options: { preRunning?: boolean } = {}
): Promise<FastifyReply> {
  try {
    const lifecycle = await run();
    return reply.send({
      success: true,
      result: lifecycle.result,
      message: lifecycle.message,
      logs: lifecycle.logs ?? []
    });
  } catch (error) {
    const reconciled = await reconcileIndeterminateLifecycleError(
      reply,
      error,
      client,
      token,
      labName,
      action,
      options.preRunning
    );
    if (reconciled) {
      return reconciled;
    }
    throw error;
  }
}

async function openAndForwardLifecycleStream(
  request: FastifyRequest,
  reply: FastifyReply,
  client: ClabApiClient,
  token: string,
  action: LifecycleStreamEndpoint,
  labName: string,
  options: LifecycleStreamOptions = {},
  reconcileOptions: { preRunning?: boolean } = {}
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
      const reconciled = await reconcileIndeterminateLifecycleError(
        reply,
        error,
        client,
        token,
        labName,
        action,
        reconcileOptions.preRunning
      );
      if (reconciled) {
        return reconciled;
      }
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
          return await sendLifecycleJsonAction(
            reply,
            client,
            endpoint.token,
            target.labName,
            action,
            () =>
              client.controlLabLifecycle(endpoint.token, target.labName, action, {
                includeLogs: true
              })
          );
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
        const preRunning = await client.isLabRunning(endpoint.token, target.labName).catch(() => undefined);
        return await sendLifecycleJsonAction(
          reply,
          client,
          endpoint.token,
          target.labName,
          "deploy",
          () =>
            client.deployLab(endpoint.token, target.labName, {
              path: target.yamlPath,
              cleanup: request.body.cleanup === true,
              includeLogs: true
            }),
          { preRunning }
        );
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
        const preRunning = await client.isLabRunning(endpoint.token, target.labName).catch(() => undefined);
        return await sendLifecycleJsonAction(
          reply,
          client,
          endpoint.token,
          target.labName,
          "destroy",
          () =>
            client.destroyLab(endpoint.token, target.labName, {
              cleanup: request.body.cleanup === true,
              includeLogs: true
            }),
          { preRunning }
        );
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
        return await sendLifecycleJsonAction(
          reply,
          client,
          endpoint.token,
          target.labName,
          "redeploy",
          () =>
            client.redeployLab(endpoint.token, target.labName, {
              cleanup: request.body.cleanup === true,
              includeLogs: true
            })
        );
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

  app.post<{ Body: LabApplyBody }>(
    "/api/lab/apply",
    async (request: FastifyRequest<{ Body: LabApplyBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(
        request,
        reply,
        request.body.endpointId ?? extractEndpointIdFromTopologyId(request.body.topologyRef?.topologyId)
      );
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const dirtyTarget = {
          endpointId: endpoint.id,
          labName: target.labName,
          yamlPath: target.yamlPath
        };

        if (request.body.dryRun === true) {
          const lifecycle = await client.applyLab(endpoint.token, target.labName, {
            path: target.yamlPath,
            dryRun: true
          });
          const changesPending = applyResultHasPendingChanges(lifecycle.result);
          if (changesPending !== undefined) {
            sessions.setDirtyForTopology(dirtyTarget, changesPending);
          }
          return reply.send({
            success: true,
            result: lifecycle.result,
            changesPending: changesPending ?? null,
            message: lifecycle.message,
            logs: []
          });
        }

        const preRunning = await client.isLabRunning(endpoint.token, target.labName).catch(() => undefined);
        return await sendLifecycleJsonAction(
          reply,
          client,
          endpoint.token,
          target.labName,
          "apply",
          async () => {
            const lifecycle = await client.applyLab(endpoint.token, target.labName, {
              path: target.yamlPath,
              includeLogs: true
            });
            sessions.setDirtyForTopology(dirtyTarget, false);
            return lifecycle;
          },
          { preRunning }
        );
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: LabApplyBody }>(
    "/api/lab/apply/stream",
    async (request: FastifyRequest<{ Body: LabApplyBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(
        request,
        reply,
        request.body.endpointId ?? extractEndpointIdFromTopologyId(request.body.topologyRef?.topologyId)
      );
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const preRunning = await client.isLabRunning(endpoint.token, target.labName).catch(() => undefined);
        return await openAndForwardLifecycleStream(
          request,
          reply,
          client,
          endpoint.token,
          "apply",
          target.labName,
          {
            path: target.yamlPath
          },
          { preRunning }
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

/**
 * Interpret a containerlab apply result (dry-run plan or applied summary):
 * `true` when applying would change or did change anything, `false` when the
 * lab is in sync, `undefined` when the payload shape is unknown.
 */
function applyResultHasPendingChanges(result: unknown): boolean | undefined {
  if (typeof result !== "object" || result === null) {
    return undefined;
  }
  const record = result as Record<string, unknown>;
  if (record.deployedLab === true) {
    return true;
  }
  const changeLists = [
    "addedNodes",
    "deletedNodes",
    "recreatedNodes",
    "startedNodes",
    "addedLinks",
    "deletedEndpoints",
    "restartedNodes"
  ];
  let sawList = false;
  for (const key of changeLists) {
    const value = record[key];
    if (Array.isArray(value)) {
      sawList = true;
      if (value.length > 0) {
        return true;
      }
    }
  }
  return sawList ? false : undefined;
}
