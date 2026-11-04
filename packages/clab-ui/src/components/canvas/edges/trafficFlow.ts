// Live traffic per link direction, for the moving dashes on links.

/** Below this rate a direction counts as idle and its dashes stay away. */
export const TRAFFIC_FLOW_MIN_BPS = 1_000;

/** Dash length and thickness; only the gap and the speed tell traffic apart. */
const DASH_LENGTH = 8;
const FLOW_WIDTH = 2;
/** Room between a lane and the edge of its link. */
const LANE_GAP = 1.5;
/** The gap at the lab's quietest and busiest traffic. */
const WIDEST_GAP = 28;
const NARROWEST_GAP = 4;
/** Dash movement in pixels per second at the lab's quietest and busiest traffic. */
const SLOWEST_SPEED = 10;
const FASTEST_SPEED = 80;
/** Levels between quietest and busiest, so small rate changes don't make dashes jump. */
const LEVEL_STEPS = 4;
/**
 * The least range the scale spans. Links at 100 and 101 Mbps look alike, instead
 * of one looking idle only because it's the lowest.
 */
const MIN_RANGE_DECADES = 1;

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

/** The lowest and highest rate of any link direction that has traffic; zero without traffic. */
export interface LabTrafficRange {
  minBps: number;
  maxBps: number;
}

let cachedEdges: readonly unknown[] | undefined;
let cachedRange: LabTrafficRange = { minBps: 0, maxBps: 0 };

function extraDataOf(edge: unknown): Record<string, unknown> | undefined {
  if (typeof edge !== "object" || edge === null) return undefined;
  const data: unknown = Reflect.get(edge, "data");
  if (typeof data !== "object" || data === null) return undefined;
  const extraData: unknown = Reflect.get(data, "extraData");
  return typeof extraData === "object" && extraData !== null
    ? (extraData as Record<string, unknown>)
    : undefined;
}

/** Every link's selector asks this on every graph change, so it's kept per edge list. */
export function labTrafficRange(edges: readonly unknown[]): LabTrafficRange {
  if (edges === cachedEdges) return cachedRange;
  let minBps = Number.POSITIVE_INFINITY;
  let maxBps = 0;
  for (const edge of edges) {
    const flows = resolveTrafficFlows(extraDataOf(edge));
    for (const bps of [flows.forwardBps, flows.reverseBps]) {
      if (bps < TRAFFIC_FLOW_MIN_BPS) continue;
      minBps = Math.min(minBps, bps);
      maxBps = Math.max(maxBps, bps);
    }
  }
  cachedEdges = edges;
  cachedRange = maxBps === 0 ? { minBps: 0, maxBps: 0 } : { minBps, maxBps };
  return cachedRange;
}

/**
 * Where a rate sits in the lab, from 0 (quietest) to 1 (busiest), on a log scale,
 * because rates in one lab can span many orders of magnitude.
 */
export function trafficLevel(bps: number, range: LabTrafficRange): number {
  if (range.maxBps <= 0 || bps <= 0) return 0;
  const rangeDecades = Math.max(Math.log10(range.maxBps / range.minBps), MIN_RANGE_DECADES);
  const level = 1 - Math.log10(range.maxBps / Math.min(bps, range.maxBps)) / rangeDecades;
  return Math.round(Math.max(level, 0) * LEVEL_STEPS) / LEVEL_STEPS;
}

/** How a direction's traffic looks. */
export interface TrafficFlowLook {
  cycleSeconds: number;
  /** One dash and its gap, which is how far the animation moves in a cycle. */
  period: number;
  dashArray: string;
}

/** The busier a link is within its lab, the faster its dashes and the smaller their gaps. */
export function trafficFlowLook(level: number): TrafficFlowLook {
  const gap = Math.round(WIDEST_GAP + (NARROWEST_GAP - WIDEST_GAP) * level);
  const period = DASH_LENGTH + gap;
  const speed = SLOWEST_SPEED * (FASTEST_SPEED / SLOWEST_SPEED) ** level;
  return {
    cycleSeconds: Math.round((100 * period) / speed) / 100,
    period,
    dashArray: `${DASH_LENGTH} ${gap}`
  };
}

export const TRAFFIC_FLOW_WIDTH = FLOW_WIDTH;

/**
 * The whole CSS animation in one value. The direction has to be part of it: setting
 * `animation` again resets a separate `animationDirection`, and React only sets
 * the style properties that changed.
 */
export function trafficFlowAnimation(cycleSeconds: number, reverse: boolean): string {
  const direction = reverse ? "reverse" : "normal";
  return `clabTrafficFlow ${cycleSeconds.toFixed(2)}s linear infinite ${direction}`;
}

/**
 * Where the lane of traffic from source to target runs: beside the link, on the right
 * of the way it travels. The other direction takes the opposite side, so the two
 * never overlap, as on a road. A link without a direction (a loop) has no sides.
 */
export function trafficLaneOffset(
  points: { sx: number; sy: number; tx: number; ty: number },
  linkWidth: number
): { x: number; y: number } {
  const dx = points.tx - points.sx;
  const dy = points.ty - points.sy;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 0, y: 0 };
  const distance = linkWidth / 2 + LANE_GAP + FLOW_WIDTH / 2;
  return { x: (-dy / length) * distance, y: (dx / length) * distance };
}
