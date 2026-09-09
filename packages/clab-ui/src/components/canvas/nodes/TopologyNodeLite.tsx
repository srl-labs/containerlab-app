/**
 * TopologyNodeLite - Lightweight node renderer for large/zoomed-out graphs
 */
import React, { memo } from "react";
import type { NodeProps } from "@xyflow/react";

import type { TopologyNodeData } from "../types";
import { SELECTION_COLOR, DEFAULT_ICON_COLOR } from "../types";
import { useDeploymentState, useTopoViewerStore } from "../../../stores/topoViewerStore";
import { clampTelemetryNodeSizePx } from "../../../utils/telemetryInterfaceLabels";

import { LiteNodeShell } from "./NodeLiteBase";
import {
  getNodeDirectionRotation,
  getNodeRuntimeBadgeState,
  getNodeRuntimeIconOpacity
} from "./nodeStyles";

function toTopologyNodeData(data: NodeProps["data"]): TopologyNodeData {
  return {
    ...data,
    label: typeof data.label === "string" ? data.label : "",
    role: typeof data.role === "string" ? data.role : ""
  };
}

const TopologyNodeLiteComponent: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeData = toTopologyNodeData(data);
  const deploymentState = useDeploymentState();
  const iconSize = useTopoViewerStore((state) =>
    clampTelemetryNodeSizePx(state.telemetryNodeSizePx)
  );
  const color = nodeData.iconColor ?? DEFAULT_ICON_COLOR;
  const corner = nodeData.iconCornerRadius ?? 4;
  const rotation = getNodeDirectionRotation(nodeData.direction);
  const runtimeBadgeState = getNodeRuntimeBadgeState(deploymentState, nodeData.state);
  const runtimeIconOpacity = getNodeRuntimeIconOpacity(runtimeBadgeState);

  const iconStyle: React.CSSProperties = {
    width: iconSize,
    height: iconSize,
    backgroundColor: color,
    borderRadius: corner,
    transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
    opacity: runtimeIconOpacity,
    outline: selected ? `2px solid ${SELECTION_COLOR}` : "none",
    outlineOffset: 1
  };

  return <LiteNodeShell className="topology-node-lite" iconStyle={iconStyle} size={iconSize} />;
};

function areTopologyNodeLitePropsEqual(prev: NodeProps, next: NodeProps): boolean {
  return prev.data === next.data && prev.selected === next.selected;
}

export const TopologyNodeLite = memo(TopologyNodeLiteComponent, areTopologyNodeLitePropsEqual);
