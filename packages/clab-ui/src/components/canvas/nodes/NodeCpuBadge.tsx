// CPU usage of a running node, from the host's stats stream (Appearance setting).
import React from "react";

import { useNodeRenderConfig } from "../../../stores/canvasStore";
import { findNodeStatsSeries, useNodeStatsStore } from "../../../stores/nodeStatsStore";
import { useDeploymentState, useTopoViewerStore } from "../../../stores/topoViewerStore";
import { CPU_LOAD_COLORS, cpuLoadLevel } from "../../../utils/resourceUsage";

const BADGE_STYLE_BASE: React.CSSProperties = {
  position: "absolute",
  right: -12,
  top: -8,
  height: 13,
  minWidth: 22,
  padding: "0 3px 1px",
  boxSizing: "border-box",
  borderRadius: 3,
  color: "#F5F5F5",
  fontSize: 9,
  fontWeight: 600,
  lineHeight: "12px",
  textAlign: "center",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  pointerEvents: "none",
  zIndex: 4
};

const BADGE_BACKGROUND = "rgba(0, 0, 0, 0.7)";

/** The badge's text and fill: whole percent, the strip full at one busy CPU. */
function nodeCpuBadgeView(cpuPercent: number): { text: string; fill: number; color: string } {
  const rounded = Math.round(cpuPercent);
  return {
    text: `${rounded}%`,
    fill: Math.min(100, Math.max(0, rounded)),
    color: CPU_LOAD_COLORS[cpuLoadLevel(rounded)]
  };
}

export function NodeCpuBadge({ nodeId, containerName }: { nodeId: string; containerName?: string }) {
  const enabled = useTopoViewerStore((state) => state.showNodeCpu);
  // Zoomed out too far to read.
  const tooSmall = useNodeRenderConfig().suppressCpuBadges === true;
  const deployed = useDeploymentState() === "deployed";
  // Whole percent, so a node redraws only when its badge reads differently.
  const cpuPercent = useNodeStatsStore((state) => {
    const value = findNodeStatsSeries(state, containerName, nodeId)?.latest.cpuPercent;
    return value === undefined ? undefined : Math.round(value);
  });
  if (!enabled || tooSmall || !deployed || cpuPercent === undefined) return null;
  const view = nodeCpuBadgeView(cpuPercent);
  const style: React.CSSProperties = {
    ...BADGE_STYLE_BASE,
    // A strip along the bottom edge fills up with the load.
    background: `linear-gradient(${view.color}, ${view.color}) left bottom / ${view.fill}% 2px no-repeat, ${BADGE_BACKGROUND}`
  };
  return (
    <div className="topology-node-cpu-badge" data-testid="node-cpu-badge" data-cpu={cpuPercent} style={style}>
      {view.text}
    </div>
  );
}
