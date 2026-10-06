/**
 * Boxed node style: the node icon and its name sit inside a card, and links
 * attach to the card outline instead of the icon.
 *
 * The icon stays the node's anchor (React Flow position and measured size), so
 * switching between styles never moves nodes, groups or geo positions. The box
 * is a square around the icon, with the name on a single row below it.
 */
import {
  NODE_BOX_BLUR_RANGE,
  NODE_BOX_BORDER_WIDTH_RANGE,
  NODE_BOX_OPACITY_RANGE,
  normalizeNodeBoxAppearance,
  type NodeBoxAppearance
} from "../../core/utilities/nodeBoxAppearance";

import type { NodeRect } from "./edgeGeometry";

export type NodeStyle = "icon" | "boxed";

export const DEFAULT_NODE_STYLE: NodeStyle = "icon";

export function parseNodeStyle(value: unknown): NodeStyle | null {
  return value === "icon" || value === "boxed" ? value : null;
}

/** Room between the box outline and the icon and name, for every boxed node. */
export type NodeBoxSpacing = "default" | "narrow";

export const DEFAULT_NODE_BOX_SPACING: NodeBoxSpacing = "default";

export function parseNodeBoxSpacing(value: unknown): NodeBoxSpacing | null {
  return value === "default" || value === "narrow" ? value : null;
}

/** Label font is fixed in px so the box size never depends on the host's root font size. */
export const NODE_BOX_LABEL_FONT_SIZE_PX = 12;
export const NODE_BOX_LABEL_LINE_HEIGHT_PX = 14;
export const NODE_BOX_LABEL_FONT_WEIGHT = 600;
/** Space between the baseline and the bottom of the name's line box. */
const NODE_BOX_LABEL_DESCENT_PX = 3;
const NODE_BOX_ELLIPSIS = "…";

/**
 * Per spacing: the smallest box (default fits about 10 characters of name,
 * narrow about 8), and the side and block padding as a share of the icon size.
 */
const NODE_BOX_SPACING: Record<
  NodeBoxSpacing,
  { minSize: number; padding: [number, number, number]; blockPadding: [number, number, number] }
> = {
  default: { minSize: 80, padding: [0.15, 6, 14], blockPadding: [0.25, 8, 20] },
  narrow: { minSize: 64, padding: [0.1, 4, 10], blockPadding: [0.1, 4, 10] }
};
/** Keeps sub-pixel rounding from tripping the canvas CSS ellipsis fallback. */
const NODE_BOX_LABEL_FIT_MARGIN_PX = 1;
/** Characters kept after the ellipsis, so shortened names keep their distinguishing suffix. */
const NODE_BOX_LABEL_TAIL_CHARS = 6;

export interface NodeBoxMetrics {
  /** Outer size, border included. The box is square. */
  width: number;
  height: number;
  /** Box top-left relative to the icon top-left. */
  offsetX: number;
  offsetY: number;
  /** Space between the side edges and the name. */
  padding: number;
  /** Space between the bottom edge and the name row. */
  labelInset: number;
  /** Default corner radius. */
  borderRadius: number;
  /** Width available to the name. */
  labelMaxWidth: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scaledPadding(iconSize: number, [share, min, max]: [number, number, number]): number {
  return clamp(Math.round(iconSize * share), min, max);
}

export function getNodeBoxMetrics(
  iconSize: number,
  spacing: NodeBoxSpacing = DEFAULT_NODE_BOX_SPACING
): NodeBoxMetrics {
  const config = NODE_BOX_SPACING[spacing];
  const padding = scaledPadding(iconSize, config.padding);
  const blockPadding = scaledPadding(iconSize, config.blockPadding);
  const labelGap = clamp(Math.round(iconSize * 0.05), 2, 6);
  // The icon and the name form one block centered in the square. The name's
  // visible bottom is its baseline, so the block moves down by half the space
  // under the baseline to look evenly spaced from the outline.
  const contentHeight = iconSize + labelGap + NODE_BOX_LABEL_LINE_HEIGHT_PX;
  const size = Math.max(config.minSize, iconSize + padding * 2, contentHeight + blockPadding * 2);
  const inset = (size - contentHeight) / 2;
  const opticalShift = NODE_BOX_LABEL_DESCENT_PX / 2;
  return {
    width: size,
    height: size,
    offsetX: (iconSize - size) / 2,
    offsetY: -(inset + opticalShift),
    padding,
    labelInset: inset - opticalShift,
    borderRadius: clamp(Math.round(size * 0.12), 6, 16),
    labelMaxWidth: size - padding * 2
  };
}

/** Box paint with defaults applied. Colors stay undefined when they follow the theme. */
export interface NodeBoxPaint {
  fill: string | undefined;
  /** 0-1 */
  fillOpacity: number;
  blur: number;
  borderColor: string | undefined;
  borderWidth: number;
  cornerRadius: number;
  textColor: string | undefined;
  shadow: boolean;
}

export function resolveNodeBoxPaint(
  appearance: NodeBoxAppearance | undefined,
  metrics: NodeBoxMetrics
): NodeBoxPaint {
  const box = normalizeNodeBoxAppearance(appearance) ?? {};
  return {
    fill: box.color,
    fillOpacity: (box.opacity ?? NODE_BOX_OPACITY_RANGE.default) / 100,
    blur: box.blur ?? NODE_BOX_BLUR_RANGE.default,
    borderColor: box.borderColor,
    borderWidth: box.borderWidth ?? NODE_BOX_BORDER_WIDTH_RANGE.default,
    cornerRadius: Math.min(box.cornerRadius ?? metrics.borderRadius, metrics.width / 2),
    textColor: box.textColor,
    shadow: box.shadow !== false
  };
}

/**
 * Rect that links attach to. `iconRect` may be in screen space (scaled by zoom);
 * `iconSize` is the unscaled icon size the box metrics derive from.
 */
export function getNodeConnectionRect(
  iconRect: NodeRect,
  nodeStyle: NodeStyle,
  iconSize: number = iconRect.width,
  spacing: NodeBoxSpacing = DEFAULT_NODE_BOX_SPACING
): NodeRect {
  if (nodeStyle !== "boxed" || iconSize <= 0) return iconRect;
  const scale = iconRect.width / iconSize;
  const box = getNodeBoxMetrics(iconSize, spacing);
  return {
    x: iconRect.x + box.offsetX * scale,
    y: iconRect.y + box.offsetY * scale,
    width: box.width * scale,
    height: box.height * scale
  };
}

/**
 * Split a name for middle truncation. The head shrinks with an ellipsis while
 * the tail stays visible, so long names keep their distinguishing suffix.
 */
export function splitNodeBoxLabel(label: string): { head: string; tail: string } {
  const chars = Array.from(label);
  const tailLength = Math.min(NODE_BOX_LABEL_TAIL_CHARS, Math.floor(chars.length / 2));
  return {
    head: chars.slice(0, chars.length - tailLength).join(""),
    tail: chars.slice(chars.length - tailLength).join("")
  };
}

/**
 * Shorten a name in the middle to fit `maxWidth`, matching how the canvas
 * renders it: the longest head that fits, an ellipsis, then the fixed tail.
 */
export function truncateNodeBoxLabel(
  label: string,
  maxWidth: number,
  measure: (text: string) => number
): { text: string; width: number; truncated: boolean } {
  const fullWidth = measure(label);
  if (fullWidth <= maxWidth) return { text: label, width: fullWidth, truncated: false };

  const { head, tail } = splitNodeBoxLabel(label);
  const headChars = Array.from(head);
  for (let length = headChars.length - 1; length > 0; length--) {
    const candidate = headChars.slice(0, length).join("") + NODE_BOX_ELLIPSIS + tail;
    const width = measure(candidate);
    if (width <= maxWidth) return { text: candidate, width, truncated: true };
  }
  const text = NODE_BOX_ELLIPSIS + tail;
  return { text, width: measure(text), truncated: true };
}

/** Name as displayed in the box for this icon size, shortened in the middle when it does not fit. */
export function fitNodeBoxLabel(
  label: string,
  iconSize: number,
  measure: (text: string) => number,
  spacing: NodeBoxSpacing = DEFAULT_NODE_BOX_SPACING
): { text: string; width: number; truncated: boolean } {
  const maxWidth =
    getNodeBoxMetrics(iconSize, spacing).labelMaxWidth - NODE_BOX_LABEL_FIT_MARGIN_PX;
  return truncateNodeBoxLabel(label, maxWidth, measure);
}

/** Theme colors used for anything a node's box appearance leaves unset. */
export const NODE_BOX_THEME_COLORS = {
  fill: "var(--topoviewer-node-box-background)",
  border: "var(--topoviewer-node-box-border)",
  text: "var(--topoviewer-node-box-foreground)"
} as const;

/** CSS background for the box fill, with its opacity applied. */
export function getNodeBoxFillCss(paint: NodeBoxPaint): string {
  const color = paint.fill ?? NODE_BOX_THEME_COLORS.fill;
  if (paint.fillOpacity >= 1) return color;
  return `color-mix(in srgb, ${color} ${Math.round(paint.fillOpacity * 100)}%, transparent)`;
}
