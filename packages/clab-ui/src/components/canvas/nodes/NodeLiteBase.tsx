/**
 * Shared lightweight node shell for large/zoomed-out graphs.
 */
import React from "react";
import { Handle, Position } from "@xyflow/react";

import type { NodeBoxAppearance } from "../../../core/types/topology";
import { SELECTION_COLOR } from "../types";
import {
  NODE_BOX_THEME_COLORS,
  getNodeBoxFillCss,
  getNodeBoxMetrics,
  resolveNodeBoxPaint,
  type NodeBoxSpacing
} from "../nodeBox";

import { HIDDEN_HANDLE_STYLE } from "./nodeStyles";

const ICON_SIZE = 40;

const CONTAINER_STYLE_BASE: React.CSSProperties = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center"
};

interface LiteNodeShellProps {
  className: string;
  iconStyle: React.CSSProperties;
  size?: number;
  /** Draw the boxed node style's box (same footprint as the full node, no name). */
  boxed?: boolean;
  /** Per-node box look (glass and shadow are skipped at low detail). */
  boxAppearance?: NodeBoxAppearance;
  boxSpacing?: NodeBoxSpacing;
  selected?: boolean;
}

function buildLiteBoxStyle(
  size: number,
  spacing: NodeBoxSpacing | undefined,
  appearance: NodeBoxAppearance | undefined,
  selected: boolean
): React.CSSProperties {
  const box = getNodeBoxMetrics(size, spacing);
  const paint = resolveNodeBoxPaint(appearance, box);
  const borderColor = selected ? SELECTION_COLOR : (paint.borderColor ?? NODE_BOX_THEME_COLORS.border);
  return {
    position: "absolute",
    left: box.offsetX,
    top: box.offsetY,
    width: box.width,
    height: box.height,
    boxSizing: "border-box",
    borderRadius: paint.cornerRadius,
    border: `${Math.max(paint.borderWidth, selected ? 2 : 0)}px solid ${borderColor}`,
    background: getNodeBoxFillCss(paint)
  };
}

export const LiteNodeShell: React.FC<LiteNodeShellProps> = ({
  className,
  iconStyle,
  size = ICON_SIZE,
  boxed = false,
  boxAppearance,
  boxSpacing,
  selected = false
}) => {
  const containerStyle: React.CSSProperties = {
    ...CONTAINER_STYLE_BASE,
    width: size,
    height: size
  };
  return (
    <div style={containerStyle} className={className}>
      <Handle
        type="source"
        position={Position.Bottom}
        id="source"
        style={HIDDEN_HANDLE_STYLE}
        isConnectable={false}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="target"
        style={HIDDEN_HANDLE_STYLE}
        isConnectable={false}
      />
      {boxed && <div style={buildLiteBoxStyle(size, boxSpacing, boxAppearance, selected)} />}
      <div style={boxed ? { ...iconStyle, position: "relative" } : iconStyle} />
    </div>
  );
};
