import {
  labNodeRunState,
  labRunState,
  parseDockerUptime,
  type LabNodeRunState,
  type LabOverviewCard
} from "@containerlab/clab-ui/workspace/state";

import {
  findTopologyEntryForRunningLab,
  shouldShowRunningLab,
  topologyRefForRunningLab
} from "./standaloneExplorer";
import {
  getLabOwner,
  isNonOwnedLabForEndpoint,
  isSharedWorkspacePath,
  isTopologyRunning,
  normalizePathValue,
  safeFilename,
  topologyEntryLabName,
  type TopologyFileEntry
} from "./standaloneHostShared";
import type { EndpointConfig } from "./stores/endpointStore";
import type { ContainerState, LabState } from "./stores/labStore";

interface UptimeEstimate {
  status: string;
  startedAt: number;
  precisionMs: number;
}

/** Start times estimated from Docker status text, kept between builds so uptimes advance with the clock. */
export type UptimeEstimates = Map<string, UptimeEstimate>;

export interface LabOverviewInput {
  labs: Map<string, LabState>;
  files: readonly TopologyFileEntry[];
  endpoints: readonly EndpointConfig[];
  lifecycle: boolean;
  now: number;
  uptimes: UptimeEstimates;
  linkFor?: (endpointId: string, path: string) => string;
}

function estimateStart(uptimes: UptimeEstimates, key: string, status: string, now: number): UptimeEstimate | undefined {
  const parsed = parseDockerUptime(status);
  if (!parsed) return undefined;
  const current = uptimes.get(key);
  if (current?.status === status) return current;
  const next = { status, startedAt: now - parsed.ms, precisionMs: parsed.precisionMs };
  // "2 hours" after "59 minutes" says nothing new about the same start; keep the finer estimate.
  const sameStart = current !== undefined && Math.abs(current.startedAt - next.startedAt) <= next.precisionMs;
  const estimate = sameStart && current.precisionMs < next.precisionMs ? { ...current, status } : next;
  uptimes.set(key, estimate);
  return estimate;
}

function oldestStart(
  lab: LabState,
  containers: ContainerState[],
  input: LabOverviewInput,
  seen: Set<string>
): UptimeEstimate | undefined {
  let oldest: UptimeEstimate | undefined;
  for (const container of containers) {
    const key = `${lab.endpointId}\n${container.name}`;
    seen.add(key);
    const estimate = estimateStart(input.uptimes, key, container.status, input.now);
    if (estimate && (!oldest || estimate.startedAt < oldest.startedAt)) oldest = estimate;
  }
  return oldest;
}

function annotationsPathOf(entry: TopologyFileEntry | undefined): string | undefined {
  return entry?.hasAnnotations === true ? entry.topologyRef.annotationsPath : undefined;
}

/** A running lab's workspace file; another user's lab opens from its running document, never from a same-named file of ours. */
function workspaceEntryOf(
  lab: LabState,
  endpoint: EndpointConfig,
  matched: TopologyFileEntry | undefined
): TopologyFileEntry | undefined {
  return isNonOwnedLabForEndpoint(lab, endpoint.username) && !isSharedWorkspacePath(matched?.path) ? undefined : matched;
}

function runtimeSummary(lab: LabState, input: LabOverviewInput, seen: Set<string>) {
  const containers = [...lab.containers.values()];
  const nodes: Record<string, LabNodeRunState> = {};
  for (const container of containers) nodes[container.nodeName || container.name] = labNodeRunState(container);
  const started = oldestStart(lab, containers, input, seen);
  return {
    state: labRunState(containers),
    nodeCount: containers.length,
    readyCount: Object.values(nodes).filter((state) => state === "ready").length,
    nodes,
    startedAt: started?.startedAt,
    uptimePrecisionMs: started?.precisionMs
  };
}

function runningLabCard(
  lab: LabState,
  endpoint: EndpointConfig,
  entry: TopologyFileEntry | undefined,
  input: LabOverviewInput,
  seen: Set<string>
): LabOverviewCard {
  const topologyRef = topologyRefForRunningLab(lab, entry);
  const path = entry ? normalizePathValue(entry.path) : undefined;
  return {
    id: `${lab.endpointId}::${path ?? `lab:${lab.name}`}`,
    endpointId: lab.endpointId,
    endpointLabel: endpoint.label,
    name: lab.name,
    labName: lab.name,
    path,
    annotationsPath: annotationsPathOf(entry),
    topologyRef,
    owner: getLabOwner(lab) || undefined,
    shared: isSharedWorkspacePath(path),
    ...runtimeSummary(lab, input, seen),
    canDeploy: false,
    canDestroy: input.lifecycle && topologyRef !== undefined,
    link: path === undefined ? undefined : input.linkFor?.(lab.endpointId, path)
  };
}

function undeployedCard(file: TopologyFileEntry, endpoint: EndpointConfig, input: LabOverviewInput): LabOverviewCard {
  const path = normalizePathValue(file.path);
  const shared = isSharedWorkspacePath(path);
  return {
    id: `${file.endpointId}::${path}`,
    endpointId: file.endpointId,
    endpointLabel: endpoint.label,
    name: topologyEntryLabName(file),
    path,
    annotationsPath: annotationsPathOf(file),
    topologyRef: file.topologyRef,
    // As in the explorer, files have no owner: they are in your workspace or the shared one.
    shared,
    state: "undeployed",
    nodeCount: 0,
    readyCount: 0,
    nodes: {},
    canDeploy: input.lifecycle,
    canDestroy: false,
    link: input.linkFor?.(file.endpointId, path)
  };
}

function compareCards(left: LabOverviewCard, right: LabOverviewCard): number {
  return left.name.localeCompare(right.name) || left.endpointLabel.localeCompare(right.endpointLabel) ||
    (left.path ?? "").localeCompare(right.path ?? "");
}

function runningLabCards(input: LabOverviewInput, endpointsById: ReadonlyMap<string, EndpointConfig>): LabOverviewCard[] {
  const filesByEndpoint = new Map<string, TopologyFileEntry[]>();
  for (const file of input.files) {
    const bucket = filesByEndpoint.get(file.endpointId) ?? [];
    bucket.push(file);
    filesByEndpoint.set(file.endpointId, bucket);
  }
  const seen = new Set<string>();
  const cards: LabOverviewCard[] = [];
  for (const lab of input.labs.values()) {
    const endpoint = endpointsById.get(lab.endpointId);
    if (endpoint?.connected !== true) continue;
    const matched = findTopologyEntryForRunningLab(lab, filesByEndpoint.get(lab.endpointId) ?? []);
    if (!shouldShowRunningLab(lab, endpointsById, matched)) continue;
    cards.push(runningLabCard(lab, endpoint, workspaceEntryOf(lab, endpoint, matched), input, seen));
  }
  for (const key of input.uptimes.keys()) {
    if (!seen.has(key)) input.uptimes.delete(key);
  }
  return cards;
}

/**
 * Cards for the labs overview: every running lab the explorer would list, then every
 * topology file without a running lab. Lab hosts that are not connected list nothing,
 * as in the explorer; the connection banner reports them.
 */
export function buildLabOverviewCards(input: LabOverviewInput): LabOverviewCard[] {
  const endpointsById = new Map(input.endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const cards = runningLabCards(input, endpointsById);
  for (const file of input.files) {
    const endpoint = endpointsById.get(file.endpointId);
    if (endpoint?.connected !== true || safeFilename(file.filename || file.path).startsWith(".")) continue;
    if (isTopologyRunning(file.topologyRef, input.labs)) continue;
    cards.push(undeployedCard(file, endpoint, input));
  }
  return cards.sort(compareCards);
}
