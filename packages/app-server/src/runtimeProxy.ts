import type { TopologyRef } from "@containerlab/clab-ui/session";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  CaptureTarget,
  InspectContainerInfo,
  LabBackend,
  NetemResetRequest,
  NetemSetRequest,
  NodeLifecycleAction,
  RuntimeImageActionResponse,
  RuntimeImagesResponse,
  ShareToolAction,
  TerminalProtocol
} from "@srl-labs/containerlab-lab-backend";
import { getHttpErrorStatus } from "@srl-labs/containerlab-lab-backend/api";

import type { EndpointListResolver, EndpointResolver, ResolvedEndpoint } from "./endpointResolver.ts";
import type { EndpointEntry } from "./endpointSessionStore.ts";
import { getEndpointIdFromRequest } from "./middleware.ts";
import {
  deleteCaptureSessionsForEndpoint,
  deleteCaptureSessionEndpoint,
  getCaptureSessionEndpoint,
  setCaptureSessionEndpoint
} from "./captureSessionStore.ts";
import {
  buildStandaloneTopologyRef,
  extractEndpointIdFromTopologyId,
  resolveCanonicalStandaloneTopologyRef,
  resolveRunningLabNameForTopology
} from "./topologyIdentity.ts";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.ts";
import { resolveTopologySshUsername } from "./topologyCredentials.ts";

export interface RuntimeTargetBody {
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

interface NodeLifecycleBody extends RuntimeTargetBody {
  nodeName: string;
}

interface NodeBrowserBody extends RuntimeTargetBody {
  nodeName: string;
}

interface ShareActionBody extends RuntimeTargetBody {
  port?: number;
}

interface FcliBody extends RuntimeTargetBody {
  command: string;
}

interface DrawioBody extends RuntimeTargetBody {
  layout?: "horizontal" | "vertical" | "interactive";
  theme?: string;
}

const POPULAR_REPOS_SEARCH_URL =
  "https://api.github.com/search/repositories?q=topic:clab-topo+org:srl-labs+fork:true&sort=stars&order=desc";

interface CaptureTargetBody {
  containerName: string;
  interfaceName: string;
  nodeNamespace?: boolean;
}

interface CapturePacketflixBody extends RuntimeTargetBody {
  targets: CaptureTargetBody[];
  remoteHostname?: string;
}

interface CaptureWiresharkVncBody extends RuntimeTargetBody {
  targets: CaptureTargetBody[];
  theme?: string;
}

interface DeployFromUrlBody extends RuntimeTargetBody {
  topologySourceUrl: string;
  labNameOverride?: string;
}

interface RuntimeImagePullBody extends RuntimeTargetBody {
  image?: string;
}

interface RuntimeImageRemoveBody extends RuntimeTargetBody {
  reference?: string;
  force?: boolean;
}

interface ImportTopologyFromUrlBody extends RuntimeTargetBody {
  topologySourceUrl: string;
  labNameOverride?: string;
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


interface ResolvedLabTarget {
  labName: string;
  topologyRef?: TopologyRef;
  yamlPath?: string;
}

export class RequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

export function handleRouteError(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RequestError) {
    return reply.status(error.statusCode).send({ error: message });
  }
  return reply.status(getHttpErrorStatus(error) ?? 500).send({ error: message });
}

export function resolveRequestedEndpointId(target?: RuntimeTargetBody): string | undefined {
  return target?.endpointId ?? extractEndpointIdFromTopologyId(target?.topologyRef?.topologyId);
}

function resolveEndpointForCaptureSession(
  request: FastifyRequest,
  reply: FastifyReply,
  resolveEndpoint: EndpointResolver,
  sessionId: string
): ResolvedEndpoint | null {
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

export async function resolveLabTarget(
  endpoint: EndpointEntry,
  backend: LabBackend,
  sessions: StandaloneTopologySessionManager,
  target: RuntimeTargetBody
): Promise<ResolvedLabTarget> {
  const sessionId = target.sessionId?.trim() ?? "";
  if (sessionId) {
    const session = sessions.getSession(sessionId, endpoint.id);
    if (!session) {
      throw new RequestError("Topology session not found", 404);
    }
    const labName = await resolveRunningLabNameForTopology(
      backend,
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
      backend,
      target.topologyRef,
      endpoint.id
    );
    const labName = await resolveRunningLabNameForTopology(
      backend,
      topologyRef,
      topologyRef.labName
    );
    return { labName, topologyRef, yamlPath: topologyRef.yamlPath };
  }

  throw new RequestError("Missing topologyRef or sessionId", 400);
}

function stripContainerPrefix(labName: string, containerName: string): string {
  const trimmed = containerName.trim();
  const normalizedLab = labName.trim().toLowerCase();
  if (!trimmed || !normalizedLab) {
    return trimmed;
  }

  const normalizedName = trimmed.toLowerCase();
  const defaultPrefix = `clab-${normalizedLab}-`;
  if (normalizedName.startsWith(defaultPrefix)) {
    return trimmed.slice(defaultPrefix.length);
  }

  const labPrefix = `${normalizedLab}-`;
  if (normalizedName.startsWith(labPrefix)) {
    return trimmed.slice(labPrefix.length);
  }

  const labSegment = `-${normalizedLab}-`;
  const segmentIndex = normalizedName.lastIndexOf(labSegment);
  if (segmentIndex >= 0) {
    return trimmed.slice(segmentIndex + labSegment.length);
  }

  return trimmed;
}

function nodeNameCandidates(labName: string, value: string): string[] {
  const candidates = new Set<string>();
  const normalized = value.trim().toLowerCase();
  if (normalized) {
    candidates.add(normalized);
  }

  const stripped = stripContainerPrefix(labName, value).trim().toLowerCase();
  if (stripped) {
    candidates.add(stripped);
  }

  return [...candidates];
}

function scoreNodeMatch(labName: string, containerName: string, requestedNodeName: string): number {
  const normalizedContainer = containerName.trim().toLowerCase();
  const requestedCandidates = nodeNameCandidates(labName, requestedNodeName);
  const containerCandidates = nodeNameCandidates(labName, containerName);
  if (requestedCandidates.length === 0 || !normalizedContainer) {
    return 0;
  }
  if (requestedCandidates.includes(normalizedContainer)) {
    return 100;
  }

  for (const requested of requestedCandidates) {
    if (containerCandidates.includes(requested)) {
      return 90;
    }
    if (containerCandidates.some((candidate) => candidate.startsWith(`${requested}-`))) {
      return 80;
    }
    if (normalizedContainer.endsWith(`-${requested}`)) {
      return 70;
    }
  }

  return 0;
}

export async function resolveNodeTarget(
  backend: LabBackend,
  labName: string,
  requestedNodeName: string
): Promise<{ container: InspectContainerInfo; nodeFilter: string }> {
  const nodeName = requestedNodeName.trim();
  if (!nodeName) {
    throw new RequestError("Missing nodeName", 400);
  }

  const containers = await backend.inspectLab(labName);
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

/**
 * SSH login for a node: the username the lab's topology `credentials` give it,
 * otherwise the one the client asked for (its per-kind setting).
 */
async function resolveSshUsername(
  backend: LabBackend,
  labName: string,
  node: { nodeFilter: string },
  body: { nodeName: string; sshUsername?: unknown }
): Promise<string | undefined> {
  const topologyUsername = await resolveTopologySshUsername(backend, labName, [
    node.nodeFilter,
    body.nodeName.trim()
  ]);
  return topologyUsername ?? normalizeOptionalString(body.sshUsername);
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

function normalizeNodeLifecycleAction(value: unknown): NodeLifecycleAction | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  switch (value.trim().toLowerCase()) {
    case "start":
    case "stop":
    case "restart":
    case "pause":
    case "unpause":
      return value.trim().toLowerCase() as NodeLifecycleAction;
    default:
      return undefined;
  }
}

function normalizeShareToolAction(value: unknown): ShareToolAction | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  switch (value.trim().toLowerCase()) {
    case "attach":
    case "detach":
    case "reattach":
      return value.trim().toLowerCase() as ShareToolAction;
    default:
      return undefined;
  }
}

function endpointHostname(endpointUrl: string): string | undefined {
  if (endpointUrl.startsWith("local:")) {
    // Labs of a local endpoint publish their ports on this machine.
    return "localhost";
  }
  try {
    return new URL(endpointUrl).hostname || undefined;
  } catch {
    return undefined;
  }
}

function normalizeHostForEndpoint(host: string | undefined, endpointUrl: string): string | undefined {
  const trimmed = host?.trim() ?? "";
  const endpointHost = endpointHostname(endpointUrl);
  if (!trimmed) {
    return endpointHost;
  }

  const lowered = trimmed.toLowerCase();
  if (
    lowered === "host_ip" ||
    lowered === "localhost" ||
    lowered === "127.0.0.1" ||
    lowered === "::1" ||
    lowered === "0.0.0.0" ||
    lowered === "::"
  ) {
    return endpointHost ?? trimmed;
  }

  return trimmed;
}

function rewriteShareLinkForEndpoint(link: string | undefined, endpointUrl: string): string | undefined {
  const raw = link?.trim();
  if (!raw) {
    return undefined;
  }

  if (raw.includes("HOST_IP")) {
    const endpointHost = endpointHostname(endpointUrl);
    if (endpointHost) {
      return raw.replaceAll("HOST_IP", endpointHost);
    }
  }

  try {
    const parsed = new URL(raw);
    const normalizedHost = normalizeHostForEndpoint(parsed.hostname, endpointUrl);
    if (!normalizedHost) {
      return raw;
    }
    parsed.hostname = normalizedHost;
    return parsed.toString();
  } catch {
    return raw;
  }
}

function normalizeCaptureTargets(rawTargets: unknown): CaptureTarget[] {
  if (!Array.isArray(rawTargets)) {
    return [];
  }

  const targets: CaptureTarget[] = [];
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
    const nodeNamespace = (target as { nodeNamespace?: unknown }).nodeNamespace === true;
    targets.push({ containerName, interfaceName, ...(nodeNamespace ? { nodeNamespace } : {}) });
  }
  return targets;
}

async function resolveCaptureTargets(
  backend: LabBackend,
  labName: string,
  rawTargets: unknown
): Promise<CaptureTarget[]> {
  const targets = normalizeCaptureTargets(rawTargets);
  if (targets.length === 0) {
    return targets;
  }

  const containers = await backend.inspectLab(labName);
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
    return { ...target, containerName: bestMatch.name };
  });
}

function stripTopologySuffix(name: string): string {
  return name.replace(/\.clab\.(?:ya?ml|gotmpl)$/i, "");
}

function validateTopologyFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new RequestError("File name is required", 400);
  }
  if (trimmed.includes("\\") || trimmed.includes("\0") || trimmed.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new RequestError("File path must stay inside the lab workspace", 400);
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
        return reply.send(await specific.backend.inspectAll());
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
        endpoints.map(async (endpoint) => {
          const resolvedEndpoint = resolveEndpoint(request, reply, endpoint.id);
          return {
            endpoint,
            labs: resolvedEndpoint ? await resolvedEndpoint.backend.inspectAll() : {}
          };
        })
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
        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        const lab = await backend.inspectLab(target.labName);
        return reply.send(lab);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  // { supported: false } when the lab host cannot report it (the local containerlab).
  app.post<{ Body: RuntimeTargetBody }>(
    "/api/runtime/tailscale",
    async (request: FastifyRequest<{ Body: RuntimeTargetBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { backend, endpoint } = resolved;
        if (!backend.capabilities.tailscaleStatus) return reply.send({ supported: false });
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        const status = await backend.tailscaleStatus(target.labName);
        return reply.send({ supported: true, status });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.get("/api/runtime/popular-repos", async (request, reply) => {
    const endpoints = listEndpoints(request, reply);
    if (endpoints.length === 0) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    try {
      const response = await fetch(POPULAR_REPOS_SEARCH_URL, {
        headers: {
          Accept: "application/vnd.github+json"
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch popular repositories: ${response.status} ${response.statusText}`);
      }
      return reply.send(await response.json());
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/runtime/images", async (request, reply) => {
    const resolved = resolveEndpoint(request, reply, getEndpointIdFromRequest(request));
    if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

    try {
      const response: RuntimeImagesResponse = await resolved.backend.listImages();
      return reply.send(response);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post<{ Body: RuntimeImagePullBody }>(
    "/api/runtime/images/pull",
    async (request: FastifyRequest<{ Body: RuntimeImagePullBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const image = normalizeOptionalString(request.body.image);
        if (!image) {
          throw new RequestError("Missing image reference", 400);
        }
        const response: RuntimeImageActionResponse = await resolved.backend.pullImage(image);
        return reply.send(response);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: RuntimeImageRemoveBody }>(
    "/api/runtime/images/remove",
    async (request: FastifyRequest<{ Body: RuntimeImageRemoveBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const reference = normalizeOptionalString(request.body.reference);
        if (!reference) {
          throw new RequestError("Missing image reference", 400);
        }
        const response: RuntimeImageActionResponse = await resolved.backend.removeImage(
          reference,
          request.body.force === true
        );
        return reply.send(response);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: DeployFromUrlBody }>(
    "/api/runtime/labs/deploy-from-url",
    async (request: FastifyRequest<{ Body: DeployFromUrlBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const topologySourceUrl = normalizeOptionalString(request.body.topologySourceUrl);
        if (!topologySourceUrl) {
          throw new RequestError("Missing topologySourceUrl", 400);
        }
        const { backend } = resolved;
        const deployed = await backend.deployFromUrl({
          url: topologySourceUrl,
          labName: normalizeOptionalString(request.body.labNameOverride)
        });
        return reply.send({
          success: true,
          labNames: Object.keys(deployed).filter((name) => name.trim().length > 0)
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: ImportTopologyFromUrlBody }>(
    "/api/runtime/topology-file/import-from-url",
    async (request: FastifyRequest<{ Body: ImportTopologyFromUrlBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const topologySourceUrl = normalizeOptionalString(request.body.topologySourceUrl);
        if (!topologySourceUrl) {
          throw new RequestError("Missing topologySourceUrl", 400);
        }

        const { backend, endpoint } = resolved;
        const imported = await backend.importTopologyFromUrl({
          url: topologySourceUrl,
          labName: normalizeOptionalString(request.body.labNameOverride)
        });

        return reply.send({
          success: imported.success,
          labName: imported.labName,
          fileName: imported.fileName,
          topologyRef: buildStandaloneTopologyRef(imported.topology, endpoint.id)
        });
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
        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        let nodeFilter: string | undefined;

        if (typeof request.body.nodeName === "string" && request.body.nodeName.trim().length > 0) {
          const resolvedNode = await resolveNodeTarget(
            backend,
            target.labName,
            request.body.nodeName
          );
          nodeFilter = resolvedNode.nodeFilter;
        }

        const result = await backend.save({ labName: target.labName }, { nodeFilter });
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
        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(
          backend,
          target.labName,
          request.body.nodeName
        );
        const sshUsername = await resolveSshUsername(
          backend,
          target.labName,
          resolvedNode,
          request.body
        );
        const sshAccess = await backend.requestSshAccess(
          target.labName,
          resolvedNode.container.name,
          {
            duration: normalizeOptionalString(request.body.duration),
            sshUsername
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
        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(
          backend,
          target.labName,
          request.body.nodeName
        );
        const logs = await backend.nodeLogs(target.labName, resolvedNode.container.name, {
          tail: normalizeOptionalString(request.body.tail) ?? "200"
        });
        return reply.send(logs);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Params: { action: string }; Body: NodeLifecycleBody }>(
    "/api/runtime/nodes/:action",
    async (
      request: FastifyRequest<{ Params: { action: string }; Body: NodeLifecycleBody }>,
      reply: FastifyReply
    ) => {
      const action = normalizeNodeLifecycleAction(request.params.action);
      if (!action) {
        return reply.status(400).send({ error: "Invalid node lifecycle action." });
      }

      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(
          backend,
          target.labName,
          request.body.nodeName
        );

        await backend.nodeAction(
          target.labName,
          resolvedNode.container.name,
          action
        );

        return reply.send({ success: true });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: NodeBrowserBody }>(
    "/api/runtime/nodes/browser-ports",
    async (request: FastifyRequest<{ Body: NodeBrowserBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(
          backend,
          target.labName,
          request.body.nodeName
        );

        const payload = await backend.nodeBrowserPorts(
          target.labName,
          resolvedNode.container.name
        );

        return reply.send({
          ...payload,
          ports: (payload.ports ?? []).map((port) => ({
            ...port,
            hostIp: normalizeHostForEndpoint(port.hostIp, endpoint.url)
          }))
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Params: { action: string }; Body: ShareActionBody }>(
    "/api/runtime/share/sshx/:action",
    async (
      request: FastifyRequest<{ Params: { action: string }; Body: ShareActionBody }>,
      reply: FastifyReply
    ) => {
      const action = normalizeShareToolAction(request.params.action);
      if (!action) {
        return reply.status(400).send({ error: "Invalid SSHX action." });
      }

      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        const payload = await backend.shareTool("sshx", target.labName, action);
        return reply.send({
          ...payload,
          link: rewriteShareLinkForEndpoint(payload.link, endpoint.url)
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Params: { action: string }; Body: ShareActionBody }>(
    "/api/runtime/share/gotty/:action",
    async (
      request: FastifyRequest<{ Params: { action: string }; Body: ShareActionBody }>,
      reply: FastifyReply
    ) => {
      const action = normalizeShareToolAction(request.params.action);
      if (!action) {
        return reply.status(400).send({ error: "Invalid GoTTY action." });
      }

      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        const port = normalizeOptionalInteger(request.body.port);
        if (port !== undefined && (port <= 0 || port > 65535)) {
          throw new RequestError("Invalid gotty port value.", 400);
        }
        const payload = await backend.shareTool("gotty", target.labName, action, { port });
        return reply.send({
          ...payload,
          link: rewriteShareLinkForEndpoint(payload.link, endpoint.url)
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: FcliBody }>(
    "/api/runtime/fcli",
    async (request: FastifyRequest<{ Body: FcliBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const command = normalizeOptionalString(request.body.command);
        if (!command) {
          throw new RequestError("Missing fcli command.", 400);
        }

        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        return reply.send(await backend.fcli({ labName: target.labName }, command));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: DrawioBody }>(
    "/api/runtime/labs/graph/drawio",
    async (request: FastifyRequest<{ Body: DrawioBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const rawLayout = normalizeOptionalString(request.body.layout)?.toLowerCase();
        const layout = rawLayout ?? "horizontal";
        if (layout !== "horizontal" && layout !== "vertical" && layout !== "interactive") {
          throw new RequestError("Invalid drawio layout.", 400);
        }

        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        return reply.send(
          await backend.graphDrawio({ labName: target.labName }, {
            layout,
            theme: normalizeOptionalString(request.body.theme)
          })
        );
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
        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(
          backend,
          target.labName,
          request.body.nodeName
        );
        const session = await backend.createTerminal(
          target.labName,
          resolvedNode.container.name,
          {
            protocol: request.body.protocol,
            cols: normalizeOptionalInteger(request.body.cols) ?? 120,
            rows: normalizeOptionalInteger(request.body.rows) ?? 36,
            sshUsername:
              request.body.protocol === "ssh"
                ? await resolveSshUsername(
                    backend,
                    target.labName,
                    resolvedNode,
                    request.body
                  )
                : normalizeOptionalString(request.body.sshUsername),
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
        const session = await resolved.backend.getTerminal(request.params.sessionId);
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
        await resolved.backend.closeTerminal(request.params.sessionId);
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
        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(
          backend,
          target.labName,
          request.body.nodeName
        );
        const impairments = await backend.netemShow(resolvedNode.container.name);
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

        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(
          backend,
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
        await backend.netemSet(netemRequest);
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

        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(
          backend,
          target.labName,
          request.body.nodeName
        );
        const netemRequest: NetemResetRequest = {
          containerName: resolvedNode.container.name,
          interface: interfaceName
        };
        await backend.netemReset(netemRequest);
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
      return reply.send(await resolved.backend.edgesharkStatus());
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
        await resolved.backend.edgesharkInstall();
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
        await resolved.backend.edgesharkUninstall();
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
        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        const targets = await resolveCaptureTargets(
          backend,
          target.labName,
          request.body.targets
        );
        if (targets.length === 0) {
          throw new RequestError("At least one capture target is required", 400);
        }
        const remoteHostname = normalizeOptionalString(request.body.remoteHostname);
        const payload = await backend.capturePacketflix(target.labName, {
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
        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        const targets = await resolveCaptureTargets(
          backend,
          target.labName,
          request.body.targets
        );
        if (targets.length === 0) {
          throw new RequestError("At least one capture target is required", 400);
        }
        const theme = normalizeOptionalString(request.body.theme);
        const payload = await backend.createWiresharkVnc(target.labName, {
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

  app.post(
    "/api/runtime/capture/wireshark-vnc-sessions/close-all",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const payload = await resolved.backend.closeAllWiresharkVnc();
        deleteCaptureSessionsForEndpoint(resolved.endpoint.id);
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
        const payload = await resolved.backend.wiresharkVncReady(request.params.sessionId);
        return reply.send({
          ...payload,
          url: `${app.prefix}/api/runtime/capture/wireshark-vnc-sessions/${encodeURIComponent(request.params.sessionId)}/vnc/`
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
      await resolved.backend.closeWiresharkVnc(request.params.sessionId);
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
        const headers: Record<string, string> = {};
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

        const upstreamResponse = await resolved.backend.fetchWiresharkVnc(request.params.sessionId, {
          method: request.method,
          path: `${suffix}${query}`,
          headers
        });

        reply.status(upstreamResponse.status);
        for (const [key, value] of upstreamResponse.headers) {
          const lower = key.toLowerCase();
          if (lower === "transfer-encoding" || lower === "connection") {
            continue;
          }
          reply.header(key, value);
        }

        return reply.send(Buffer.from(upstreamResponse.body));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  });

  app.get("/api/runtime/version", async (request, reply) => {
    const resolved = resolveEndpoint(request, reply);
    if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

    try {
      return reply.send(await resolved.backend.version());
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/runtime/version/check", async (request, reply) => {
    const resolved = resolveEndpoint(request, reply);
    if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

    try {
      return reply.send(await resolved.backend.versionCheck());
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/runtime/ui/custom-nodes", async (request, reply) => {
    const resolved = resolveEndpoint(request, reply);
    if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

    try {
      return reply.send(await resolved.ui.getCustomNodes());
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
        return reply.send(await resolved.ui.saveCustomNode(request.body));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.put<{ Body: { customNodes?: unknown } }>(
    "/api/runtime/ui/custom-nodes",
    async (request: FastifyRequest<{ Body: { customNodes?: unknown } }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const customNodes = request.body?.customNodes;
        if (!Array.isArray(customNodes)) {
          throw new RequestError("Missing customNodes array", 400);
        }
        return reply.send(
          await resolved.ui.replaceCustomNodes(customNodes as Record<string, unknown>[])
        );
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
        return reply.send(await resolved.ui.deleteCustomNode(request.params.name));
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
        return reply.send(await resolved.ui.setDefaultCustomNode(name));
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
        const target = await resolveLabTarget(resolved.endpoint, resolved.backend, sessions, request.body);
        return reply.send(await resolved.ui.listLabIcons(target.labName));
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
        return reply.send(await resolved.ui.uploadGlobalIcon(request.body));
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
        await resolved.ui.deleteGlobalIcon(request.params.iconName);
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
        const target = await resolveLabTarget(resolved.endpoint, resolved.backend, sessions, request.body);
        const usedIcons = Array.isArray(request.body.usedIcons)
          ? request.body.usedIcons.filter((value): value is string => typeof value === "string")
          : [];
        await resolved.ui.reconcileLabIcons(target.labName, usedIcons);
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
        const { backend, endpoint } = resolved;
        const fileName = validateTopologyFileName(request.body.fileName);
        const labName = stripTopologySuffix(fileName.split("/").at(-1) ?? fileName);
        const files = backend.topologyFiles({ labName });
        if (await files.exists(fileName)) {
          throw new RequestError(`Topology file "${fileName}" already exists.`, 409);
        }

        const content =
          normalizeOptionalString(request.body.content) ?? buildDefaultTopologyContent(labName);
        if (fileName.includes("/")) {
          await backend.fs.write(fileName, content);
        } else {
          await files.writeFile(fileName, content);
        }

        const topologies = await backend.listTopologies();
        const topologyEntry = topologies.find(
          (entry) => entry.yamlFileName === fileName
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
        const { backend, endpoint } = resolved;
        const target = await resolveLabTarget(endpoint, backend, sessions, request.body);
        if (!target.yamlPath) {
          throw new RequestError("Missing topology file path", 400);
        }
        await backend.topologyFiles({ labName: target.labName }).unlink(target.yamlPath);
        return reply.send({ success: true, path: target.yamlPath });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );
}
