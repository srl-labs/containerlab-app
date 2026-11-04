/**
 * Recent traffic of link endpoints, kept per endpoint key for the traffic charts.
 * Without the charts' dependencies, so the canvas can record samples before a chart shows.
 */
import type { EndpointStatsHistory, InterfaceStatsPayload } from "../core/types/topology";

export const MAX_GRAPH_POINTS = 60;
export const MIN_TIMESTAMP_STEP_SECONDS = 0.001;
const DELAY_FALLBACK_MULTIPLIER = 3;

const historyStore = new Map<string, EndpointStatsHistory>();
// The sample each key took last; the same sample is not counted twice.
const lastSamples = new Map<string, InterfaceStatsPayload>();

/** The history key of one end of a link; the link panel and hover card share it. */
export function linkTrafficKey(side: "a" | "b", node: string, endpoint: string): string {
  return `${side}:${node}:${endpoint}`;
}

function createEmptyHistory(): EndpointStatsHistory {
  return {
    timestamps: [],
    rxBps: [],
    txBps: [],
    rxPps: [],
    txPps: []
  };
}

export function resolveValidIntervalSeconds(stats: InterfaceStatsPayload | undefined): number | undefined {
  const interval = stats?.statsIntervalSeconds;
  if (typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0) {
    return undefined;
  }
  return interval;
}

function resolveNextTimestampSeconds(
  history: EndpointStatsHistory,
  stats: InterfaceStatsPayload | undefined,
  nowSeconds: number
): number {
  const prev = history.timestamps[history.timestamps.length - 1];
  if (typeof prev !== "number" || !Number.isFinite(prev)) {
    return nowSeconds;
  }

  const interval = resolveValidIntervalSeconds(stats);
  if (interval === undefined) {
    return Math.max(nowSeconds, prev + MIN_TIMESTAMP_STEP_SECONDS);
  }

  const expected = prev + interval;
  if (nowSeconds - expected > interval * DELAY_FALLBACK_MULTIPLIER) {
    return nowSeconds;
  }

  return expected;
}

function trimHistory(history: EndpointStatsHistory): void {
  while (history.timestamps.length > MAX_GRAPH_POINTS) {
    history.timestamps.shift();
    history.rxBps.shift();
    history.txBps.shift();
    history.rxPps.shift();
    history.txPps.shift();
  }
}

/** Adds a sample to the endpoint's history, unless it is the one it took last; returns the history. */
export function recordTrafficSample(
  endpointKey: string,
  stats: InterfaceStatsPayload | undefined,
  nowMs: number = Date.now()
): EndpointStatsHistory {
  let history = historyStore.get(endpointKey);
  if (!history) {
    history = createEmptyHistory();
    historyStore.set(endpointKey, history);
  }
  if (!stats || stats === lastSamples.get(endpointKey)) {
    return history;
  }

  lastSamples.set(endpointKey, stats);
  history.timestamps.push(resolveNextTimestampSeconds(history, stats, nowMs / 1000));
  history.rxBps.push(stats.rxBps ?? 0);
  history.txBps.push(stats.txBps ?? 0);
  history.rxPps.push(stats.rxPps ?? 0);
  history.txPps.push(stats.txPps ?? 0);
  trimHistory(history);
  return history;
}
