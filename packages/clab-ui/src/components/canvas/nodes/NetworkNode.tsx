/**
 * NetworkNode - Custom React Flow node for network endpoint nodes
 */
import React, { useMemo, memo, useState, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { SELECTION_COLOR } from "../types";
import { generateEncodedSVG } from "../../../icons/SvgGenerator";
import {
  useLinkCreationContext,
  useNodeRenderConfig,
  useEasterEggGlow
} from "../../../stores/canvasStore";
import {
  useNodeBoxSpacing,
  useNodeStyle,
  useTopoViewerStore
} from "../../../stores/topoViewerStore";
import { clampTelemetryNodeSizePx } from "../../../utils/telemetryInterfaceLabels";

import {
  buildNodeLabelStyle,
  HIDDEN_HANDLE_STYLE,
  getEasterEggGlowShadow,
  getNodeDirectionRotation
} from "./nodeStyles";
import { getNetworkNodeTypeColor, toNetworkNodeData } from "./networkNodeShared";
import { NodeBox, useNodeBoxLabel } from "./NodeBox";

const HANDLE_POSITIONS = [
  { position: Position.Top, id: "top" },
  { position: Position.Right, id: "right" },
  { position: Position.Bottom, id: "bottom" },
  { position: Position.Left, id: "left" }
] as const;

/**
 * NetworkNode component renders network endpoint nodes (host, mgmt-net, etc.)
 */
const NetworkNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const nodeData = toNetworkNodeData(data);
  const { label, nodeType, labelPosition, direction, labelBackgroundColor } = nodeData;
  const { linkSourceNode } = useLinkCreationContext();
  const { suppressLabels } = useNodeRenderConfig();
  const easterEggGlow = useEasterEggGlow();
  const isBoxed = useNodeStyle() === "boxed";
  const iconSize = useTopoViewerStore((state) =>
    clampTelemetryNodeSizePx(state.telemetryNodeSizePx)
  );
  const nodeBoxSpacing = useNodeBoxSpacing();
  const boxLabel = useNodeBoxLabel(label, iconSize, isBoxed && !suppressLabels, nodeBoxSpacing);
  const [isHovered, setIsHovered] = useState(false);
  // Direction only applies to the icon style; boxed nodes keep the icon upright.
  const directionRotation = isBoxed ? 0 : getNodeDirectionRotation(direction);
  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);
  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  // Check if this node is a valid link target (in link creation mode and not the source node)
  // Network nodes do not support loop/self-referencing links
  const isLinkTarget = linkSourceNode !== null && linkSourceNode !== id;
  const showLinkTargetHighlight = isLinkTarget && isHovered;

  // Generate the SVG icon URL (cloud icon for all network nodes)
  const svgUrl = useMemo(() => {
    const color = getNetworkNodeTypeColor(nodeType);
    return generateEncodedSVG("cloud", color);
  }, [nodeType]);

  // Node container styles
  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    position: "relative",
    width: iconSize,
    height: iconSize,
    overflow: "visible",
    cursor: isLinkTarget ? "crosshair" : undefined
  };

  const glowShadow = getEasterEggGlowShadow(easterEggGlow);

  // Determine outline based on state - use outline to avoid layout shift
  const getOutlineStyle = (): React.CSSProperties => {
    // The box shows selection, link target and glow in the boxed style
    if (isBoxed) {
      return { outline: "none" };
    }
    // Easter egg glow takes priority
    if (glowShadow !== undefined) {
      return {
        outline: selected ? `2px solid ${SELECTION_COLOR}` : "none",
        outlineOffset: 1,
        boxShadow: glowShadow
      };
    }
    if (showLinkTargetHighlight) {
      return {
        outline: `2px solid ${SELECTION_COLOR}`,
        outlineOffset: 1,
        boxShadow: `0 0 12px 4px ${SELECTION_COLOR}88`
      };
    }
    if (selected) {
      return {
        outline: `2px solid ${SELECTION_COLOR}`,
        outlineOffset: 1
      };
    }
    return {
      outline: "none"
    };
  };

  // Icon styles
  const iconStyle: React.CSSProperties = {
    position: "relative",
    width: iconSize,
    height: iconSize,
    flexShrink: 0,
    backgroundImage: `url(${svgUrl})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundColor: "var(--topoviewer-network-node-background)",
    borderRadius: 4,
    transform: directionRotation !== 0 ? `rotate(${directionRotation}deg)` : undefined,
    ...getOutlineStyle()
  };

  const labelStyle = useMemo(
    () =>
      buildNodeLabelStyle({
        position: labelPosition,
        direction,
        backgroundColor: labelBackgroundColor,
        iconSize,
        fontSize: "0.65rem",
        maxWidth: 110
      }),
    [labelPosition, direction, labelBackgroundColor, iconSize]
  );

  return (
    <div
      style={containerStyle}
      className={isBoxed ? "network-node network-node-boxed" : "network-node"}
      title={isBoxed ? boxLabel.title : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Hidden handles for edge connections - not interactive */}
      {HANDLE_POSITIONS.map(({ position, id }) => (
        <React.Fragment key={id}>
          <Handle
            type="source"
            position={position}
            id={id}
            style={HIDDEN_HANDLE_STYLE}
            isConnectable={false}
          />
          <Handle
            type="target"
            position={position}
            id={`${id}-target`}
            style={HIDDEN_HANDLE_STYLE}
            isConnectable={false}
          />
        </React.Fragment>
      ))}

      {isBoxed && (
        <NodeBox
          className="network-node-box"
          iconSize={iconSize}
          spacing={nodeBoxSpacing}
          labelText={suppressLabels ? undefined : boxLabel.text}
          labelRef={boxLabel.labelRef}
          selected={selected}
          highlighted={showLinkTargetHighlight}
          glow={glowShadow}
        />
      )}

      {/* Node icon */}
      <div style={iconStyle} className="network-node-icon" />

      {/* Node label */}
      {!suppressLabels && !isBoxed && (
        <div style={labelStyle} className="network-node-label">
          {label}
        </div>
      )}
    </div>
  );
};

function areNetworkNodePropsEqual(prev: NodeProps, next: NodeProps): boolean {
  return prev.data === next.data && prev.selected === next.selected;
}

// Memoize to prevent unnecessary re-renders
export const NetworkNode = memo(NetworkNodeComponent, areNetworkNodePropsEqual);
