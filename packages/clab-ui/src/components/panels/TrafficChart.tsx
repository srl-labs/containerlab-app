// Real-time traffic chart for link endpoints.
import React, { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import { LineChart } from "@mui/x-charts/LineChart";

import type { InterfaceStatsPayload, EndpointStatsHistory } from "../../core/types/topology";
import {
  MAX_GRAPH_POINTS,
  MIN_TIMESTAMP_STEP_SECONDS,
  recordTrafficSample,
  resolveValidIntervalSeconds
} from "../../utils/trafficHistory";


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

function resolveChartMargin(compact: boolean, showLegend: boolean, scale: number) {
  if (!compact) {
    return { top: 8, right: 48, bottom: 24, left: 48 };
  }

  // The legend is rendered inside the SVG bottom margin.
  const legendHeight = showLegend ? Math.round(14 * scale) : 0;
  return { top: 6, right: 2, bottom: legendHeight, left: 0 };
}

function resolveLegendSlotProps(compact: boolean, showLegend: boolean, scale: number) {
  if (!showLegend) {
    return undefined;
  }

  if (!compact) {
    return {
      legend: {
        direction: "horizontal" as const,
        position: { vertical: "bottom" as const, horizontal: "center" as const }
      }
    };
  }

  const fontSize = `${(0.6 * scale).toFixed(3)}rem`;
  const markSize = `${(0.65 * scale).toFixed(2)}em`;

  return {
    legend: {
      direction: "horizontal" as const,
      position: { vertical: "bottom" as const, horizontal: "center" as const },
      sx: {
        fontSize,
        lineHeight: 1,
        padding: 0,
        gap: 0.25,
        "& .MuiChartsLegend-series": {
          gap: 0.25
        },
        "& .MuiChartsLegend-mark": {
          fontSize: markSize
        }
      }
    }
  };
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

// The panel chart follows the host theme; the compact canvas chart keeps its own palette.
const PANEL_MUTED_TEXT = "var(--vscode-descriptionForeground)";
const PANEL_GRID_STROKE = "var(--vscode-panel-border)";
const PANEL_TICK_LABEL_STYLE = { fontSize: 10, fill: PANEL_MUTED_TEXT };
const PANEL_AXIS_LABEL_STYLE = { fontSize: 11, fill: PANEL_MUTED_TEXT };

function buildXAxis(
  compact: boolean,
  xData: Date[],
  xMin: Date | undefined,
  xMax: Date | undefined
) {
  const baseAxis = {
    data: xData,
    scaleType: "time" as const,
    min: xMin,
    max: xMax,
    disableLine: true,
    disableTicks: true,
    valueFormatter: (value: Date) =>
      value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  };
  if (compact) {
    return [{ ...baseAxis, position: "none" as const, height: 0 }];
  }
  return [{ ...baseAxis, tickLabelStyle: PANEL_TICK_LABEL_STYLE, height: 20 }];
}

function buildYAxis(compact: boolean, scale: number, unitLabel: string) {
  if (compact) {
    return [
      {
        id: "bps",
        position: "left" as const,
        disableTicks: true,
        tickLabelStyle: { fontSize: Math.round(8 * scale), fill: "#9aa0a6" },
        valueFormatter: (value: number) => `${value} ${unitLabel}`
      },
      {
        id: "pps",
        position: "none" as const,
        width: 0
      }
    ];
  }

  return [
    {
      id: "bps",
      label: unitLabel,
      labelStyle: PANEL_AXIS_LABEL_STYLE,
      tickLabelStyle: PANEL_TICK_LABEL_STYLE
    },
    {
      id: "pps",
      label: "PPS",
      labelStyle: PANEL_AXIS_LABEL_STYLE,
      tickLabelStyle: PANEL_TICK_LABEL_STYLE
    }
  ];
}

function resolveSeriesLabel(
  compact: boolean,
  showLegend: boolean,
  label: string
): string | undefined {
  return compact && !showLegend ? undefined : label;
}

function buildSeries(params: {
  compact: boolean;
  showLegend: boolean;
  unitLabel: string;
  rxBpsData: number[];
  txBpsData: number[];
  rxPpsData: number[];
  txPpsData: number[];
}) {
  return [
    {
      data: params.rxBpsData,
      label: resolveSeriesLabel(params.compact, params.showLegend, `RX ${params.unitLabel}`),
      color: "#4ec9b0",
      showMark: false,
      curve: "linear" as const,
      yAxisId: "bps"
    },
    {
      data: params.txBpsData,
      label: resolveSeriesLabel(params.compact, params.showLegend, `TX ${params.unitLabel}`),
      color: "#569cd6",
      showMark: false,
      curve: "linear" as const,
      yAxisId: "bps"
    },
    {
      data: params.rxPpsData,
      label: resolveSeriesLabel(params.compact, params.showLegend, "RX PPS"),
      color: "#b5cea8",
      showMark: false,
      curve: "linear" as const,
      yAxisId: "pps"
    },
    {
      data: params.txPpsData,
      label: resolveSeriesLabel(params.compact, params.showLegend, "TX PPS"),
      color: "#9cdcfe",
      showMark: false,
      curve: "linear" as const,
      yAxisId: "pps"
    }
  ];
}

export const TrafficChart: React.FC<TrafficChartProps> = ({
  stats,
  endpointKey,
  height,
  compact = false,
  showLegend = !compact,
  scale = 1,
  emptyMessage = "No traffic data available"
}) => {
  const resolvedHeight = height ?? (compact ? "100%" : 240);
  const { xData, rxBpsData, txBpsData, rxPpsData, txPpsData, unitLabel, xMin, xMax } =
    useMemo(() => {
      return buildChartData(recordTrafficSample(endpointKey, stats), stats);
    }, [stats, endpointKey]);
  const margin = resolveChartMargin(compact, showLegend, scale);
  const legendSlotProps = resolveLegendSlotProps(compact, showLegend, scale);
  const xAxis = buildXAxis(compact, xData, xMin, xMax);
  const yAxis = buildYAxis(compact, scale, unitLabel);
  const series = buildSeries({
    compact,
    showLegend,
    unitLabel,
    rxBpsData,
    txBpsData,
    rxPpsData,
    txPpsData
  });
  const chartSx: SxProps<Theme> = compact
    ? {
        "& .MuiChartsGrid-line": { stroke: "#3e3e42" },
        "& .MuiChartsAxis-line": { stroke: "#3e3e42" }
      }
    : {
        "& .MuiChartsGrid-line": { stroke: PANEL_GRID_STROKE },
        "& .MuiChartsAxis-line": { stroke: PANEL_GRID_STROKE },
        "& .MuiChartsAxis-tick": { stroke: PANEL_GRID_STROKE },
        "& .MuiChartsAxisHighlight-root": { stroke: PANEL_MUTED_TEXT },
        "& .MuiChartsAxis-label": { fill: PANEL_MUTED_TEXT },
        "& .MuiChartsLegend-label": { fill: PANEL_MUTED_TEXT, color: PANEL_MUTED_TEXT }
      };

  if (xData.length === 0) {
    if (emptyMessage === null) return null;
    return (
      <Typography variant="body2" sx={{ textAlign: "center", color: "text.secondary", py: 3 }}>
        {emptyMessage}
      </Typography>
    );
  }

  return (
    <Box sx={{ width: "100%", height: resolvedHeight }}>
      <LineChart
        xAxis={xAxis}
        yAxis={yAxis}
        series={series}
        grid={{ horizontal: true }}
        margin={margin}
        slotProps={legendSlotProps}
        sx={chartSx}
      />
    </Box>
  );
};
