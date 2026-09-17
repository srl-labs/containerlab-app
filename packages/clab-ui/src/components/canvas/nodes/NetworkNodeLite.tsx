/**
 * NetworkNodeLite - Lightweight renderer for network endpoint nodes
 */
import React, { memo } from "react";
import type { NodeProps } from "@xyflow/react";

import { SELECTION_COLOR } from "../types";
import { useTopoViewerStore } from "../../../stores/topoViewerStore";
import { clampTelemetryNodeSizePx } from "../../../utils/telemetryInterfaceLabels";

import { LiteNodeShell } from "./NodeLiteBase";
import { getNodeDirectionRotation } from "./nodeStyles";
import { getNetworkNodeTypeColor, toNetworkNodeData } from "./networkNodeShared";

const NetworkNodeLiteComponent: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeData = toNetworkNodeData(data);
  const iconSize = useTopoViewerStore((state) =>
    clampTelemetryNodeSizePx(state.telemetryNodeSizePx)
  );
  const color = getNetworkNodeTypeColor(nodeData.nodeType);
  const rotation = getNodeDirectionRotation(nodeData.direction);

  const iconStyle: React.CSSProperties = {
    width: iconSize,
    height: iconSize,
    backgroundColor: color,
    borderRadius: 4,
    transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
    outline: selected ? `2px solid ${SELECTION_COLOR}` : "none",
    outlineOffset: 1
  };

  return <LiteNodeShell className="network-node-lite" iconStyle={iconStyle} size={iconSize} />;
};

function areNetworkNodeLitePropsEqual(prev: NodeProps, next: NodeProps): boolean {
  return prev.data === next.data && prev.selected === next.selected;
}

export const NetworkNodeLite = memo(NetworkNodeLiteComponent, areNetworkNodeLitePropsEqual);
