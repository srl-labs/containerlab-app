/**
 * NodeBox - card drawn around a node icon in the boxed node style, with the
 * node name inside. The icon stays the node's anchor and the box overflows it,
 * so the icon must be rendered after the box (and positioned) to sit on top.
 */
import React, { memo, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { NodeBoxAppearance } from "../../../core/types/topology";
import { UI_FONT_FAMILY } from "../../../theme/typography";
import { SELECTION_COLOR } from "../types";
import {
  NODE_BOX_LABEL_FONT_SIZE_PX,
  NODE_BOX_LABEL_FONT_WEIGHT,
  NODE_BOX_LABEL_LINE_HEIGHT_PX,
  NODE_BOX_THEME_COLORS,
  fitNodeBoxLabel,
  getNodeBoxFillCss,
  getNodeBoxMetrics,
  resolveNodeBoxPaint,
  type NodeBoxPaint,
  type NodeBoxSpacing
} from "../nodeBox";

const DROP_SHADOW = "0 1px 2px rgba(0, 0, 0, 0.16)";
const LINK_TARGET_GLOW = `0 0 12px 2px color-mix(in srgb, ${SELECTION_COLOR} 45%, transparent)`;

let measureContext: CanvasRenderingContext2D | null | undefined;

function measureText(text: string, font: string): number {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return 0;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

/**
 * Name shortened in the middle ("srl…xyz") to fit the box, measured with the
 * label's rendered font before paint. `title` carries the full name while it is
 * shortened; put it on the node root so hovering the icon or the box shows it.
 */
export function useNodeBoxLabel(
  label: string,
  iconSize: number,
  enabled: boolean,
  spacing: NodeBoxSpacing
): {
  labelRef: React.RefObject<HTMLDivElement | null>;
  text: string;
  title: string | undefined;
} {
  const labelRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(label);

  useLayoutEffect(() => {
    const element = labelRef.current;
    if (!enabled || !element) {
      setText(label);
      return;
    }
    const style = getComputedStyle(element);
    const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    setText(fitNodeBoxLabel(label, iconSize, (value) => measureText(value, font), spacing).text);
  }, [label, iconSize, enabled, spacing]);

  return { labelRef, text, title: text !== label ? label : undefined };
}

interface NodeBoxProps {
  className: string;
  iconSize: number;
  spacing: NodeBoxSpacing;
  /** Name as displayed (already shortened); omitted when labels are hidden. */
  labelText?: string;
  labelRef?: React.Ref<HTMLDivElement>;
  /** Per-node look; unset fields follow the theme. */
  appearance?: NodeBoxAppearance;
  selected: boolean;
  /** Hovered as a link target while creating a link. */
  highlighted?: boolean;
  /** Extra box-shadow (e.g. the easter egg glow). */
  glow?: string;
}

function getBoxShadow(
  paint: NodeBoxPaint,
  active: boolean,
  highlighted: boolean,
  glow: string | undefined
): string {
  const layers: string[] = [];
  // Selection reads as a 2px outline: the border plus a ring, or a wider ring without a border.
  if (active) layers.push(`0 0 0 ${paint.borderWidth > 0 ? 1 : 2}px ${SELECTION_COLOR}`);
  if (highlighted) layers.push(LINK_TARGET_GLOW);
  if (paint.shadow) layers.push(DROP_SHADOW);
  if (glow !== undefined) layers.push(glow);
  return layers.length > 0 ? layers.join(", ") : "none";
}

const NodeBoxComponent: React.FC<NodeBoxProps> = ({
  className,
  iconSize,
  spacing,
  labelText,
  labelRef,
  appearance,
  selected,
  highlighted = false,
  glow
}) => {
  const box = useMemo(() => getNodeBoxMetrics(iconSize, spacing), [iconSize, spacing]);
  const paint = useMemo(() => resolveNodeBoxPaint(appearance, box), [appearance, box]);
  const isActive = selected || highlighted;

  const boxStyle = useMemo((): React.CSSProperties => {
    const backdrop = paint.blur > 0 ? `blur(${paint.blur}px) saturate(140%)` : undefined;
    return {
      position: "absolute",
      left: box.offsetX,
      top: box.offsetY,
      width: box.width,
      height: box.height,
      boxSizing: "border-box",
      borderRadius: paint.cornerRadius,
      border:
        paint.borderWidth > 0
          ? `${paint.borderWidth}px solid ${
              isActive ? SELECTION_COLOR : (paint.borderColor ?? NODE_BOX_THEME_COLORS.border)
            }`
          : "none",
      background: getNodeBoxFillCss(paint),
      backdropFilter: backdrop,
      WebkitBackdropFilter: backdrop,
      boxShadow: getBoxShadow(paint, isActive, highlighted, glow),
      transition: "border-color 120ms ease-in-out, box-shadow 120ms ease-in-out"
    };
  }, [box, paint, isActive, highlighted, glow]);

  // Offsets are measured from inside the border, so subtract it to keep the insets from the outer edge.
  const labelStyle = useMemo((): React.CSSProperties => {
    const sideInset = box.padding - paint.borderWidth;
    return {
      position: "absolute",
      left: sideInset,
      right: sideInset,
      bottom: box.labelInset - paint.borderWidth,
      height: NODE_BOX_LABEL_LINE_HEIGHT_PX,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "pre",
      textAlign: "center",
      fontFamily: UI_FONT_FAMILY,
      fontSize: NODE_BOX_LABEL_FONT_SIZE_PX,
      lineHeight: `${NODE_BOX_LABEL_LINE_HEIGHT_PX}px`,
      fontWeight: NODE_BOX_LABEL_FONT_WEIGHT,
      color: paint.textColor ?? NODE_BOX_THEME_COLORS.text,
      pointerEvents: "none"
    };
  }, [box, paint]);

  return (
    <div style={boxStyle} className={className}>
      {labelText !== undefined && (
        <div ref={labelRef} style={labelStyle} className="topology-node-box-label">
          {labelText}
        </div>
      )}
    </div>
  );
};

export const NodeBox = memo(NodeBoxComponent);
