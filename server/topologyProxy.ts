/**
 * Topology host protocol endpoints.
 *
 * Exposes /api/topology/snapshot and /api/topology/command so the shared
 * UI topology session client works unchanged across standalone and VS Code hosts.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ClabApiClient } from "./clabApiClient.js";
import type { EndpointEntry } from "./endpointSessionStore.js";
import type {
  TopologyEdgeData,
  TopologyNodeData,
  TopologyRef,
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologySnapshot
} from "@srl-labs/clab-ui/session";
import {
  buildRuntimeEdgeStatsUpdates,
  buildRuntimeNodeUpdates,
  createRuntimeContainerDataProvider
} from "@srl-labs/clab-ui/session";
import type { HostRuntimeContainer, HostRuntimeInterface } from "@srl-labs/clab-ui/host";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.js";
import {
  extractEndpointIdFromTopologyId,
  normalizeStandaloneTopologyRef,
  resolveCanonicalStandaloneTopologyRef
} from "./topologyIdentity.js";

interface RuntimeContainerPayload {
  name: string;
  nodeName: string;
  labName: string;
  state: string;
  kind: string;
  image: string;
  ipv4Address: string;
  ipv6Address: string;
  interfaces?: RuntimeInterfacePayload[];
}

interface RuntimeInterfaceStatsPayload {
  rxBps?: number;
  txBps?: number;
  rxPps?: number;
  txPps?: number;
  rxBytes?: number;
  txBytes?: number;
  rxPackets?: number;
  txPackets?: number;
  statsIntervalSeconds?: number;
}

interface RuntimeInterfacePayload {
  name: string;
  alias: string;
  label?: string;
  mac: string;
  mtu: number;
  state: string;
  type: string;
  ifIndex?: number;
  stats?: RuntimeInterfaceStatsPayload;
  netemState?: {
    delay?: string;
    jitter?: string;
    loss?: string;
    rate?: string;
    corruption?: string;
  };
}

function toFiniteNumber(value: number | string | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toRuntimeInterface(iface: RuntimeInterfacePayload): HostRuntimeInterface {
  return {
    name: iface.name ?? "",
    alias: iface.alias ?? "",
    label: iface.label,
    mac: iface.mac ?? "",
    mtu: toFiniteNumber(iface.mtu) ?? 0,
    state: iface.state ?? "",
    type: iface.type ?? "",
    ifIndex: toFiniteNumber(iface.ifIndex),
    stats: iface.stats
      ? {
          rxBps: toFiniteNumber(iface.stats.rxBps),
          txBps: toFiniteNumber(iface.stats.txBps),
          rxPps: toFiniteNumber(iface.stats.rxPps),
          txPps: toFiniteNumber(iface.stats.txPps),
          rxBytes: toFiniteNumber(iface.stats.rxBytes),
          txBytes: toFiniteNumber(iface.stats.txBytes),
          rxPackets: toFiniteNumber(iface.stats.rxPackets),
          txPackets: toFiniteNumber(iface.stats.txPackets),
          statsIntervalSeconds: toFiniteNumber(iface.stats.statsIntervalSeconds)
        }
      : undefined,
    netemState: iface.netemState
      ? {
          delay: iface.netemState.delay,
          jitter: iface.netemState.jitter,
          loss: iface.netemState.loss,
          rate: iface.netemState.rate,
          corruption: iface.netemState.corruption
      }
      : undefined
  };
}

function toRuntimeContainers(containers: RuntimeContainerPayload[]): HostRuntimeContainer[] {
  return containers.map((container) => ({
    name: container.name ?? "",
    nodeName: container.nodeName ?? "",
    labName: container.labName ?? "",
    state: container.state ?? "",
    kind: container.kind ?? "",
    image: container.image ?? "",
    ipv4Address: container.ipv4Address ?? "",
    ipv6Address: container.ipv6Address ?? "",
    interfaces: (container.interfaces ?? []).map((iface) => toRuntimeInterface(iface))
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function resolveLinkStatusFromClasses(
  classes: string | undefined,
  fallback: unknown
): "up" | "down" | "unknown" | undefined {
  if (typeof classes === "string") {
    if (classes.includes("link-up")) return "up";
    if (classes.includes("link-down")) return "down";
    if (classes.trim().length === 0) return "unknown";
  }

  if (fallback === "up" || fallback === "down" || fallback === "unknown") {
    return fallback;
  }

  return undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function classFromRuntimeState(state: string): "link-up" | "link-down" | undefined {
  if (!state) {
    return undefined;
  }
  return state === "up" ? "link-up" : "link-down";
}

function deriveRuntimeEdgeClass(
  edgeData: TopologyEdgeData,
  extraData: Record<string, unknown>
): "link-up" | "link-down" | undefined {
  const sourceState = stringValue(extraData.clabSourceInterfaceState);
  const targetState = stringValue(extraData.clabTargetInterfaceState);
  if (sourceState && targetState) {
    return sourceState === "up" && targetState === "up" ? "link-up" : "link-down";
  }

  const sourceEndpoint = stringValue(edgeData.sourceEndpoint);
  const targetEndpoint = stringValue(edgeData.targetEndpoint);
  if (sourceState && !targetEndpoint) {
    return classFromRuntimeState(sourceState);
  }
  if (targetState && !sourceEndpoint) {
    return classFromRuntimeState(targetState);
  }

  return undefined;
}

function applyRuntimeOverlay(
  snapshot: TopologySnapshot,
  runtimeContainers: HostRuntimeContainer[]
): TopologySnapshot {
  if (runtimeContainers.length === 0) {
    return snapshot;
  }

  const edgeUpdates = buildRuntimeEdgeStatsUpdates(snapshot.edges, runtimeContainers, {
    currentLabName: snapshot.labName,
    topology: undefined
  });
  const nodeUpdates = buildRuntimeNodeUpdates(runtimeContainers, snapshot.labName);

  if (edgeUpdates.length === 0 && nodeUpdates.length === 0) {
    return snapshot;
  }

  const edgeUpdateMap = new Map(edgeUpdates.map((update) => [update.id, update]));
  const nodeByLongName = new Map(nodeUpdates.map((update) => [update.containerLongName, update]));
  const nodeByShortName = new Map(nodeUpdates.map((update) => [update.containerShortName, update]));

  let edgesChanged = false;
  const nextEdges = snapshot.edges.map((edge) => {
    const update = edgeUpdateMap.get(edge.id);
    if (!update) {
      return edge;
    }

    const edgeData = (edge.data ?? {
      sourceEndpoint: "",
      targetEndpoint: ""
    }) as TopologyEdgeData;
    const oldExtraData = toRecord(edgeData.extraData);
    const extraDataDelta = update.extraData ?? {};
    const hasExtraDataChange = Object.entries(extraDataDelta).some(
      ([key, value]) => oldExtraData[key] !== value
    );
    const nextClassName = update.classes ?? deriveRuntimeEdgeClass(edgeData, extraDataDelta);
    const classNameChanged = nextClassName !== undefined && nextClassName !== edge.className;
    const nextLinkStatus = resolveLinkStatusFromClasses(nextClassName, edgeData.linkStatus);
    const linkStatusChanged = nextLinkStatus !== undefined && edgeData.linkStatus !== nextLinkStatus;

    if (!hasExtraDataChange && !classNameChanged && !linkStatusChanged) {
      return edge;
    }

    edgesChanged = true;
    const nextEdgeData: TopologyEdgeData = {
      ...edgeData,
      extraData: {
        ...oldExtraData,
        ...extraDataDelta
      },
      ...(nextLinkStatus !== undefined ? { linkStatus: nextLinkStatus } : {})
    };
    return {
      ...edge,
      className: nextClassName ?? edge.className,
      data: nextEdgeData
    };
  });

  let nodesChanged = false;
  const nextNodes = snapshot.nodes.map((node) => {
    if (node.type !== "topology-node") {
      return node;
    }

    const nodeData = (node.data ?? {}) as TopologyNodeData;
    const extraData = toRecord(nodeData.extraData);
    const longNameCandidate = [nodeData.longname, extraData.longname].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    );
    const matchedUpdate =
      (longNameCandidate ? nodeByLongName.get(longNameCandidate) : undefined) ??
      nodeByShortName.get(node.id) ??
      nodeByShortName.get(toStringValue(nodeData.label));

    if (!matchedUpdate) {
      return node;
    }

    const nextState = matchedUpdate.state;
    const nextStatus = matchedUpdate.status ?? "";
    const nextIpv4 = matchedUpdate.mgmtIpv4Address ?? "";
    const nextIpv6 = matchedUpdate.mgmtIpv6Address ?? "";
    const stateChanged =
      toStringValue(nodeData.state) !== nextState ||
      toStringValue(extraData.state) !== nextState ||
      toStringValue(extraData.status) !== nextStatus;
    const ipChanged =
      toStringValue(nodeData.mgmtIpv4Address) !== nextIpv4 ||
      toStringValue(nodeData.mgmtIpv6Address) !== nextIpv6;

    if (!stateChanged && !ipChanged) {
      return node;
    }

    nodesChanged = true;
    const nextNodeData: TopologyNodeData = {
      ...nodeData,
      state: nextState,
      mgmtIpv4Address: nextIpv4,
      mgmtIpv6Address: nextIpv6,
      extraData: {
        ...extraData,
        state: nextState,
        status: nextStatus,
        mgmtIpv4Address: nextIpv4,
        mgmtIpv6Address: nextIpv6
      }
    };
    return {
      ...node,
      data: nextNodeData
    };
  });

  if (!edgesChanged && !nodesChanged) {
    return snapshot;
  }

  return {
    ...snapshot,
    edges: edgesChanged ? nextEdges : snapshot.edges,
    nodes: nodesChanged ? nextNodes : snapshot.nodes
  };
}

interface SnapshotRequest {
  sessionId?: string;
  topologyRef?: TopologyRef;
  mode?: "edit" | "view";
  deploymentState?: DeploymentState;
  sourcePreference?: "api-file" | "running-lab-doc";
  runtimeContainers?: RuntimeContainerPayload[];
  externalChange?: boolean;
}

interface CommandRequest {
  sessionId?: string;
  topologyRef?: TopologyRef;
  mode?: "edit" | "view";
  deploymentState?: DeploymentState;
  runtimeContainers?: RuntimeContainerPayload[];
  baseRevision: number;
  command: TopologyHostCommand;
}

type DeploymentState = "deployed" | "undeployed" | "unknown";

function isMissingTopologyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("ENOENT") || message.includes("(404)");
}

function isTopologyRef(value: unknown): value is TopologyRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TopologyRef).topologyId === "string" &&
    (value as TopologyRef).topologyId.trim().length > 0 &&
    typeof (value as TopologyRef).labName === "string" &&
    (value as TopologyRef).labName.trim().length > 0 &&
    typeof (value as TopologyRef).yamlPath === "string" &&
    (value as TopologyRef).yamlPath.trim().length > 0 &&
    ((value as TopologyRef).source === "standalone" || (value as TopologyRef).source === "vscode")
  );
}

function createEmptySnapshot(
  mode: "edit" | "view",
  deploymentState: DeploymentState
): TopologySnapshot {
  return {
    revision: 1,
    nodes: [],
    edges: [],
    annotations: {},
    yamlFileName: "",
    annotationsFileName: "",
    yamlContent: "",
    annotationsContent: "{}",
    labName: "",
    mode,
    deploymentState,
    canUndo: false,
    canRedo: false
  };
}

async function attachDocumentRevision(
  client: ClabApiClient,
  token: string,
  topologyRef: TopologyRef,
  snapshot: TopologySnapshot,
  options: { force?: boolean } = {}
): Promise<TopologySnapshot> {
  if (
    !options.force &&
    typeof snapshot.documentRevision === "string" &&
    snapshot.documentRevision.trim().length > 0
  ) {
    return snapshot;
  }
  const documentRevision = await client.getTopologyDocumentRevision(
    token,
    topologyRef.labName,
    topologyRef.yamlPath
  );
  if (documentRevision) {
    snapshot.documentRevision = documentRevision;
  }
  return snapshot;
}

type EndpointResolver = (
  request: FastifyRequest,
  reply: FastifyReply,
  endpointId?: string
) => { client: ClabApiClient; endpoint: EndpointEntry } | null;

function modeForDeploymentState(
  mode: "edit" | "view" | undefined,
  deploymentState: DeploymentState
): "edit" | "view" {
  return mode ?? (deploymentState === "deployed" ? "view" : "edit");
}

function topologyErrorStatusCode(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "Missing sessionId or command") {
    return 400;
  }
  return isMissingTopologyError(error) ? 404 : 500;
}

async function snapshotForRequest(
  body: SnapshotRequest,
  client: ClabApiClient,
  endpoint: EndpointEntry,
  sessions: StandaloneTopologySessionManager
): Promise<TopologySnapshot> {
  const sessionId = body.sessionId?.trim() ?? "";
  const fallbackDeploymentState = body.deploymentState ?? "unknown";
  if (!sessionId) {
    return createEmptySnapshot(modeForDeploymentState(body.mode, fallbackDeploymentState), fallbackDeploymentState);
  }

  const session = sessions.getSession(sessionId, endpoint.id);
  if (!session) {
    throw new Error("Topology session not found");
  }

  const deploymentState = body.deploymentState ?? "undeployed";
  const mode = modeForDeploymentState(body.mode, deploymentState);
  const runtimeContainers = toRuntimeContainers(body.runtimeContainers ?? []);
  const containerDataProvider = createRuntimeContainerDataProvider(runtimeContainers);
  session.host.updateContext({ mode, deploymentState, containerDataProvider });

  const rawSnapshot = body.externalChange
    ? await session.host.onExternalChange()
    : await session.host.getSnapshot();
  const snapshot = session.sourcePreference === "api-file"
    ? await attachDocumentRevision(client, endpoint.token, session.topologyRef, rawSnapshot, {
        force: body.externalChange === true
      })
    : rawSnapshot;

  return applyRuntimeOverlay(snapshot, runtimeContainers);
}

async function responseForCommandRequest(
  body: CommandRequest,
  client: ClabApiClient,
  endpoint: EndpointEntry,
  sessions: StandaloneTopologySessionManager
): Promise<TopologyHostResponseMessage> {
  const sessionId = body.sessionId?.trim() ?? "";
  if (!sessionId || !body.command) {
    throw new Error("Missing sessionId or command");
  }

  const session = sessions.getSession(sessionId, endpoint.id);
  if (!session) {
    throw new Error("Topology session not found");
  }

  const deploymentState = body.deploymentState ?? "undeployed";
  const mode = modeForDeploymentState(body.mode, deploymentState);
  const containerDataProvider = createRuntimeContainerDataProvider(
    toRuntimeContainers(body.runtimeContainers ?? [])
  );
  session.host.updateContext({ mode, deploymentState, containerDataProvider });

  const response: TopologyHostResponseMessage = await session.host.applyCommand(
    body.command,
    body.baseRevision
  );
  if (
    (response.type === "topology-host:ack" || response.type === "topology-host:reject") &&
    response.snapshot &&
    session.sourcePreference === "api-file"
  ) {
    response.snapshot = await attachDocumentRevision(
      client,
      endpoint.token,
      session.topologyRef,
      response.snapshot,
      { force: true }
    );
  }
  return response;
}

export function registerTopologyProxy(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
  sessions: StandaloneTopologySessionManager
): void {
  app.post<{ Body: SnapshotRequest }>(
    "/api/topology/sessions",
    async (request: FastifyRequest<{ Body: SnapshotRequest }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(
        request,
        reply,
        extractEndpointIdFromTopologyId(request.body.topologyRef?.topologyId)
      );
      if (!resolved) {
        return reply.status(401).send({ error: "Not authenticated" });
      }

      const topologyRef = request.body.topologyRef;
      if (!isTopologyRef(topologyRef)) {
        return reply.status(400).send({ error: "Missing topologyRef" });
      }

      const { client, endpoint } = resolved;
      const sourcePreference = request.body.sourcePreference === "running-lab-doc" ? "running-lab-doc" : "api-file";
      const canonicalTopologyRef = sourcePreference === "running-lab-doc"
        ? normalizeStandaloneTopologyRef(topologyRef, endpoint.id)
        : await resolveCanonicalStandaloneTopologyRef(
            client,
            endpoint.token,
            topologyRef,
            endpoint.id
          );
      const deploymentState = request.body.deploymentState ?? "undeployed";
      const mode = request.body.mode ?? (deploymentState === "deployed" ? "view" : "edit");
      const containerDataProvider = createRuntimeContainerDataProvider(
        toRuntimeContainers(request.body.runtimeContainers ?? [])
      );

      const session = sessions.createSession({
        client,
        token: endpoint.token,
        endpointId: endpoint.id,
        topologyRef: canonicalTopologyRef,
        mode,
        deploymentState,
        sourcePreference,
        containerDataProvider
      });

      return reply.send({
        sessionId: session.sessionId,
        topologyRef: session.topologyRef
      });
    }
  );

  app.delete<{ Params: { sessionId: string } }>(
    "/api/topology/sessions/:sessionId",
    async (request, reply) => {
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) {
        return reply.status(401).send({ error: "Not authenticated" });
      }

      const session = sessions.getSession(request.params.sessionId, resolved.endpoint.id);
      if (!session) {
        return reply.status(404).send({ error: "Topology session not found" });
      }

      sessions.disposeSession(session.sessionId);
      return reply.send({ success: true });
    }
  );

  app.post<{ Body: SnapshotRequest }>(
    "/api/topology/snapshot",
    async (request: FastifyRequest<{ Body: SnapshotRequest }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(
        request,
        reply,
        extractEndpointIdFromTopologyId(request.body.topologyRef?.topologyId)
      );
      if (!resolved) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      const { client, endpoint } = resolved;

      try {
        const snapshot = await snapshotForRequest(request.body, client, endpoint, sessions);
        return reply.send({ snapshot });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const statusCode = isMissingTopologyError(error) ? 404 : 500;
        return reply.status(statusCode).send({ error: message });
      }
    }
  );

  app.post<{ Body: CommandRequest }>(
    "/api/topology/command",
    async (request: FastifyRequest<{ Body: CommandRequest }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(
        request,
        reply,
        extractEndpointIdFromTopologyId(request.body.topologyRef?.topologyId)
      );
      if (!resolved) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      const { client, endpoint } = resolved;

      try {
        const response = await responseForCommandRequest(request.body, client, endpoint, sessions);
        return reply.send(response);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const statusCode = topologyErrorStatusCode(error);
        return reply.status(statusCode).send({
          type: "topology-host:error",
          error: message
        });
      }
    }
  );
}
