// Real-time traffic chart for link endpoints.
import React, { useRef, useMemo } from "react";
import { Box, Text } from "@mantine/core";
import { LineChart } from "@mantine/charts";

import type { InterfaceStatsPayload, EndpointStatsHistory } from "../../core/types/topology";

const MAX_GRAPH_POINTS = 60;
const MIN_TIMESTAMP_STEP_SECONDS = 0.001;
const DELAY_FALLBACK_MULTIPLIER = 3;

interface BpsUnit {
  divisor: number;
  label: string;
}

interface TrafficChartProps {
  stats: InterfaceStatsPayload | undefined;
  endpointKey: string;
  height?: number | "100%";
  compact?: boolean;
  showLegend?: boolean;
  /** Scale factor for compact legend sizing (1 = default). */
  scale?: number;
  emptyMessage?: string | null;
}

/**
 * Determine the appropriate unit for BPS display based on max value
 */
function determineBpsUnit(maxBps: number): BpsUnit {
  if (maxBps >= 1_000_000_000) {
    return { divisor: 1_000_000_000, label: "Gbps" };
  } else if (maxBps >= 1_000_000) {
    return { divisor: 1_000_000, label: "Mbps" };
  } else if (maxBps >= 1_000) {
    return { divisor: 1_000, label: "Kbps" };
  }
  return { divisor: 1, label: "bps" };
}

/**
 * Create initial empty history
 */
function createEmptyHistory(): EndpointStatsHistory {
  return {
    timestamps: [],
    rxBps: [],
    txBps: [],
    rxPps: [],
    txPps: []
  };
}

function resolveValidIntervalSeconds(stats: InterfaceStatsPayload | undefined): number | undefined {
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

// Global history store per endpoint key
const historyStore = new Map<string, EndpointStatsHistory>();

function getOrCreateHistory(endpointKey: string): EndpointStatsHistory {
  let history = historyStore.get(endpointKey);
  if (!history) {
    history = createEmptyHistory();
    historyStore.set(endpointKey, history);
  }
  return history;
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

function appendStatsSample(
  history: EndpointStatsHistory,
  stats: InterfaceStatsPayload | undefined,
  lastStatsRef: { current: InterfaceStatsPayload | undefined }
): void {
  if (!stats || stats === lastStatsRef.current) {
    return;
  }

  lastStatsRef.current = stats;
  history.timestamps.push(resolveNextTimestampSeconds(history, stats, Date.now() / 1000));
  history.rxBps.push(stats.rxBps ?? 0);
  history.txBps.push(stats.txBps ?? 0);
  history.rxPps.push(stats.rxPps ?? 0);
  history.txPps.push(stats.txPps ?? 0);
  trimHistory(history);
}

function resolveWindowIntervalSeconds(
  history: EndpointStatsHistory,
  stats: InterfaceStatsPayload | undefined
): number {
  const configuredInterval = resolveValidIntervalSeconds(stats);
  if (configuredInterval !== undefined) {
    return configuredInterval;
  }

  if (history.timestamps.length < 2) {
    return 1;
  }

  const nextToLast = history.timestamps[history.timestamps.length - 2];
  const last = history.timestamps[history.timestamps.length - 1];
  return Math.max(last - nextToLast, MIN_TIMESTAMP_STEP_SECONDS);
}

function resolveXAxisWindow(
  history: EndpointStatsHistory,
  stats: InterfaceStatsPayload | undefined
): { xMin: Date | undefined; xMax: Date | undefined } {
  const lastTimestamp = history.timestamps[history.timestamps.length - 1];
  if (typeof lastTimestamp !== "number" || !Number.isFinite(lastTimestamp)) {
    return { xMin: undefined, xMax: undefined };
  }

  const intervalSeconds = resolveWindowIntervalSeconds(history, stats);
  const visiblePointSpan = Math.max(
    1,
    Math.min(history.timestamps.length - 1, MAX_GRAPH_POINTS - 1)
  );
  const windowSeconds = intervalSeconds * visiblePointSpan;
  return {
    xMin: new Date((lastTimestamp - windowSeconds) * 1000),
    xMax: new Date(lastTimestamp * 1000)
  };
}

function buildChartData(
  history: EndpointStatsHistory,
  stats: InterfaceStatsPayload | undefined
): {
  xData: Date[];
  rxBpsData: number[];
  txBpsData: number[];
  rxPpsData: number[];
  txPpsData: number[];
  unitLabel: string;
  xMin: Date | undefined;
  xMax: Date | undefined;
} {
  const maxBps = Math.max(...history.rxBps, ...history.txBps, 1);
  const unit = determineBpsUnit(maxBps);
  const divisor = unit.divisor;
  const xData = history.timestamps.map((ts) => new Date(ts * 1000));
  const { xMin, xMax } = resolveXAxisWindow(history, stats);
  return {
    xData,
    rxBpsData: history.rxBps.map((v) => v / divisor),
    txBpsData: history.txBps.map((v) => v / divisor),
    rxPpsData: [...history.rxPps],
    txPpsData: [...history.txPps],
    unitLabel: unit.label,
    xMin,
    xMax
  };
}

interface ChartPoint {
  t: string;
  rxBps: number;
  txBps: number;
  rxPps: number;
  txPps: number;
}

function buildPoints(
  xData: Date[],
  rxBpsData: number[],
  txBpsData: number[],
  rxPpsData: number[],
  txPpsData: number[]
): ChartPoint[] {
  return xData.map((date, i) => ({
    t: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    rxBps: rxBpsData[i] ?? 0,
    txBps: txBpsData[i] ?? 0,
    rxPps: rxPpsData[i] ?? 0,
    txPps: txPpsData[i] ?? 0
  }));
}

export const TrafficChart: React.FC<TrafficChartProps> = ({
  stats,
  endpointKey,
  height,
  compact = false,
  showLegend = !compact,
  emptyMessage = "No traffic data available"
}) => {
  const resolvedHeight = height ?? (compact ? "100%" : 240);
  // Track last-seen stats to avoid double-push in Strict Mode
  const lastStatsRef = useRef<InterfaceStatsPayload | undefined>(undefined);

  const { xData, rxBpsData, txBpsData, rxPpsData, txPpsData, unitLabel } = useMemo(() => {
    const history = getOrCreateHistory(endpointKey);
    appendStatsSample(history, stats, lastStatsRef);
    return buildChartData(history, stats);
  }, [stats, endpointKey]);

  const data = buildPoints(xData, rxBpsData, txBpsData, rxPpsData, txPpsData);

  const series = [
    { name: "rxBps", label: `RX ${unitLabel}`, color: "#4ec9b0" },
    { name: "txBps", label: `TX ${unitLabel}`, color: "#569cd6" },
    { name: "rxPps", label: "RX PPS", color: "#b5cea8", yAxisId: "right" },
    { name: "txPps", label: "TX PPS", color: "#9cdcfe", yAxisId: "right" }
  ];

  if (xData.length === 0) {
    if (emptyMessage === null) return null;
    return (
      <Text size="sm" c="dimmed" ta="center" mt="xs">
        {emptyMessage}
      </Text>
    );
  }

  return (
    <Box style={{ width: "100%", height: resolvedHeight }}>
      <LineChart
        h="100%"
        data={data}
        dataKey="t"
        series={series}
        withRightYAxis={!compact}
        withXAxis={!compact}
        withYAxis={!compact}
        withDots={false}
        withLegend={showLegend}
        gridAxis={compact ? "none" : "y"}
        curveType="linear"
        yAxisLabel={compact ? undefined : unitLabel}
        rightYAxisLabel={compact ? undefined : "PPS"}
        strokeWidth={1.5}
      />
    </Box>
  );
};
