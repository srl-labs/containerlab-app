import type { HostNodeStatsSample } from "../../host/contracts";
import type { LabOverviewCard } from "./labsOverview";

/** Samples kept for a lab card's sparklines. */
export const LAB_USAGE_HISTORY = 40;

export interface LabNodeUsage {
  /** Where 100 is one busy CPU; missing in a node's first sample. */
  cpuPercent?: number;
  memoryBytes: number;
}

/** A running lab's CPU and memory usage, summed over its nodes. */
export interface LabUsage {
  /** Time of the latest sample, ms since the epoch. */
  time: number;
  /** Where 100 is one busy CPU; missing until a node reported twice. */
  cpuPercent?: number;
  /** CPUs of the lab host, when known. */
  cpuCount?: number;
  memoryBytes: number;
  /** The lab host's memory: the limit every node reports when none has a limit of its own. */
  memoryLimitBytes?: number;
  cpuHistory: number[];
  memoryHistory: number[];
  /** By topology node name. */
  nodes: Record<string, LabNodeUsage>;
}

/** What a card shows about its lab's usage: waiting for the first sample, live, or nothing the host reports. */
export type LabUsageUpdate =
  | { status: "pending" }
  | { status: "live"; usage: LabUsage }
  | { status: "unavailable"; reason?: string };

/** Follows the usage of a running lab while its card is visible; returns the stop function. */
export type WatchLabUsage = (card: LabOverviewCard, listener: (update: LabUsageUpdate) => void) => () => void;

function pushLimited(history: number[], value: number): number[] {
  const next = [...history, value];
  if (next.length > LAB_USAGE_HISTORY) next.splice(0, next.length - LAB_USAGE_HISTORY);
  return next;
}

/** Totals of one sample over the lab's nodes. */
function sumNodes(sample: HostNodeStatsSample) {
  const nodes: Record<string, LabNodeUsage> = {};
  let cpuPercent: number | undefined;
  let cpuCount: number | undefined;
  let memoryBytes = 0;
  const limits = new Set<number | undefined>();
  for (const node of sample.nodes) {
    const usage: LabNodeUsage = { memoryBytes: node.memoryBytes };
    if (node.cpuPercent !== undefined) {
      usage.cpuPercent = node.cpuPercent;
      cpuPercent = (cpuPercent ?? 0) + node.cpuPercent;
    }
    nodes[node.nodeName || node.name] = usage;
    memoryBytes += node.memoryBytes;
    if (node.cpuCount !== undefined) cpuCount = Math.max(cpuCount ?? 0, node.cpuCount);
    limits.add(node.memoryLimitBytes);
  }
  // Nodes without a limit of their own all report the host's memory; other limits say nothing about the host.
  const memoryLimitBytes = limits.size === 1 ? [...limits][0] : undefined;
  return { nodes, cpuPercent: cpuPercent === undefined ? undefined : Math.round(cpuPercent * 10) / 10, cpuCount, memoryBytes, memoryLimitBytes };
}

/** The lab's usage after `sample`, carrying the sparkline history of `previous`. */
export function nextLabUsage(previous: LabUsage | undefined, sample: HostNodeStatsSample): LabUsage {
  const { nodes, cpuPercent, cpuCount, memoryBytes, memoryLimitBytes } = sumNodes(sample);
  const cpuHistory = previous?.cpuHistory ?? [];
  return {
    time: Date.parse(sample.time) || Date.now(),
    ...(cpuPercent !== undefined ? { cpuPercent } : {}),
    ...(cpuCount !== undefined ? { cpuCount } : {}),
    memoryBytes,
    ...(memoryLimitBytes !== undefined ? { memoryLimitBytes } : {}),
    cpuHistory: cpuPercent === undefined ? cpuHistory : pushLimited(cpuHistory, cpuPercent),
    memoryHistory: pushLimited(previous?.memoryHistory ?? [], memoryBytes),
    nodes
  };
}

/** Whether a card's lab runs nodes whose usage can be followed. */
export function canWatchLabUsage(card: LabOverviewCard): boolean {
  return (card.state === "running" || card.state === "partial") && card.labName !== undefined;
}
