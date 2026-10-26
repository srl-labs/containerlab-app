// What the hover card shows about a topology node: kind, image, state, addresses and usage.
import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import type { NodeData } from "../../../hooks/ui";
import { useGraphStore } from "../../../stores/graphStore";
import { findNodeStatsSeries, useNodeStatsStore } from "../../../stores/nodeStatsStore";
import type { NodeReadiness } from "../../../topology/runtime";
import { CPU_LOAD_COLORS, cpuLoadLevel, formatBytes, formatPercent } from "../../../utils/resourceUsage";
import { extractNodeDisplayProps } from "../nodes/nodeDisplayProps";
import { useNodeReadiness } from "../nodes/useNodeReadiness";

import { CardTitle, Label, RowGrid, Value } from "./HoverCardParts";

const READINESS_LABELS: Record<NodeReadiness, string> = {
  ready: "Running",
  starting: "Starting",
  stopping: "Stopping",
  unhealthy: "Unhealthy",
  paused: "Paused",
  stopped: "Stopped"
};

function readinessColor(readiness: NodeReadiness | undefined): string {
  switch (readiness) {
    case "ready":
      return "success.main";
    case "starting":
    case "stopping":
      return "info.main";
    case "unhealthy":
    case "paused":
      return "warning.main";
    case "stopped":
      return "error.main";
    default:
      return "text.disabled";
  }
}

/** CPU and memory of the running node, when the lab host reports them. */
function UsageRows({ containerName, nodeId }: { containerName: string | undefined; nodeId: string }) {
  const latest = useNodeStatsStore((state) => findNodeStatsSeries(state, containerName, nodeId)?.latest);
  if (!latest) return null;
  const cpu = latest.cpuPercent;
  const memory = latest.memoryLimitBytes !== undefined
    ? `${formatBytes(latest.memoryBytes)} of ${formatBytes(latest.memoryLimitBytes)}`
    : formatBytes(latest.memoryBytes);
  return (
    <>
      <Label>CPU</Label>
      <Box component="dd" sx={{ m: 0, display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        <Typography variant="caption" data-testid="node-hover-card-cpu" sx={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
          {formatPercent(cpu)}
        </Typography>
        {cpu !== undefined ? (
          <Box sx={{ flex: 1, height: 4, borderRadius: 2, bgcolor: "action.hover", overflow: "hidden" }}>
            <Box
              sx={{
                width: `${Math.max(2, Math.min(100, cpu))}%`,
                height: "100%",
                borderRadius: 2,
                bgcolor: CPU_LOAD_COLORS[cpuLoadLevel(cpu)]
              }}
            />
          </Box>
        ) : null}
      </Box>
      <Label>Memory</Label>
      <Value value={memory} testId="node-hover-card-memory" />
    </>
  );
}

export function NodeHoverCardContent({ nodeId }: { nodeId: string }) {
  const data = useGraphStore((state) => state.nodes.find((node) => node.id === nodeId)?.data);
  const readiness = useNodeReadiness(nodeId, data);
  if (!data) return null;
  const nodeData: NodeData = { ...data, id: nodeId };
  const { nodeName, kind, image, mgmtIpv4, mgmtIpv6, containerName } = extractNodeDisplayProps(nodeData);
  const deployed = readiness !== undefined;
  return (
    <>
      <CardTitle
        title={nodeName}
        state={readiness ? READINESS_LABELS[readiness] : "Not deployed"}
        stateValue={readiness ?? "undeployed"}
        stateColor={readinessColor(readiness)}
        stateTestId="node-hover-card-state"
      />
      <RowGrid columns={1}>
        {kind ? <><Label>Kind</Label><Value value={kind} testId="node-hover-card-kind" /></> : null}
        {image ? <><Label>Image</Label><Value value={image} mono testId="node-hover-card-image" /></> : null}
        {deployed && mgmtIpv4 ? <><Label>IPv4</Label><Value value={mgmtIpv4} mono testId="node-hover-card-ipv4" /></> : null}
        {deployed && mgmtIpv6 ? <><Label>IPv6</Label><Value value={mgmtIpv6} mono testId="node-hover-card-ipv6" /></> : null}
        {deployed ? <UsageRows containerName={containerName} nodeId={nodeId} /> : null}
      </RowGrid>
    </>
  );
}
