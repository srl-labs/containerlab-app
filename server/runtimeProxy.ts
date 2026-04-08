import type { TopologyRef } from "@srl-labs/clab-ui/session";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { ClabApiClient } from "./clabApiClient.js";
import type {
  InspectContainerInfo,
  NetemResetRequest,
  NetemSetRequest,
  TerminalProtocol
} from "./clabApiClient.js";
import type { EndpointEntry } from "./endpointSessionStore.js";
import { getEndpointIdFromRequest } from "./middleware.js";
import {
  deleteCaptureSessionEndpoint,
  getCaptureSessionEndpoint,
  setCaptureSessionEndpoint
} from "./captureSessionStore.js";
import {
  buildStandaloneTopologyRef,
  extractEndpointIdFromTopologyId,
  resolveCanonicalStandaloneTopologyRef
} from "./topologyIdentity.js";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.js";

interface RuntimeTargetBody {
  endpointId?: string;
  sessionId?: string;
  topologyRef?: TopologyRef;
}

interface SaveBody extends RuntimeTargetBody {
  nodeName?: string;
}

interface NodeBody extends RuntimeTargetBody {
  nodeName: string;
  duration?: string;
  sshUsername?: string;
  tail?: string;
}

interface TerminalBody extends RuntimeTargetBody {
  nodeName: string;
  protocol: TerminalProtocol;
  cols?: number;
  rows?: number;
  sshUsername?: string;
  telnetPort?: number;
}

interface NetemBody extends RuntimeTargetBody {
  nodeName: string;
  interfaceName?: string;
  delay?: string;
  jitter?: string;
  loss?: number;
  rate?: number;
  corruption?: number;
}

interface CaptureTargetBody {
  containerName: string;
  interfaceName: string;
}

interface CapturePacketflixBody extends RuntimeTargetBody {
  targets: CaptureTargetBody[];
  remoteHostname?: string;
}

interface CaptureWiresharkVncBody extends RuntimeTargetBody {
  targets: CaptureTargetBody[];
  theme?: string;
}

interface CreateTopologyFileBody extends RuntimeTargetBody {
  content?: string;
  fileName: string;
}

interface UiCustomNodeDefaultBody {
  name: string;
}

interface UiIconUploadBody {
  fileName: string;
  contentType?: string;
  dataBase64: string;
}

interface UiIconListBody extends RuntimeTargetBody {}

interface UiIconReconcileBody extends RuntimeTargetBody {
  usedIcons?: string[];
}

type EndpointResolver = (
  request: FastifyRequest,
  reply: FastifyReply,
  endpointId?: string
) => { client: ClabApiClient; endpoint: EndpointEntry } | null;

type EndpointListResolver = (request: FastifyRequest, reply: FastifyReply) => EndpointEntry[];

interface ResolvedLabTarget {
  labName: string;
  topologyRef?: TopologyRef;
  yamlPath?: string;
}

class RequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

function handleRouteError(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RequestError) {
    return reply.status(error.statusCode).send({ error: message });
  }
  return reply.status(500).send({ error: message });
}

function resolveRequestedEndpointId(target?: RuntimeTargetBody): string | undefined {
  return target?.endpointId ?? extractEndpointIdFromTopologyId(target?.topologyRef?.topologyId);
}

function resolveEndpointForCaptureSession(
  request: FastifyRequest,
  reply: FastifyReply,
  resolveEndpoint: EndpointResolver,
  sessionId: string
): { client: ClabApiClient; endpoint: EndpointEntry } | null {
  const explicitEndpointId = getEndpointIdFromRequest(request);
  if (explicitEndpointId) {
    const explicit = resolveEndpoint(request, reply, explicitEndpointId);
    if (explicit) {
      setCaptureSessionEndpoint(sessionId, explicit.endpoint.id);
      return explicit;
    }
  }

  const mappedEndpointId = getCaptureSessionEndpoint(sessionId);
  if (mappedEndpointId) {
    const mapped = resolveEndpoint(request, reply, mappedEndpointId);
    if (mapped) {
      return mapped;
    }
  }

  return resolveEndpoint(request, reply);
}

async function resolveLabTarget(
  endpoint: EndpointEntry,
  client: ClabApiClient,
  sessions: StandaloneTopologySessionManager,
  target: RuntimeTargetBody
): Promise<ResolvedLabTarget> {
  const sessionId = target.sessionId?.trim() ?? "";
  if (sessionId) {
    const session = sessions.getSession(sessionId, endpoint.id);
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
    const topologyRef = await resolveCanonicalStandaloneTopologyRef(
      client,
      endpoint.token,
      target.topologyRef,
      endpoint.id
    );
    return {
      labName: topologyRef.labName,
      topologyRef,
      yamlPath: topologyRef.yamlPath
    };
  }

  throw new RequestError("Missing topologyRef or sessionId", 400);
}

function stripContainerPrefix(labName: string, containerName: string): string {
  const prefix = `clab-${labName}-`;
  return containerName.startsWith(prefix) ? containerName.slice(prefix.length) : containerName;
}

function scoreNodeMatch(labName: string, containerName: string, requestedNodeName: string): number {
  const normalizedContainer = containerName.trim().toLowerCase();
  const normalizedRequested = requestedNodeName.trim().toLowerCase();
  if (!normalizedRequested || !normalizedContainer) {
    return 0;
  }
  if (normalizedContainer === normalizedRequested) {
    return 100;
  }

  const shortName = stripContainerPrefix(labName.trim().toLowerCase(), normalizedContainer);
  if (shortName === normalizedRequested) {
    return 90;
  }
  if (shortName.startsWith(`${normalizedRequested}-`)) {
    return 80;
  }
  if (normalizedContainer.endsWith(`-${normalizedRequested}`)) {
    return 70;
  }

  return 0;
}

async function resolveNodeTarget(
  client: ClabApiClient,
  token: string,
  labName: string,
  requestedNodeName: string
): Promise<{ container: InspectContainerInfo; nodeFilter: string }> {
  const nodeName = requestedNodeName.trim();
  if (!nodeName) {
    throw new RequestError("Missing nodeName", 400);
  }

  const containers = await client.inspectLab(token, labName);
  let bestMatch: InspectContainerInfo | null = null;
  let bestScore = 0;

  for (const container of containers) {
    const score = scoreNodeMatch(labName, container.name, nodeName);
    if (score > bestScore) {
      bestMatch = container;
      bestScore = score;
    }
  }

  if (!bestMatch || bestScore === 0) {
    throw new RequestError(`Node "${nodeName}" was not found in lab "${labName}".`, 404);
  }

  return {
    container: bestMatch,
    nodeFilter: stripContainerPrefix(labName, bestMatch.name)
  };
}

function parseOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeOptionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function normalizeCaptureTargets(rawTargets: unknown): Array<{ containerName: string; interfaceName: string }> {
  if (!Array.isArray(rawTargets)) {
    return [];
  }

  const targets: Array<{ containerName: string; interfaceName: string }> = [];
  for (const target of rawTargets) {
    if (typeof target !== "object" || target === null) {
      continue;
    }
    const containerName =
      typeof (target as { containerName?: unknown }).containerName === "string"
        ? (target as { containerName: string }).containerName.trim()
        : "";
    const interfaceName =
      typeof (target as { interfaceName?: unknown }).interfaceName === "string"
        ? (target as { interfaceName: string }).interfaceName.trim()
        : "";
    if (!containerName || !interfaceName) {
      continue;
    }
    targets.push({ containerName, interfaceName });
  }
  return targets;
}

async function resolveCaptureTargets(
  client: ClabApiClient,
  token: string,
  labName: string,
  rawTargets: unknown
): Promise<Array<{ containerName: string; interfaceName: string }>> {
  const targets = normalizeCaptureTargets(rawTargets);
  if (targets.length === 0) {
    return targets;
  }

  const containers = await client.inspectLab(token, labName);
  if (containers.length === 0) {
    return targets;
  }

  return targets.map((target) => {
    let bestMatch: InspectContainerInfo | null = null;
    let bestScore = 0;
    for (const container of containers) {
      const score = scoreNodeMatch(labName, container.name, target.containerName);
      if (score > bestScore) {
        bestMatch = container;
        bestScore = score;
      }
    }

    if (!bestMatch || bestScore === 0) {
      return target;
    }
    return {
      containerName: bestMatch.name,
      interfaceName: target.interfaceName
    };
  });
}

function stripTopologySuffix(name: string): string {
  return name.replace(/\.clab\.(ya?ml)$/i, "");
}

function validateTopologyFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new RequestError("File name is required", 400);
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new RequestError("File name must not include path separators", 400);
  }
  if (!/\.clab\.(yml|yaml)$/i.test(trimmed)) {
    throw new RequestError("File name must end with .clab.yml or .clab.yaml", 400);
  }
  return trimmed;
}

function buildDefaultTopologyContent(labName: string): string {
  return `name: ${labName}\ntopology:\n  nodes: {}\n`;
}

function mergeInspectAllResponses(
  entries: Array<{ endpoint: EndpointEntry; labs: Record<string, InspectContainerInfo[]> }>
): Record<string, InspectContainerInfo[]> {
  if (entries.length <= 1) {
    return entries[0]?.labs ?? {};
  }

  const merged: Record<string, InspectContainerInfo[]> = {};
  for (const { endpoint, labs } of entries) {
    for (const [labName, containers] of Object.entries(labs)) {
      merged[`${labName} @ ${endpoint.label}`] = containers;
    }
  }
  return merged;
}

export function registerRuntimeProxy(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
  listEndpoints: EndpointListResolver,
  sessions: StandaloneTopologySessionManager
): void {
  app.get("/api/runtime/inspect/all", async (request, reply) => {
    const requestedEndpointId = getEndpointIdFromRequest(request);
    const specific = requestedEndpointId
      ? resolveEndpoint(request, reply, requestedEndpointId)
      : null;
    if (requestedEndpointId) {
      if (!specific) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      try {
        return reply.send(await specific.client.listLabs(specific.endpoint.token));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }

    const endpoints = listEndpoints(request, reply);
    if (endpoints.length === 0) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    try {
      const responses = await Promise.all(
        endpoints.map(async (endpoint) => ({
          endpoint,
          labs: await new ClabApiClient({ baseUrl: endpoint.url }).listLabs(endpoint.token)
        }))
      );
      return reply.send(mergeInspectAllResponses(responses));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post<{ Body: RuntimeTargetBody }>(
    "/api/runtime/inspect/lab",
    async (request: FastifyRequest<{ Body: RuntimeTargetBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const lab = await client.inspectLab(endpoint.token, target.labName);
        return reply.send(lab);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: SaveBody }>(
    "/api/runtime/save",
    async (request: FastifyRequest<{ Body: SaveBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        let nodeFilter: string | undefined;

        if (typeof request.body.nodeName === "string" && request.body.nodeName.trim().length > 0) {
          const resolvedNode = await resolveNodeTarget(
            client,
            endpoint.token,
            target.labName,
            request.body.nodeName
          );
          nodeFilter = resolvedNode.nodeFilter;
        }

        const result = await client.saveLab(endpoint.token, target.labName, { nodeFilter });
        return reply.send(result);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: NodeBody }>(
    "/api/runtime/ssh",
    async (request: FastifyRequest<{ Body: NodeBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(
          client,
          endpoint.token,
          target.labName,
          request.body.nodeName
        );
        const sshAccess = await client.requestSshAccess(
          endpoint.token,
          target.labName,
          resolvedNode.container.name,
          {
            duration: normalizeOptionalString(request.body.duration),
            sshUsername: normalizeOptionalString(request.body.sshUsername)
          }
        );
        return reply.send(sshAccess);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: NodeBody }>(
    "/api/runtime/logs",
    async (request: FastifyRequest<{ Body: NodeBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(
          client,
          endpoint.token,
          target.labName,
          request.body.nodeName
        );
        const logs = await client.getNodeLogs(endpoint.token, target.labName, resolvedNode.container.name, {
          tail: normalizeOptionalString(request.body.tail) ?? "200"
        });
        return reply.send(logs);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: TerminalBody }>(
    "/api/runtime/terminal-sessions",
    async (request: FastifyRequest<{ Body: TerminalBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(
          client,
          endpoint.token,
          target.labName,
          request.body.nodeName
        );
        const session = await client.createTerminalSession(
          endpoint.token,
          target.labName,
          resolvedNode.container.name,
          {
            protocol: request.body.protocol,
            cols: normalizeOptionalInteger(request.body.cols) ?? 120,
            rows: normalizeOptionalInteger(request.body.rows) ?? 36,
            sshUsername: normalizeOptionalString(request.body.sshUsername),
            telnetPort: normalizeOptionalInteger(request.body.telnetPort)
          }
        );
        return reply.send(session);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/runtime/terminal-sessions/:sessionId",
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const session = await resolved.client.getTerminalSession(
          resolved.endpoint.token,
          request.params.sessionId
        );
        return reply.send(session);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.delete<{ Params: { sessionId: string } }>(
    "/api/runtime/terminal-sessions/:sessionId",
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        await resolved.client.deleteTerminalSession(resolved.endpoint.token, request.params.sessionId);
        return reply.send({ success: true });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: NetemBody }>(
    "/api/runtime/netem/show",
    async (request: FastifyRequest<{ Body: NetemBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(
          client,
          endpoint.token,
          target.labName,
          request.body.nodeName
        );
        const impairments = await client.showNetem(endpoint.token, resolvedNode.container.name);
        return reply.send({
          containerName: resolvedNode.container.name,
          impairments
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: NetemBody }>(
    "/api/runtime/netem/set",
    async (request: FastifyRequest<{ Body: NetemBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const interfaceName = normalizeOptionalString(request.body.interfaceName);
        if (!interfaceName) {
          throw new RequestError("Missing interfaceName", 400);
        }

        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(
          client,
          endpoint.token,
          target.labName,
          request.body.nodeName
        );
        const netemRequest: NetemSetRequest = {
          containerName: resolvedNode.container.name,
          interface: interfaceName,
          delay: normalizeOptionalString(request.body.delay),
          jitter: normalizeOptionalString(request.body.jitter),
          loss: parseOptionalNumber(request.body.loss),
          rate: parseOptionalNumber(request.body.rate),
          corruption: parseOptionalNumber(request.body.corruption)
        };
        await client.setNetem(endpoint.token, netemRequest);
        return reply.send({ success: true });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: NetemBody }>(
    "/api/runtime/netem/reset",
    async (request: FastifyRequest<{ Body: NetemBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const interfaceName = normalizeOptionalString(request.body.interfaceName);
        if (!interfaceName) {
          throw new RequestError("Missing interfaceName", 400);
        }

        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(
          client,
          endpoint.token,
          target.labName,
          request.body.nodeName
        );
        const netemRequest: NetemResetRequest = {
          containerName: resolvedNode.container.name,
          interface: interfaceName
        };
        await client.resetNetem(endpoint.token, netemRequest);
        return reply.send({ success: true });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.get("/api/runtime/capture/edgeshark/status", async (request, reply) => {
    const resolved = resolveEndpoint(request, reply);
    if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

    try {
      return reply.send(await resolved.client.getEdgeSharkStatus(resolved.endpoint.token));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post(
    "/api/runtime/capture/edgeshark/install",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        await resolved.client.installEdgeShark(resolved.endpoint.token);
        return reply.send({ success: true });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post(
    "/api/runtime/capture/edgeshark/uninstall",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        await resolved.client.uninstallEdgeShark(resolved.endpoint.token);
        return reply.send({ success: true });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: CapturePacketflixBody }>(
    "/api/runtime/capture/packetflix",
    async (request: FastifyRequest<{ Body: CapturePacketflixBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const targets = await resolveCaptureTargets(
          client,
          endpoint.token,
          target.labName,
          request.body.targets
        );
        if (targets.length === 0) {
          throw new RequestError("At least one capture target is required", 400);
        }
        const remoteHostname = normalizeOptionalString(request.body.remoteHostname);
        const payload = await client.buildPacketflixCapture(endpoint.token, target.labName, {
          targets,
          remoteHostname
        });
        return reply.send(payload);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: CaptureWiresharkVncBody }>(
    "/api/runtime/capture/wireshark-vnc-sessions",
    async (request: FastifyRequest<{ Body: CaptureWiresharkVncBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        const targets = await resolveCaptureTargets(
          client,
          endpoint.token,
          target.labName,
          request.body.targets
        );
        if (targets.length === 0) {
          throw new RequestError("At least one capture target is required", 400);
        }
        const theme = normalizeOptionalString(request.body.theme);
        const payload = await client.createWiresharkVncSessions(endpoint.token, target.labName, {
          targets,
          theme
        });
        for (const session of payload.sessions ?? []) {
          setCaptureSessionEndpoint(session.sessionId, endpoint.id);
        }
        return reply.send(payload);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/runtime/capture/wireshark-vnc-sessions/:sessionId/ready",
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const resolved = resolveEndpointForCaptureSession(
        request,
        reply,
        resolveEndpoint,
        request.params.sessionId
      );
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const payload = await resolved.client.getWiresharkVncSessionReady(
          resolved.endpoint.token,
          request.params.sessionId
        );
        return reply.send({
          ...payload,
          url: `/api/runtime/capture/wireshark-vnc-sessions/${encodeURIComponent(request.params.sessionId)}/vnc/`
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  const closeCaptureSession = async (
    request: FastifyRequest<{ Params: { sessionId: string } }>,
    reply: FastifyReply
  ) => {
    const resolved = resolveEndpointForCaptureSession(
      request,
      reply,
      resolveEndpoint,
      request.params.sessionId
    );
    if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

    try {
      await resolved.client.deleteWiresharkVncSession(resolved.endpoint.token, request.params.sessionId);
      deleteCaptureSessionEndpoint(request.params.sessionId);
      return reply.send({ success: true });
    } catch (error) {
      return handleRouteError(reply, error);
    }
  };

  app.delete<{ Params: { sessionId: string } }>(
    "/api/runtime/capture/wireshark-vnc-sessions/:sessionId",
    closeCaptureSession
  );

  app.post<{ Params: { sessionId: string } }>(
    "/api/runtime/capture/wireshark-vnc-sessions/:sessionId/close",
    closeCaptureSession
  );

  app.route<{ Params: { sessionId: string; "*": string } }>({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    url: "/api/runtime/capture/wireshark-vnc-sessions/:sessionId/vnc/*",
    async handler(request, reply) {
      const resolved = resolveEndpointForCaptureSession(
        request,
        reply,
        resolveEndpoint,
        request.params.sessionId
      );
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const wildcard = request.params["*"] ?? "";
        const suffix = wildcard.length > 0 ? `/${wildcard}` : "/";
        const rawUrl = request.raw.url ?? "";
        const queryIndex = rawUrl.indexOf("?");
        const query = queryIndex >= 0 ? rawUrl.slice(queryIndex) : "";
        const upstreamUrl =
          `${resolved.client.getBaseUrl()}` +
          `/api/v1/capture/wireshark-vnc-sessions/${encodeURIComponent(request.params.sessionId)}` +
          `/vnc${suffix}${query}`;

        const headers: Record<string, string> = {
          Authorization: `Bearer ${resolved.endpoint.token}`
        };
        for (const [key, value] of Object.entries(request.headers)) {
          if (typeof value !== "string") {
            continue;
          }
          const lower = key.toLowerCase();
          if (lower === "host" || lower === "authorization" || lower === "content-length") {
            continue;
          }
          headers[key] = value;
        }

        const upstreamResponse = await fetch(upstreamUrl, {
          method: request.method,
          headers
        });

        reply.status(upstreamResponse.status);
        for (const [key, value] of upstreamResponse.headers.entries()) {
          const lower = key.toLowerCase();
          if (lower === "transfer-encoding" || lower === "connection") {
            continue;
          }
          reply.header(key, value);
        }

        const body = await upstreamResponse.arrayBuffer();
        return reply.send(Buffer.from(body));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  });

  app.get("/api/runtime/version", async (request, reply) => {
    const resolved = resolveEndpoint(request, reply);
    if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

    try {
      return reply.send(await resolved.client.getVersion(resolved.endpoint.token));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/runtime/version/check", async (request, reply) => {
    const resolved = resolveEndpoint(request, reply);
    if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

    try {
      return reply.send(await resolved.client.checkVersion(resolved.endpoint.token));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/runtime/ui/custom-nodes", async (request, reply) => {
    const resolved = resolveEndpoint(request, reply);
    if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

    try {
      return reply.send(await resolved.client.getCustomNodes(resolved.endpoint.token));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post<{ Body: Record<string, unknown> }>(
    "/api/runtime/ui/custom-nodes",
    async (request: FastifyRequest<{ Body: Record<string, unknown> }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        return reply.send(await resolved.client.saveCustomNode(resolved.endpoint.token, request.body));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.delete<{ Params: { name: string } }>(
    "/api/runtime/ui/custom-nodes/:name",
    async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        return reply.send(await resolved.client.deleteCustomNode(resolved.endpoint.token, request.params.name));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: UiCustomNodeDefaultBody }>(
    "/api/runtime/ui/custom-nodes/default",
    async (request: FastifyRequest<{ Body: UiCustomNodeDefaultBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const name = normalizeOptionalString(request.body.name);
        if (!name) {
          throw new RequestError("Missing custom node name", 400);
        }
        return reply.send(await resolved.client.setDefaultCustomNode(resolved.endpoint.token, name));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: UiIconListBody }>(
    "/api/runtime/ui/icons/list",
    async (request: FastifyRequest<{ Body: UiIconListBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const target = await resolveLabTarget(resolved.endpoint, resolved.client, sessions, request.body);
        return reply.send(await resolved.client.listLabIcons(resolved.endpoint.token, target.labName));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: UiIconUploadBody }>(
    "/api/runtime/ui/icons",
    async (request: FastifyRequest<{ Body: UiIconUploadBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        return reply.send(await resolved.client.uploadGlobalIcon(resolved.endpoint.token, request.body));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.delete<{ Params: { iconName: string } }>(
    "/api/runtime/ui/icons/:iconName",
    async (request: FastifyRequest<{ Params: { iconName: string } }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        await resolved.client.deleteGlobalIcon(resolved.endpoint.token, request.params.iconName);
        return reply.send({ success: true });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: UiIconReconcileBody }>(
    "/api/runtime/ui/icons/reconcile",
    async (request: FastifyRequest<{ Body: UiIconReconcileBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const target = await resolveLabTarget(resolved.endpoint, resolved.client, sessions, request.body);
        const usedIcons = Array.isArray(request.body.usedIcons)
          ? request.body.usedIcons.filter((value): value is string => typeof value === "string")
          : [];
        await resolved.client.reconcileLabIcons(resolved.endpoint.token, target.labName, usedIcons);
        return reply.send({ success: true });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: CreateTopologyFileBody }>(
    "/api/runtime/topology-file/create",
    async (request: FastifyRequest<{ Body: CreateTopologyFileBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const fileName = validateTopologyFileName(request.body.fileName);
        const labName = stripTopologySuffix(fileName);
        if (await client.headFile(endpoint.token, labName, fileName)) {
          throw new RequestError(`Topology file "${fileName}" already exists.`, 409);
        }

        const content =
          normalizeOptionalString(request.body.content) ?? buildDefaultTopologyContent(labName);
        await client.putFile(endpoint.token, labName, fileName, content);

        const topologies = await client.listTopologies(endpoint.token);
        const topologyEntry = topologies.find(
          (entry) => entry.labName === labName && entry.yamlFileName === fileName
        );

        return reply.send({
          success: true,
          topologyRef: topologyEntry
            ? buildStandaloneTopologyRef(topologyEntry, endpoint.id)
            : buildStandaloneTopologyRef(
                {
                  annotationsFileName: `${fileName}.annotations.json`,
                  hasAnnotations: false,
                  labName,
                  yamlFileName: fileName
                },
                endpoint.id
              )
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: RuntimeTargetBody }>(
    "/api/runtime/topology-file/delete",
    async (request: FastifyRequest<{ Body: RuntimeTargetBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { client, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, client, sessions, request.body);
        if (!target.yamlPath) {
          throw new RequestError("Missing topology file path", 400);
        }
        await client.deleteFile(endpoint.token, target.labName, target.yamlPath);
        return reply.send({ success: true, path: target.yamlPath });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );
}
