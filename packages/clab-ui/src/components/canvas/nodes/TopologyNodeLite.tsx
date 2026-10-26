/**
 * TopologyNodeLite - Lightweight node renderer for large/zoomed-out graphs
 */
import React, { memo } from "react";
import type { NodeProps } from "@xyflow/react";

import type { TopologyNodeData } from "../types";
import { SELECTION_COLOR, DEFAULT_ICON_COLOR } from "../types";
import { useNodeBoxAppearance } from "../../../stores/canvasStore";
import {
  useDeploymentState,
  useNodeBoxSpacing,
  useNodeStyle,
  useTopoViewerStore
} from "../../../stores/topoViewerStore";
import { clampTelemetryNodeSizePx } from "../../../utils/telemetryInterfaceLabels";
import { generateLiteSVG } from "../../../icons/SvgGenerator";
import { useCanvasIconInk } from "../../../icons/iconInk";

import { LiteNodeShell } from "./NodeLiteBase";
import {
  getNodeBootingAnimationDelay,
  getNodeDirectionRotation,
  getNodeRuntimeBadgeState,
  getNodeRuntimeIconOpacity
} from "./nodeStyles";
import { isNodeBooting, useNodeReadiness } from "./useNodeReadiness";

function toTopologyNodeData(data: NodeProps["data"]): TopologyNodeData {
  return {
    ...data,
    label: typeof data.label === "string" ? data.label : "",
    role: typeof data.role === "string" ? data.role : ""
  };
}

const TopologyNodeLiteComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const nodeData = toTopologyNodeData(data);
  const deploymentState = useDeploymentState();
  const isBoxed = useNodeStyle() === "boxed";
  const iconInk = useCanvasIconInk(useTopoViewerStore((state) => state.gridBgColor));
  const boxSpacing = useNodeBoxSpacing();
  const boxAppearance = useNodeBoxAppearance(id, nodeData.box);
  const iconSize = useTopoViewerStore((state) =>
    clampTelemetryNodeSizePx(state.telemetryNodeSizePx)
  );
  const color = nodeData.iconColor ?? DEFAULT_ICON_COLOR;
  const corner = nodeData.iconCornerRadius ?? 4;
  const rotation = isBoxed ? 0 : getNodeDirectionRotation(nodeData.direction);
  const runtimeBadgeState = getNodeRuntimeBadgeState(deploymentState, nodeData.state);
  const runtimeIconOpacity = getNodeRuntimeIconOpacity(runtimeBadgeState);
  const readiness = useNodeReadiness(id, data);
  const booting = isNodeBooting(readiness);
  let iconClassName: string | undefined;
  if (booting) iconClassName = "node-booting";
  else if (readiness === "unhealthy") iconClassName = "node-unhealthy";

  const iconStyle: React.CSSProperties = {
    width: iconSize,
    height: iconSize,
    backgroundImage: `url(${generateLiteSVG(color, iconInk)})`,
    backgroundSize: "cover",
    borderRadius: corner,
    transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
    opacity: runtimeIconOpacity,
    outline: selected && !isBoxed ? `2px solid ${SELECTION_COLOR}` : "none",
    outlineOffset: 1,
    animationDelay: booting ? getNodeBootingAnimationDelay(id) : undefined
  };

  return (
    <LiteNodeShell
      className="topology-node-lite"
      iconStyle={iconStyle}
      iconClassName={iconClassName}
      size={iconSize}
      boxed={isBoxed}
      boxSpacing={boxSpacing}
      boxAppearance={boxAppearance}
      selected={selected}
    />
  );
};

function areTopologyNodeLitePropsEqual(prev: NodeProps, next: NodeProps): boolean {
  return prev.id === next.id && prev.data === next.data && prev.selected === next.selected;
}

export const TopologyNodeLite = memo(TopologyNodeLiteComponent, areTopologyNodeLitePropsEqual);
