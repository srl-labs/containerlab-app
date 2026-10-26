// Live CPU and memory usage of a running node, from the host's stats stream.
import React, { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";

import { findNodeStatsSeries, useNodeStatsStore } from "../../../../stores/nodeStatsStore";
import { formatBytes, formatPercent } from "../../../../utils/resourceUsage";
import { PanelSection } from "../../../ui/form";

const LazySparkline = React.lazy(async () => {
  const module = await import("../../NodeResourceSparkline");
  return { default: module.NodeResourceSparkline };
});

/** The top of the CPU chart: room above the peak, so small loads still show their shape. */
function cpuScaleMax(data: number[]): number {
  return Math.max(10, ...data) * 1.2;
}

function ResourceRow(props: {
  label: string;
  value: string;
  detail?: string;
  testId: string;
  chart: React.ReactNode;
}) {
  return (
    <Box data-testid={props.testId}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
        <Typography variant="caption" sx={{ color: "text.secondary", flex: 1 }}>
          {props.label}
        </Typography>
        <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }} data-testid={`${props.testId}-value`}>
          {props.value}
        </Typography>
      </Box>
      {props.detail ? (
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
          {props.detail}
        </Typography>
      ) : null}
      <Box sx={{ height: 44 }}>
        <React.Suspense fallback={null}>{props.chart}</React.Suspense>
      </Box>
    </Box>
  );
}

export interface NodeResourcesSectionProps {
  /** The node's container name. */
  containerName?: string;
  nodeName?: string;
}

/** Nothing when the host streams no usage, e.g. for files without a lab host. */
export const NodeResourcesSection: React.FC<NodeResourcesSectionProps> = ({ containerName, nodeName }) => {
  const theme = useTheme();
  const available = useNodeStatsStore((state) => state.available);
  const unavailableReason = useNodeStatsStore((state) => state.unavailableReason);
  const series = useNodeStatsStore((state) => findNodeStatsSeries(state, containerName, nodeName));

  const cpuData = useMemo(() => series?.points.map((point) => point.cpuPercent ?? 0) ?? [], [series]);
  const memoryData = useMemo(() => series?.points.map((point) => point.memoryBytes) ?? [], [series]);

  if (available === undefined) return null;
  if (available === false) {
    return (
      <PanelSection title="Resources">
        <Typography variant="body2" sx={{ color: "text.secondary" }} data-testid="node-resources-unavailable">
          {unavailableReason ?? "This lab host does not report node CPU and memory usage."}
        </Typography>
      </PanelSection>
    );
  }
  if (!series) {
    return (
      <PanelSection title="Resources">
        <Typography variant="body2" sx={{ color: "text.secondary" }} data-testid="node-resources-pending">
          Pending: no usage reported for this node yet.
        </Typography>
      </PanelSection>
    );
  }

  const { latest } = series;
  const cpuCount = latest.cpuCount;
  const memoryLimit = latest.memoryLimitBytes;
  const memoryDetail =
    memoryLimit !== undefined && memoryLimit > 0
      ? `of ${formatBytes(memoryLimit)} (${formatPercent((latest.memoryBytes / memoryLimit) * 100)})`
      : undefined;
  const cpuDetail = [
    cpuCount !== undefined ? `100 % is one CPU, ${cpuCount} available` : undefined,
    latest.pids !== undefined ? `${latest.pids} processes` : undefined
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <PanelSection title="Resources">
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }} data-testid="node-resources">
        <ResourceRow
          label="CPU"
          value={formatPercent(latest.cpuPercent)}
          detail={cpuDetail || undefined}
          testId="node-resources-cpu"
          chart={
            <LazySparkline
              data={cpuData}
              color={theme.palette.primary.main}
              max={cpuScaleMax(cpuData)}
              valueFormatter={formatPercent}
            />
          }
        />
        <ResourceRow
          label="Memory"
          value={formatBytes(latest.memoryBytes)}
          detail={memoryDetail}
          testId="node-resources-memory"
          chart={
            <LazySparkline
              data={memoryData}
              color={theme.palette.info.main}
              max={Math.max(1, ...memoryData) * 1.25}
              valueFormatter={(value) => (value === null ? "–" : formatBytes(value))}
            />
          }
        />
      </Box>
    </PanelSection>
  );
};
