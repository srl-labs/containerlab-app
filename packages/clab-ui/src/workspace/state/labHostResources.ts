/**
 * The lab hosts on the labs overview: how much CPU, memory and disk each has
 * left, so a new lab goes where it fits.
 */
import type { EndpointHealthMetrics, EndpointStatus } from "../types";
import type { LabOverviewCard } from "./labsOverview";

/** A lab host as the overview lists it. */
export interface LabOverviewHost {
  id: string;
  label: string;
  /** Usage is asked only of hosts that are connected. */
  status: EndpointStatus;
}

/** Fetches a lab host's CPU, memory and disk usage. */
export type FetchLabHostMetrics = (endpointId: string, signal: AbortSignal) => Promise<EndpointHealthMetrics>;

export type LabHostMetricsState =
  | { status: "loading" }
  | { status: "ready"; metrics: EndpointHealthMetrics }
  | { status: "error"; message: string };

/** How full a resource is: comfortable, getting tight, or nearly out. */
type LabHostUsageLevel = "ok" | "busy" | "full";

export function labHostUsageLevel(percent: number | undefined): LabHostUsageLevel {
  if (percent === undefined || !Number.isFinite(percent)) return "ok";
  if (percent >= 90) return "full";
  if (percent >= 70) return "busy";
  return "ok";
}

/** Running labs and their nodes on each lab host. */
export function labHostLoad(cards: readonly LabOverviewCard[]): Map<string, { labs: number; nodes: number }> {
  const load = new Map<string, { labs: number; nodes: number }>();
  for (const card of cards) {
    if (card.state === "undeployed") continue;
    const entry = load.get(card.endpointId) ?? { labs: 0, nodes: 0 };
    entry.labs += 1;
    entry.nodes += card.nodeCount;
    load.set(card.endpointId, entry);
  }
  return load;
}

function availableMemory(metrics: EndpointHealthMetrics): number | undefined {
  const mem = metrics.metrics.mem;
  if (!mem) return undefined;
  return Number.isFinite(mem.availableMem) ? mem.availableMem : mem.totalMem - mem.usedMem;
}

/**
 * The lab host with the most room for another lab, when there is a choice:
 * the most free memory, which network OS images run out of first, then the idlest CPU.
 */
export function roomiestLabHost(states: Readonly<Record<string, LabHostMetricsState | undefined>>): string | undefined {
  let best: { id: string; memory: number; cpu: number } | undefined;
  let candidates = 0;
  for (const [id, state] of Object.entries(states)) {
    if (state?.status !== "ready") continue;
    const memory = availableMemory(state.metrics);
    if (memory === undefined) continue;
    candidates += 1;
    const cpu = state.metrics.metrics.cpu?.usagePercent ?? 100;
    if (!best || memory > best.memory || (memory === best.memory && cpu < best.cpu)) {
      best = { id, memory, cpu };
    }
  }
  return candidates > 1 ? best?.id : undefined;
}
