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
  TopologyRef,
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologySnapshot
} from "@srl-labs/clab-ui/session";
import { createRuntimeContainerDataProvider } from "@srl-labs/clab-ui/session";
import type { HostRuntimeContainer, HostRuntimeInterface } from "@srl-labs/clab-ui/host";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.js";
import {
  extractEndpointIdFromTopologyId,
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
  mac: string;
  mtu: number;
  state: string;
  type: string;
  ifIndex?: number;
  stats?: RuntimeInterfaceStatsPayload;
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

interface SnapshotRequest {
  sessionId?: string;
  topologyRef?: TopologyRef;
  mode?: "edit" | "view";
  deploymentState?: DeploymentState;
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
  snapshot: TopologySnapshot
): Promise<TopologySnapshot> {
  const documentRevision = await client.getTopologyDocumentRevision(
    token,
    topologyRef.labName,
    topologyRef.yamlPath
  );
  return documentRevision ? { ...snapshot, documentRevision } : snapshot;
}

type EndpointResolver = (
  request: FastifyRequest,
  reply: FastifyReply,
  endpointId?: string
) => { client: ClabApiClient; endpoint: EndpointEntry } | null;

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
      const canonicalTopologyRef = await resolveCanonicalStandaloneTopologyRef(
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

      const body = request.body;
      const sessionId = body.sessionId?.trim() ?? "";
      if (!sessionId) {
        const deploymentState = body.deploymentState ?? "unknown";
        const mode = body.mode ?? (deploymentState === "deployed" ? "view" : "edit");
        return reply.send({
          snapshot: createEmptySnapshot(mode, deploymentState)
        });
      }

      const session = sessions.getSession(sessionId, endpoint.id);
      if (!session) {
        return reply.status(404).send({ error: "Topology session not found" });
      }

      try {
        const deploymentState = body.deploymentState ?? "undeployed";
        const mode = body.mode ?? (deploymentState === "deployed" ? "view" : "edit");
        const containerDataProvider = createRuntimeContainerDataProvider(
          toRuntimeContainers(body.runtimeContainers ?? [])
        );
        session.host.updateContext({ mode, deploymentState, containerDataProvider });

        let snapshot: TopologySnapshot;
        if (body.externalChange) {
          snapshot = await session.host.onExternalChange();
        } else {
          snapshot = await session.host.getSnapshot();
        }
        snapshot = await attachDocumentRevision(
          client,
          endpoint.token,
          session.topologyRef,
          snapshot
        );

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
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      const { client, endpoint } = resolved;

      const body = request.body;
      const sessionId = body.sessionId?.trim() ?? "";
      if (!sessionId || !body.command) {
        return reply.status(400).send({ error: "Missing sessionId or command" });
      }

      const session = sessions.getSession(sessionId, endpoint.id);
      if (!session) {
        return reply.status(404).send({ error: "Topology session not found" });
      }

      try {
        const deploymentState = body.deploymentState ?? "undeployed";
        const mode = body.mode ?? (deploymentState === "deployed" ? "view" : "edit");
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
          response.snapshot
        ) {
          response.snapshot = await attachDocumentRevision(
            client,
            endpoint.token,
            session.topologyRef,
            response.snapshot
          );
        }
        return reply.send(response);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const statusCode = isMissingTopologyError(error) ? 404 : 500;
        return reply.status(statusCode).send({
          type: "topology-host:error",
          error: message
        });
      }
    }
  );
}
