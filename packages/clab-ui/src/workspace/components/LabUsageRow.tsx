// A running lab's CPU and memory on its overview card: latest totals over recent history.
import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";

import { formatBytes, formatPercent } from "../../utils/resourceUsage";
import type { LabUsage } from "../state/labUsage";

const SPARK_WIDTH = 100;
const SPARK_HEIGHT = 18;

/** Points of a sparkline across the full width, newest on the right; the scale tops out at `max`. */
function sparklinePoints(data: number[], max: number): Array<[number, number]> {
  const step = data.length > 1 ? SPARK_WIDTH / (data.length - 1) : 0;
  const top = max > 0 ? max : 1;
  return data.map((value, index) => [
    Math.round((data.length > 1 ? index * step : SPARK_WIDTH) * 10) / 10,
    Math.round((SPARK_HEIGHT - 1 - (Math.min(value, top) / top) * (SPARK_HEIGHT - 2)) * 10) / 10
  ]);
}

function Sparkline({ data, max, color }: { data: number[]; max: number; color: string }) {
  const points = sparklinePoints(data, max);
  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <Box
      component="svg"
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      sx={{ display: "block", width: "100%", height: SPARK_HEIGHT, overflow: "visible" }}
    >
      <line x1={0} y1={SPARK_HEIGHT - 0.5} x2={SPARK_WIDTH} y2={SPARK_HEIGHT - 0.5} style={{ stroke: color }} strokeOpacity={0.2} vectorEffect="non-scaling-stroke" />
      {points.length > 1 ? (
        <>
          <polygon points={`${first[0]},${SPARK_HEIGHT} ${line} ${last[0]},${SPARK_HEIGHT}`} style={{ fill: color }} fillOpacity={0.07} />
          <polyline points={line} style={{ fill: "none", stroke: color }} strokeWidth={1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </>
      ) : null}
    </Box>
  );
}

/** How much of the lab host's memory the lab uses, level with the CPU sparkline's baseline. */
function ShareBar({ share, color }: { share: number; color: string }) {
  const percent = Math.min(100, Math.max(0, share * 100));
  return (
    <Box sx={{ height: SPARK_HEIGHT, display: "flex", alignItems: "flex-end" }}>
      <Box
        data-share={Math.round(percent)}
        sx={{ position: "relative", width: "100%", height: 4, borderRadius: 2, overflow: "hidden", bgcolor: "action.hover" }}
      >
        <Box sx={{ position: "absolute", inset: 0, width: `${Math.max(percent, 2)}%`, bgcolor: color, borderRadius: 2 }} />
      </Box>
    </Box>
  );
}

function UsageCell({ label, value, title, testId, chart }: {
  label: string;
  value: string;
  title: string;
  testId: string;
  chart: React.ReactNode;
}) {
  return (
    <Box data-testid={testId} title={title} sx={{ minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5, minWidth: 0 }}>
        <Typography component="span" variant="caption" sx={{ color: "text.secondary", flex: 1 }}>{label}</Typography>
        <Typography
          component="span"
          variant="caption"
          noWrap
          data-testid={`${testId}-value`}
          sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </Typography>
      </Box>
      {chart}
    </Box>
  );
}

/** Dashes until the first sample arrives, so the card does not change height. */
export function LabUsageRow({ usage }: { usage: LabUsage | undefined }) {
  const theme = useTheme();
  const cpuHistory = usage?.cpuHistory ?? [];
  const memoryHistory = usage?.memoryHistory ?? [];
  const cpuTitle = [
    "CPU of the running nodes, where 100 % is one CPU",
    usage?.cpuCount === undefined ? undefined : `${usage.cpuCount} on the lab host`
  ].filter(Boolean).join("; ");
  const memoryTitle = usage?.memoryLimitBytes !== undefined
    ? `Memory of the running nodes, of ${formatBytes(usage.memoryLimitBytes)} on the lab host`
    : "Memory of the running nodes";
  return (
    <Box
      data-testid="lab-card-usage"
      data-status={usage ? "live" : "pending"}
      sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, px: 1.25, pb: 0.75, minWidth: 0 }}
    >
      <UsageCell
        label="CPU"
        value={formatPercent(usage?.cpuPercent)}
        title={cpuTitle}
        testId="lab-card-usage-cpu"
        chart={<Sparkline data={cpuHistory} max={Math.max(10, ...cpuHistory) * 1.4} color={theme.palette.primary.main} />}
      />
      <UsageCell
        label="Memory"
        value={usage ? formatBytes(usage.memoryBytes) : "–"}
        title={memoryTitle}
        testId="lab-card-usage-memory"
        chart={usage?.memoryLimitBytes !== undefined
          ? <ShareBar share={usage.memoryBytes / usage.memoryLimitBytes} color={theme.palette.info.main} />
          : <Sparkline data={memoryHistory} max={Math.max(1, ...memoryHistory) * 1.25} color={theme.palette.info.main} />}
      />
    </Box>
  );
}
