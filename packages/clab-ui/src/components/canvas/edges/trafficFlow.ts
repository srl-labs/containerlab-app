// Live traffic per link direction, for the moving dashes on links.

/** Below this rate a direction counts as idle and its dashes stay away. */
export const TRAFFIC_FLOW_MIN_BPS = 1_000;

/** Seconds for one dash cycle: slow near the minimum, faster at multi-gigabit rates. */
const SLOWEST_CYCLE_SECONDS = 2.4;
const FASTEST_CYCLE_SECONDS = 0.4;
/** Each decade of traffic shortens the cycle by this share of the slowest one. */
const SPEEDUP_PER_DECADE = 0.5;

/** One dash and its gap; the `clabTrafficFlow` keyframes move by exactly this much. */
export const TRAFFIC_FLOW_DASH_ARRAY = "8 10";
/** Thickness of a lane's dashes. */
export const TRAFFIC_FLOW_WIDTH = 2;
/** Room between a lane and the edge of its link. */
const LANE_GAP = 1.5;

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

/**
 * Cycle time on a log scale, so 1 Mbps and 10 Gbps both look different from idle.
 * It moves in half-decade steps: a new duration makes running dashes jump, and
 * rates change a little with every stats update.
 */
export function trafficFlowCycleSeconds(bps: number): number {
  const decades = Math.round(2 * Math.log10(Math.max(bps, TRAFFIC_FLOW_MIN_BPS) / TRAFFIC_FLOW_MIN_BPS)) / 2;
  const seconds = SLOWEST_CYCLE_SECONDS / (1 + SPEEDUP_PER_DECADE * decades);
  return Math.min(SLOWEST_CYCLE_SECONDS, Math.max(FASTEST_CYCLE_SECONDS, seconds));
}

/**
 * The whole CSS animation in one value. The direction has to be part of it: setting
 * `animation` again resets a separate `animationDirection`, and React only sets
 * the style properties that changed.
 */
export function trafficFlowAnimation(bps: number, reverse: boolean): string {
  const direction = reverse ? "reverse" : "normal";
  return `clabTrafficFlow ${trafficFlowCycleSeconds(bps).toFixed(2)}s linear infinite ${direction}`;
}

/**
 * Where the lane of traffic from source to target runs: beside the link, on the right
 * of the way it travels. The other direction takes the opposite offset, so the
 * two never overlap, as on a road. A link without a direction (a loop) has no sides.
 */
export function trafficLaneOffset(
  points: { sx: number; sy: number; tx: number; ty: number },
  linkWidth: number
): { x: number; y: number } {
  const dx = points.tx - points.sx;
  const dy = points.ty - points.sy;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 0, y: 0 };
  const distance = linkWidth / 2 + LANE_GAP + TRAFFIC_FLOW_WIDTH / 2;
  return { x: (-dy / length) * distance, y: (dx / length) * distance };
}
