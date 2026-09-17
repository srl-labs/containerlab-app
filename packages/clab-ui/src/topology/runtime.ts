import type { ClabTopology } from "../core/types/topology";
import type { TopoEdge, TopologyEdgeData } from "../core/types/graph";
import type {
  ContainerDataProvider,
  ContainerInfo,
  InterfaceInfo
} from "../core/parsing/types";
import { mapSrosInterfaceName } from "../core/parsing/DistributedSrosMapper";
import {
  computeEdgeClassFromStates,
  extractEdgeInterfaceStats
} from "../core/parsing/EdgeElementBuilder";
import type { HostRuntimeContainer, HostRuntimeInterface } from "../host";

export interface TopologyRuntimeEdgeUpdate {
  id: string;
  extraData: Record<string, unknown>;
  classes?: string;
}

export interface TopologyRuntimeNodeUpdate {
  containerLongName: string;
  containerShortName: string;
  state: string;
  status?: string;
  mgmtIpv4Address?: string;
  mgmtIpv6Address?: string;
}

export interface TopologyRuntimeUpdateContext {
  currentLabName: string;
  topology: ClabTopology["topology"] | undefined;
}

interface RuntimeInterfaceLookupResult {
  iface: InterfaceInfo | undefined;
  containerMatched: boolean;
  hasRunningContainer: boolean;
}

function normalizeName(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeLabName(value: string | undefined): string {
  return normalizeName(value);
}

function stripCidr(address: string | undefined): string {
  if (!address) {
    return "";
  }
  const [value] = address.split("/");
  return value ?? "";
}

function extractDistributedBaseFromName(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return undefined;
  }
  const idx = trimmed.lastIndexOf("-");
  if (idx <= 0 || idx >= trimmed.length - 1) {
    return undefined;
  }
  return trimmed.slice(0, idx);
}

function shortContainerName(container: HostRuntimeContainer): string {
  const fullName = (container.name ?? "").trim();
  const labName = (container.labName ?? "").trim();
  const shortName = stripContainerPrefix(labName, fullName);
  if (shortName && shortName !== fullName) {
    return shortName;
  }
  if (fullName) {
    return fullName;
  }
  return (container.nodeName ?? "").trim();
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

function hasRuntimeInterfaces(container: HostRuntimeContainer): boolean {
  return (container.interfaces ?? []).length > 0;
}

function isRunningRuntimeContainer(container: HostRuntimeContainer): boolean {
  const state = normalizeName(container.state);
  return state.includes("run") || state.includes("healthy");
}

function sortContainersByInterfacePriority(
  containers: HostRuntimeContainer[]
): HostRuntimeContainer[] {
  return [...containers].sort((left, right) => {
    const leftHasInterfaces = hasRuntimeInterfaces(left) ? 0 : 1;
    const rightHasInterfaces = hasRuntimeInterfaces(right) ? 0 : 1;
    if (leftHasInterfaces !== rightHasInterfaces) {
      return leftHasInterfaces - rightHasInterfaces;
    }
    return left.name.localeCompare(right.name);
  });
}

function interfaceCandidates(ifaceName: string): Set<string> {
  const candidates = new Set<string>();
  const normalized = ifaceName.trim();
  if (normalized) {
    candidates.add(normalized);
  }

  const mapped = mapSrosInterfaceName(normalized);
  if (mapped !== undefined && mapped.length > 0) {
    candidates.add(mapped);
  }

  return candidates;
}

function interfacesMatch(iface: HostRuntimeInterface, candidates: Set<string>): boolean {
  if (candidates.size === 0) {
    return false;
  }
  return (
    candidates.has(iface.name) ||
    candidates.has(iface.alias) ||
    candidates.has(iface.label ?? "")
  );
}

/** Per-container name data normalized once so per-node matching avoids re-normalizing. */
interface IndexedRuntimeContainer {
  container: HostRuntimeContainer;
  nameCandidates: string[];
  isDistributedSros: boolean;
  normalizedDistributedBase: string;
  normalizedShortName: string;
  normalizedNodeName: string;
}

/** Containers of a single lab, filtered and normalized once per lookup batch. */
interface LabContainerIndex {
  labName: string;
  entries: IndexedRuntimeContainer[];
}

function indexRuntimeContainer(container: HostRuntimeContainer): IndexedRuntimeContainer {
  const shortName = shortContainerName(container);
  const normalizedShortName = normalizeName(shortName);
  return {
    container,
    nameCandidates: [
      normalizeName(container.name),
      normalizedShortName,
      normalizeName(container.nodeName)
    ],
    isDistributedSros: container.kind === "nokia_srsim",
    normalizedDistributedBase: normalizeName(extractDistributedBaseFromName(shortName)),
    normalizedShortName,
    normalizedNodeName: normalizeName(container.nodeName)
  };
}

function createLabContainerIndex(
  containers: HostRuntimeContainer[],
  labName: string
): LabContainerIndex {
  const targetLab = normalizeLabName(labName);
  const entries: IndexedRuntimeContainer[] = [];
  for (const container of containers) {
    if (normalizeLabName(container.labName) !== targetLab) {
      continue;
    }
    entries.push(indexRuntimeContainer(container));
  }
  return { labName, entries };
}

function indexedContainerMatchesNode(
  entry: IndexedRuntimeContainer,
  nodeName: string
): boolean {
  const normalizedNode = normalizeName(nodeName);
  if (!normalizedNode) {
    return false;
  }

  if (entry.nameCandidates.includes(normalizedNode)) {
    return true;
  }

  if (!entry.isDistributedSros) {
    return false;
  }

  if (entry.normalizedDistributedBase && entry.normalizedDistributedBase === normalizedNode) {
    return true;
  }

  return entry.normalizedShortName.startsWith(`${normalizedNode}-`);
}

function matchingContainers(
  index: LabContainerIndex,
  nodeName: string,
  includeDistributedSiblings: boolean = false
): HostRuntimeContainer[] {
  const targetNames = nodeNameCandidates(index.labName, nodeName);
  const matchedEntries = index.entries.filter((entry) =>
    targetNames.some((targetName) => indexedContainerMatchesNode(entry, targetName))
  );
  const matched = matchedEntries.map((entry) => entry.container);
  if (!includeDistributedSiblings || matched.length === 0) {
    return sortContainersByInterfacePriority(matched);
  }

  const siblingRoots = new Set(
    matchedEntries
      .filter((entry) => entry.isDistributedSros)
      .map((entry) => entry.normalizedNodeName)
      .filter((root) => root.length > 0)
  );
  if (siblingRoots.size === 0) {
    return sortContainersByInterfacePriority(matched);
  }

  const candidates: HostRuntimeContainer[] = [];
  const seen = new Set<string>();
  for (const container of matched) {
    if (!seen.has(container.name)) {
      candidates.push(container);
      seen.add(container.name);
    }
  }
  for (const entry of index.entries) {
    if (!entry.isDistributedSros) {
      continue;
    }
    const root = entry.normalizedNodeName;
    if (!root || !siblingRoots.has(root) || seen.has(entry.container.name)) {
      continue;
    }
    candidates.push(entry.container);
    seen.add(entry.container.name);
  }

  return sortContainersByInterfacePriority(candidates);
}

function toInterfaceInfo(iface: HostRuntimeInterface): InterfaceInfo {
  return {
    name: iface.name ?? "",
    alias: iface.alias ?? "",
    label: iface.label,
    mac: iface.mac ?? "",
    mtu: iface.mtu ?? 0,
    state: iface.state ?? "",
    type: iface.type ?? "",
    ifIndex: iface.ifIndex,
    stats: iface.stats
      ? {
          rxBps: iface.stats.rxBps,
          txBps: iface.stats.txBps,
          rxPps: iface.stats.rxPps,
          txPps: iface.stats.txPps,
          rxBytes: iface.stats.rxBytes,
          txBytes: iface.stats.txBytes,
          rxPackets: iface.stats.rxPackets,
          txPackets: iface.stats.txPackets,
          statsIntervalSeconds: iface.stats.statsIntervalSeconds
        }
      : undefined,
    netemState: iface.netemState
  };
}

function toContainerInfo(container: HostRuntimeContainer): ContainerInfo {
  return {
    name: container.name ?? "",
    name_short: shortContainerName(container),
    rootNodeName: container.nodeName ?? "",
    state: container.state ?? "",
    kind: container.kind ?? "",
    image: container.image ?? "",
    IPv4Address: stripCidr(container.ipv4Address),
    IPv6Address: stripCidr(container.ipv6Address),
    interfaces: (container.interfaces ?? []).map((iface) => toInterfaceInfo(iface)),
    label: container.nodeName || container.name
  };
}

function findInterfaceInfo(
  index: LabContainerIndex,
  nodeName: string,
  ifaceName: string
): InterfaceInfo | undefined {
  return findRuntimeInterface(index, nodeName, ifaceName).iface;
}

function findRuntimeInterface(
  index: LabContainerIndex,
  nodeName: string,
  ifaceName: string
): RuntimeInterfaceLookupResult {
  const candidates = matchingContainers(index, nodeName, true);
  const ifaceNameCandidates = interfaceCandidates(ifaceName);
  for (const container of candidates) {
    const match = (container.interfaces ?? []).find((iface) =>
      interfacesMatch(iface, ifaceNameCandidates)
    );
    if (match) {
      return {
        iface: toInterfaceInfo(match),
        containerMatched: true,
        hasRunningContainer: isRunningRuntimeContainer(container)
      };
    }
  }
  return {
    iface: undefined,
    containerMatched: candidates.length > 0,
    hasRunningContainer: candidates.some((container) => isRunningRuntimeContainer(container))
  };
}

function normalizeInterfaceName(value: unknown, fallback: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof fallback === "string" && fallback.trim().length > 0) {
    return fallback;
  }
  return "";
}

function normalizeNodeIdentifier(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return "";
}

function buildInterfaceExtraData(
  sourceRuntime: RuntimeInterfaceLookupResult,
  targetRuntime: RuntimeInterfaceLookupResult
): Record<string, unknown> {
  const updatedExtraData: Record<string, unknown> = {};

  applyRuntimeInterfaceToExtraData(updatedExtraData, "Source", sourceRuntime);
  applyRuntimeInterfaceToExtraData(updatedExtraData, "Target", targetRuntime);

  return updatedExtraData;
}

function applyRuntimeInterfaceToExtraData(
  extraData: Record<string, unknown>,
  prefix: "Source" | "Target",
  runtime: RuntimeInterfaceLookupResult
): void {
  if (!runtime.containerMatched) {
    return;
  }

  if (!runtime.hasRunningContainer) {
    applyUnavailableInterfaceToExtraData(extraData, prefix);
    return;
  }

  if (runtime.iface) {
    applyInterfaceToExtraData(extraData, prefix, runtime.iface);
    return;
  }

  applyUnavailableInterfaceToExtraData(extraData, prefix);
}

function applyUnavailableInterfaceToExtraData(
  extraData: Record<string, unknown>,
  prefix: "Source" | "Target"
): void {
  extraData[`clab${prefix}InterfaceState`] = "";
  extraData[`clab${prefix}Stats`] = undefined;
  extraData[`clab${prefix}Netem`] = undefined;
}

function applyInterfaceToExtraData(
  extraData: Record<string, unknown>,
  prefix: "Source" | "Target",
  iface: InterfaceInfo
): void {
  extraData[`clab${prefix}InterfaceState`] = iface.state || "";
  extraData[`clab${prefix}MacAddress`] = iface.mac;
  extraData[`clab${prefix}Mtu`] = iface.mtu;
  extraData[`clab${prefix}Type`] = iface.type;
  if ("netemState" in iface) {
    extraData[`clab${prefix}Netem`] = iface.netemState ?? undefined;
  }
  const stats = extractEdgeInterfaceStats(iface);
  if (stats) {
    extraData[`clab${prefix}Stats`] = stats;
  }
}

function computeEdgeClassForUpdate(
  topology: ClabTopology["topology"] | undefined,
  extraData: Record<string, unknown>,
  edge: TopoEdge,
  sourceState?: string,
  targetState?: string
): string | undefined {
  if (!topology) {
    return undefined;
  }
  const sourceNodeId = normalizeNodeIdentifier(extraData.yamlSourceNodeId, edge.source);
  const targetNodeId = normalizeNodeIdentifier(extraData.yamlTargetNodeId, edge.target);
  return computeEdgeClassFromStates(topology, sourceNodeId, targetNodeId, sourceState, targetState);
}

function lookupEdgeInterfaces(
  index: LabContainerIndex,
  edge: TopoEdge,
  edgeData: TopologyEdgeData | undefined,
  extraData: Record<string, unknown>
): {
  sourceRuntime: RuntimeInterfaceLookupResult;
  targetRuntime: RuntimeInterfaceLookupResult;
} {
  const sourceIfaceName = normalizeInterfaceName(
    extraData.clabSourcePort,
    edgeData?.sourceEndpoint
  );
  const targetIfaceName = normalizeInterfaceName(
    extraData.clabTargetPort,
    edgeData?.targetEndpoint
  );

  const sourceNodeIdentifier = normalizeNodeIdentifier(
    extraData.yamlSourceNodeId,
    extraData.clabSourceLongName,
    edge.source
  );
  const targetNodeIdentifier = normalizeNodeIdentifier(
    extraData.yamlTargetNodeId,
    extraData.clabTargetLongName,
    edge.target
  );

  return {
    sourceRuntime: findRuntimeInterface(index, sourceNodeIdentifier, sourceIfaceName),
    targetRuntime: findRuntimeInterface(index, targetNodeIdentifier, targetIfaceName)
  };
}

export function createRuntimeContainerDataProvider(
  containers: HostRuntimeContainer[]
): ContainerDataProvider {
  // The containers array is fixed for the provider's lifetime, so each lab's
  // filtered + normalized index can be built once and reused across lookups.
  const indexCache = new Map<string, LabContainerIndex>();
  const indexForLab = (labName: string): LabContainerIndex => {
    let index = indexCache.get(labName);
    if (!index) {
      index = createLabContainerIndex(containers, labName);
      indexCache.set(labName, index);
    }
    return index;
  };

  return {
    findContainer(containerName: string, labName: string): ContainerInfo | undefined {
      const container = matchingContainers(indexForLab(labName), containerName, false)[0];
      return container ? toContainerInfo(container) : undefined;
    },
    findInterface(
      containerName: string,
      ifaceName: string,
      labName: string
    ): InterfaceInfo | undefined {
      return findInterfaceInfo(indexForLab(labName), containerName, ifaceName);
    },
    findDistributedSrosInterface(params) {
      const candidates = matchingContainers(indexForLab(params.labName), params.baseNodeName, true);
      const ifaceNameCandidates = interfaceCandidates(params.ifaceName);
      for (const container of candidates) {
        if (container.kind !== "nokia_srsim") {
          continue;
        }
        const iface = (container.interfaces ?? []).find((entry) =>
          interfacesMatch(entry, ifaceNameCandidates)
        );
        if (iface) {
          return {
            containerName: container.name,
            ifaceData: toInterfaceInfo(iface)
          };
        }
      }
      return undefined;
    },
    findDistributedSrosContainer(params) {
      const container = matchingContainers(indexForLab(params.labName), params.baseNodeName, true).find(
        (candidate) => candidate.kind === "nokia_srsim"
      );
      return container ? toContainerInfo(container) : undefined;
    }
  };
}

export function buildRuntimeEdgeStatsUpdates(
  edges: TopoEdge[],
  containers: HostRuntimeContainer[],
  context: TopologyRuntimeUpdateContext
): TopologyRuntimeEdgeUpdate[] {
  if (edges.length === 0 || containers.length === 0) {
    return [];
  }

  // One lab-scoped index per invocation instead of re-filtering and
  // re-normalizing every container for each edge endpoint.
  const labIndex = createLabContainerIndex(containers, context.currentLabName);

  const updates: TopologyRuntimeEdgeUpdate[] = [];
  for (const edge of edges) {
    const edgeData = edge.data;
    const extraData = edgeData?.extraData ?? {};
    const { sourceRuntime, targetRuntime } = lookupEdgeInterfaces(
      labIndex,
      edge,
      edgeData,
      extraData
    );
    const updatedExtraData = buildInterfaceExtraData(sourceRuntime, targetRuntime);
    const edgeClass = computeEdgeClassForUpdate(
      context.topology,
      extraData,
      edge,
      typeof updatedExtraData.clabSourceInterfaceState === "string"
        ? updatedExtraData.clabSourceInterfaceState
        : undefined,
      typeof updatedExtraData.clabTargetInterfaceState === "string"
        ? updatedExtraData.clabTargetInterfaceState
        : undefined
    );
    if (Object.keys(updatedExtraData).length === 0) {
      continue;
    }
    updates.push({ id: edge.id, extraData: updatedExtraData, classes: edgeClass });
  }

  return updates;
}

export function buildRuntimeNodeUpdates(
  containers: HostRuntimeContainer[],
  currentLabName: string
): TopologyRuntimeNodeUpdate[] {
  const targetLab = normalizeLabName(currentLabName);
  if (!targetLab) {
    return [];
  }

  return containers
    .filter((container) => normalizeLabName(container.labName) === targetLab)
    .map((container) => ({
      containerLongName: container.name,
      containerShortName: shortContainerName(container),
      state: container.state,
      mgmtIpv4Address: stripCidr(container.ipv4Address),
      mgmtIpv6Address: stripCidr(container.ipv6Address)
    }));
}
