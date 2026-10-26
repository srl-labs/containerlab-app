// CPU usage of a running node, from the host's stats stream (Appearance setting).
import React from "react";

import type { NodeBoxAppearance } from "../../../core/types/topology";
import { useNodeRenderConfig } from "../../../stores/canvasStore";
import { findNodeStatsSeries, useNodeStatsStore } from "../../../stores/nodeStatsStore";
import { useDeploymentState, useTopoViewerStore } from "../../../stores/topoViewerStore";
import { CPU_LOAD_COLORS, cpuLoadLevel } from "../../../utils/resourceUsage";
import {
  NODE_BOX_THEME_COLORS,
  getNodeBoxMetrics,
  resolveNodeBoxPaint,
  type NodeBoxSpacing
} from "../nodeBox";

const BADGE_STYLE_BASE: React.CSSProperties = {
  position: "absolute",
  height: 13,
  minWidth: 22,
  padding: "0 3px 1px",
  boxSizing: "border-box",
  borderRadius: 3,
  fontSize: 9,
  fontWeight: 600,
  lineHeight: "12px",
  textAlign: "center",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  pointerEvents: "none",
  zIndex: 4
};

// The same colors as the node name under the icon.
const LABEL_TEXT = "#F5F5F5";
const LABEL_BACKGROUND = "rgba(0, 0, 0, 0.7)";
/** Room between the box outline and the badge inside it. */
const BOX_INSET = 3;

/** The node's box in the boxed node style; the badge then sits inside it. */
export interface NodeCpuBadgeBox {
  iconSize: number;
  spacing: NodeBoxSpacing;
  appearance?: NodeBoxAppearance;
}

/** The badge's text and fill: whole percent, the strip full at one busy CPU. */
function nodeCpuBadgeView(cpuPercent: number): { text: string; fill: number; color: string } {
  const rounded = Math.round(cpuPercent);
  return {
    text: `${rounded}%`,
    fill: Math.min(100, Math.max(0, rounded)),
    color: CPU_LOAD_COLORS[cpuLoadLevel(rounded)]
  };
}

/**
 * Beside the icon, the badge looks like the node name. In a box it has no
 * background of its own: it sits in the box's top right corner in the box's text color.
 */
function badgePlacement(box: NodeCpuBadgeBox | undefined, labelBackground: string | undefined): {
  style: React.CSSProperties;
  background: string;
} {
  if (!box) {
    return {
      style: { right: -12, top: -8, color: LABEL_TEXT },
      background: labelBackground ?? LABEL_BACKGROUND
    };
  }
  const metrics = getNodeBoxMetrics(box.iconSize, box.spacing);
  const paint = resolveNodeBoxPaint(box.appearance, metrics);
  const inset = paint.borderWidth + BOX_INSET;
  return {
    style: {
      right: box.iconSize - (metrics.offsetX + metrics.width) + inset,
      top: metrics.offsetY + inset,
      color: paint.textColor ?? NODE_BOX_THEME_COLORS.text
    },
    background: "transparent"
  };
}

export function NodeCpuBadge({
  nodeId,
  containerName,
  box,
  labelBackground
}: {
  nodeId: string;
  containerName?: string;
  box?: NodeCpuBadgeBox;
  /** The node name's custom background, when it has one. */
  labelBackground?: string;
}) {
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
  const placement = badgePlacement(box, labelBackground);
  const style: React.CSSProperties = {
    ...BADGE_STYLE_BASE,
    ...placement.style,
    // A strip along the bottom edge fills up with the load.
    background: `linear-gradient(${view.color}, ${view.color}) left bottom / ${view.fill}% 2px no-repeat, ${placement.background}`
  };
  return (
    <div
      className="topology-node-cpu-badge"
      data-testid="node-cpu-badge"
      data-cpu={cpuPercent}
      data-boxed={box ? "true" : undefined}
      style={style}
    >
      {view.text}
    </div>
  );
}
