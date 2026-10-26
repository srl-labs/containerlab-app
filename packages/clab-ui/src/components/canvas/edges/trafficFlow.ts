// Live traffic per link direction, for the moving dashes on links.

/** Below this rate a direction counts as idle and its dashes stay away. */
export const TRAFFIC_FLOW_MIN_BPS = 1_000;

/** Seconds for one dash cycle: slow near the minimum, fast at multi-gigabit rates. */
const SLOWEST_CYCLE_SECONDS = 1.6;
const FASTEST_CYCLE_SECONDS = 0.18;

export interface TrafficFlows {
  /** Bits per second from the link's source to its target. */
  forwardBps: number;
  /** Bits per second from the link's target to its source. */
  reverseBps: number;
}

function rate(stats: unknown, key: "rxBps" | "txBps"): number | undefined {
  if (typeof stats !== "object" || stats === null) return undefined;
  const value: unknown = Reflect.get(stats, key);
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Each direction from the end that sends it, else from the end that receives it,
 * so a link with stats on one end only still shows both directions.
 */
export function resolveTrafficFlows(extraData: Record<string, unknown> | undefined): TrafficFlows {
  const source = extraData?.clabSourceStats;
  const target = extraData?.clabTargetStats;
  return {
    forwardBps: rate(source, "txBps") ?? rate(target, "rxBps") ?? 0,
    reverseBps: rate(target, "txBps") ?? rate(source, "rxBps") ?? 0
  };
}

/** Cycle time on a log scale, so 1 Mbps and 10 Gbps both look different from idle. */
export function trafficFlowCycleSeconds(bps: number): number {
  const decades = Math.log10(Math.max(bps, TRAFFIC_FLOW_MIN_BPS) / TRAFFIC_FLOW_MIN_BPS);
  const seconds = SLOWEST_CYCLE_SECONDS / (1 + decades);
  return Math.min(SLOWEST_CYCLE_SECONDS, Math.max(FASTEST_CYCLE_SECONDS, seconds));
}
