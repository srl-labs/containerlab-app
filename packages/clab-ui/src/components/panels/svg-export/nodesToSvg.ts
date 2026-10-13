// Node-to-SVG conversion for export.
import type { Node } from "@xyflow/react";

import { generateEncodedSVG } from "../../../icons/SvgGenerator";
import { getIconInk } from "../../../icons/iconInk";
import { DEFAULT_ICON_COLOR, getRoleIcon } from "../../../core/types/graph";
import { getCustomIconUrl } from "../../../utils/iconUtils";
import type { NodeBoxAppearance } from "../../../core/types/topology";
import {
  DEFAULT_NODE_STYLE,
  NODE_BOX_LABEL_FONT_SIZE_PX,
  NODE_BOX_LABEL_FONT_WEIGHT,
  NODE_BOX_LABEL_LINE_HEIGHT_PX,
  fitNodeBoxLabel,
  getNodeBoxMetrics,
  resolveNodeBoxPaint,
  type NodeBoxMetrics,
  type NodeBoxSpacing,
  type NodeStyle
} from "../../canvas/nodeBox";

import {
  EXPORT_NODE_ICON_CLASS,
  NODE_ICON_SIZE,
  NODE_LABEL,
  getNetworkTypeColor,
  escapeXml,
  resolveCssColor
} from "./constants";
import {
  measureTextWidth,
  sampleFontMetrics,
  truncateTextToWidth,
  type SampledFontMetrics
} from "./textMetrics";

// ============================================================================
// Types
// ============================================================================

/** Custom icons map type (icon name -> data URI) */
export type CustomIconMap = Map<string, string>;

export interface NodeSvgRenderOptions {
  nodeIconSize?: number;
  /** Boxed nodes draw a card around the icon with the name inside. */
  nodeStyle?: NodeStyle;
  nodeBoxSpacing?: NodeBoxSpacing;
  /** Frame color of built-in icons; defaults to the ink for the current theme. */
  iconInk?: string;
}

/** Resolved boxed-style geometry, font and theme colors, shared by all nodes. */
interface NodeBoxStyle {
  spacing: NodeBoxSpacing | undefined;
  metrics: NodeBoxMetrics;
  font: SampledFontMetrics;
  background: string;
  border: string;
  foreground: string;
}

/** How node names are drawn: a pill around the icon, or inside a box when `box` is set. */
interface NodeLabelStyle {
  font: SampledFontMetrics;
  box?: NodeBoxStyle;
}

interface TopologyNodeData {
  label?: string;
  role?: string;
  iconColor?: string;
  iconCornerRadius?: number;
  labelPosition?: string;
  direction?: string;
  labelBackgroundColor?: string;
  box?: NodeBoxAppearance;
  [key: string]: unknown;
}

interface NetworkNodeData {
  label?: string;
  nodeType?: string;
  labelPosition?: string;
  direction?: string;
  labelBackgroundColor?: string;
  box?: NodeBoxAppearance;
  [key: string]: unknown;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveNodeIconSize(nodeIconSize: number | undefined): number {
  if (typeof nodeIconSize !== "number" || !Number.isFinite(nodeIconSize)) return NODE_ICON_SIZE;
  return clamp(nodeIconSize, 12, 240);
}

/**
 * Icon top-left in flow coordinates. Matches the canvas: the icon is
 * horizontally centered within the measured node width.
 */
function getIconTopLeft(node: Node, iconSize: number): { x: number; y: number } {
  let measuredWidth = iconSize;
  if (typeof node.measured?.width === "number") {
    measuredWidth = node.measured.width;
  } else if (typeof node.width === "number") {
    measuredWidth = node.width;
  }
  return {
    x: node.position.x + (measuredWidth - iconSize) / 2,
    y: node.position.y
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Decode a data URI SVG and extract the inner content
 * Returns the SVG content ready for embedding
 */
function decodeSvgDataUri(dataUri: string): string {
  if (!dataUri.startsWith("data:image/svg+xml")) {
    return "";
  }
  const encoded = dataUri.replace(/^data:image\/svg\+xml[^,]*,/, "");
  return decodeURIComponent(encoded);
}

/**
 * Embed a built-in icon as a nested <svg> at the icon bounds, keeping its viewBox
 */
function embedBuiltInIcon(svgString: string, x: number, y: number, size: number): string {
  const viewBox = /viewBox="([^"]+)"/.exec(svgString)?.[1];
  const inner = /<svg[^>]*>([\s\S]*)<\/svg>/i.exec(svgString)?.[1];
  if (viewBox === undefined || inner === undefined) return "";
  return `<svg class="${EXPORT_NODE_ICON_CLASS}" x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${viewBox}">${inner}</svg>`;
}

function normalizeNodeLabelPosition(value: unknown): "top" | "right" | "bottom" | "left" {
  switch (value) {
    case "top":
    case "right":
    case "left":
      return value;
    default:
      return "bottom";
  }
}

function getNodeDirectionRotation(value: unknown): number {
  switch (value) {
    case "up":
      return 270;
    case "right":
      return 0;
    case "down":
      return 90;
    case "left":
      return 180;
    default:
      return 0;
  }
}

// ============================================================================
// Node Label Builder
// ============================================================================

const NODE_LABEL_FALLBACK_FONT_FAMILY = "system-ui, -apple-system, sans-serif";

/**
 * Font the canvas renders node labels with. Sampled from a live label so the
 * exported pill sizes exactly like the canvas; falls back to constants when
 * labels are hidden or no DOM exists.
 */
function resolveNodeLabelFont(): SampledFontMetrics {
  return (
    sampleFontMetrics(".topology-node-label") ?? {
      fontFamily: NODE_LABEL_FALLBACK_FONT_FAMILY,
      fontSizePx: NODE_LABEL.fontSize,
      fontWeight: String(NODE_LABEL.fontWeight),
      lineHeightPx: NODE_LABEL.fontSize * NODE_LABEL.lineHeight
    }
  );
}

/**
 * Build SVG for node label with background and text shadow
 * Positioned around the icon.
 */
function buildNodeLabelSvg(
  label: string,
  iconX: number,
  iconY: number,
  iconSize: number,
  labelFont: SampledFontMetrics,
  position?: string,
  direction?: string,
  labelBackgroundColor?: string
): string {
  if (!label) return "";

  // Measure real text width and emulate the canvas CSS ellipsis at maxWidth
  const { text: displayLabel, width: textWidth } = truncateTextToWidth(
    label,
    labelFont,
    NODE_LABEL.maxWidth
  );
  const bgWidth = textWidth + NODE_LABEL.paddingX * 2;
  const bgHeight = labelFont.lineHeightPx + NODE_LABEL.paddingY * 2;
  const iconCenterX = iconX + iconSize / 2;
  const iconCenterY = iconY + iconSize / 2;
  const gap = NODE_LABEL.marginTop;
  const textRotation = getNodeDirectionRotation(direction);
  const isVerticalText = textRotation === 90 || textRotation === 270;
  const verticalGap = gap + (isVerticalText ? 2 : 0);
  const sideOverlap = isVerticalText ? 2 : 6;

  const resolvedPosition = normalizeNodeLabelPosition(position);

  let bgX = iconCenterX - bgWidth / 2;
  let bgY = iconY + iconSize + verticalGap;

  switch (resolvedPosition) {
    case "top":
      bgY = iconY - bgHeight - verticalGap;
      break;
    case "right":
      bgX = iconX + iconSize - sideOverlap;
      bgY = iconCenterY - bgHeight / 2;
      break;
    case "left":
      bgX = iconX - bgWidth + sideOverlap;
      bgY = iconCenterY - bgHeight / 2;
      break;
  }

  const textX = bgX + bgWidth / 2;
  const textCenterY = bgY + bgHeight / 2;

  let svg = "";
  if (textRotation !== 0) {
    svg += `<g transform="rotate(${textRotation} ${textX} ${textCenterY})">`;
  }

  const bgColor =
    typeof labelBackgroundColor === "string" && labelBackgroundColor.trim().length > 0
      ? labelBackgroundColor.trim()
      : NODE_LABEL.backgroundColor;
  // Background rect
  svg += `<rect x="${bgX}" y="${bgY}" width="${bgWidth}" height="${bgHeight}" `;
  svg += `fill="${bgColor}" rx="${NODE_LABEL.borderRadius}" ry="${NODE_LABEL.borderRadius}"/>`;

  // Label text with shadow filter
  svg += `<text x="${textX}" y="${textCenterY}" `;
  svg += `font-size="${labelFont.fontSizePx}" font-weight="${labelFont.fontWeight}" `;
  svg += `font-family='${escapeXml(labelFont.fontFamily)}' `;
  svg += `dominant-baseline="central" `;
  svg += `fill="${NODE_LABEL.color}" text-anchor="middle" `;
  svg += `filter="url(#text-shadow)">`;
  svg += escapeXml(displayLabel);
  svg += `</text>`;
  if (textRotation !== 0) {
    svg += `</g>`;
  }

  return svg;
}

// ============================================================================
// Node Box Builder
// ============================================================================

const NODE_BOX_FALLBACK_COLORS = {
  background: "#252526",
  border: "#3c3c3c",
  foreground: "#cccccc"
} as const;

function resolveNodeBoxStyle(
  iconSize: number,
  spacing: NodeBoxSpacing | undefined,
  labelFont: SampledFontMetrics
): NodeBoxStyle {
  const sampled = sampleFontMetrics(".topology-node-box-label");
  const resolveVar = (name: string, fallback: string) =>
    resolveCssColor(`var(${name}, ${fallback})`, fallback);
  return {
    spacing,
    metrics: getNodeBoxMetrics(iconSize, spacing),
    font: {
      fontFamily: sampled?.fontFamily ?? labelFont.fontFamily,
      fontSizePx: NODE_BOX_LABEL_FONT_SIZE_PX,
      fontWeight: String(NODE_BOX_LABEL_FONT_WEIGHT),
      lineHeightPx: NODE_BOX_LABEL_LINE_HEIGHT_PX
    },
    background: resolveVar("--topoviewer-node-box-background", NODE_BOX_FALLBACK_COLORS.background),
    border: resolveVar("--topoviewer-node-box-border", NODE_BOX_FALLBACK_COLORS.border),
    foreground: resolveVar("--topoviewer-node-box-foreground", NODE_BOX_FALLBACK_COLORS.foreground)
  };
}

/**
 * Card behind the icon. The stroke is inset by half its width so it covers
 * the same pixels as the canvas CSS border box. Frosted glass and the drop
 * shadow have no static SVG equivalent and are left out.
 */
function buildNodeBoxSvg(
  iconX: number,
  iconY: number,
  box: NodeBoxStyle,
  appearance: NodeBoxAppearance | undefined
): string {
  const { metrics } = box;
  const paint = resolveNodeBoxPaint(appearance, metrics);
  const fill = paint.fill !== undefined ? resolveCssColor(paint.fill, box.background) : box.background;
  const inset = paint.borderWidth / 2;
  const radius = Math.max(0, paint.cornerRadius - inset);
  let svg = `<rect class="export-node-box" `;
  svg += `x="${iconX + metrics.offsetX + inset}" y="${iconY + metrics.offsetY + inset}" `;
  svg += `width="${metrics.width - paint.borderWidth}" `;
  svg += `height="${metrics.height - paint.borderWidth}" `;
  svg += `rx="${radius}" ry="${radius}" fill="${escapeXml(fill)}" `;
  if (paint.fillOpacity < 1) svg += `fill-opacity="${paint.fillOpacity}" `;
  if (paint.borderWidth > 0) {
    const stroke =
      paint.borderColor !== undefined ? resolveCssColor(paint.borderColor, box.border) : box.border;
    svg += `stroke="${escapeXml(stroke)}" stroke-width="${paint.borderWidth}"`;
  }
  svg += `/>`;
  return svg;
}

/** Name on one row at the bottom of the box, middle-truncated like the canvas. */
function buildNodeBoxLabelSvg(
  label: string,
  iconX: number,
  iconY: number,
  iconSize: number,
  box: NodeBoxStyle,
  appearance: NodeBoxAppearance | undefined
): string {
  if (!label) return "";
  const { metrics, font } = box;
  const { text } = fitNodeBoxLabel(
    label,
    iconSize,
    (value) => measureTextWidth(value, font),
    box.spacing
  );
  const textColor = appearance?.textColor;
  const foreground =
    textColor !== undefined ? resolveCssColor(textColor, box.foreground) : box.foreground;
  const rowTop =
    iconY + metrics.offsetY + metrics.height - metrics.labelInset - NODE_BOX_LABEL_LINE_HEIGHT_PX;
  const textX = iconX + iconSize / 2;
  const textCenterY = rowTop + NODE_BOX_LABEL_LINE_HEIGHT_PX / 2;

  let svg = `<text class="export-node-box-label" x="${textX}" y="${textCenterY}" `;
  svg += `font-size="${font.fontSizePx}" font-weight="${font.fontWeight}" `;
  svg += `font-family='${escapeXml(font.fontFamily)}' `;
  svg += `dominant-baseline="central" `;
  svg += `fill="${escapeXml(foreground)}" text-anchor="middle">`;
  svg += escapeXml(text);
  svg += `</text>`;
  return svg;
}

/** Name for either style. The boxed style ignores label position, background and direction. */
function buildNodeNameSvg(
  label: string,
  iconX: number,
  iconY: number,
  iconSize: number,
  labelStyle: NodeLabelStyle,
  data: {
    labelPosition?: string;
    direction?: string;
    labelBackgroundColor?: string;
    box?: NodeBoxAppearance;
  }
): string {
  if (labelStyle.box) {
    return buildNodeBoxLabelSvg(label, iconX, iconY, iconSize, labelStyle.box, data.box);
  }
  return buildNodeLabelSvg(
    label,
    iconX,
    iconY,
    iconSize,
    labelStyle.font,
    data.labelPosition,
    data.direction,
    data.labelBackgroundColor
  );
}

// ============================================================================
// Topology Node Builder
// ============================================================================

/**
 * Render a topology node (router, switch, etc.) to SVG
 */
function topologyNodeToSvg(
  node: Node,
  labelStyle: NodeLabelStyle,
  iconInk: string,
  customIconMap?: CustomIconMap,
  nodeIconSize: number = NODE_ICON_SIZE
): string {
  const data = node.data as TopologyNodeData;
  const iconSize = resolveNodeIconSize(nodeIconSize);
  const { x, y } = getIconTopLeft(node, iconSize);
  const label = data.label ?? node.id;
  const role = data.role ?? "pe";
  const iconColor = data.iconColor ?? DEFAULT_ICON_COLOR;
  // Boxed nodes keep the icon upright, like the canvas.
  const directionRotation = labelStyle.box ? 0 : getNodeDirectionRotation(data.direction);

  // Check for custom icon first
  let iconSvg = "";
  const customDataUri = customIconMap?.get(role);
  if (customDataUri !== undefined && customDataUri.length > 0) {
    // Preserve custom styles, transparency and viewBox, including base64 SVGs and PNGs.
    const iconUrl = getCustomIconUrl(customDataUri, data.iconColor);
    iconSvg = `<image class="${EXPORT_NODE_ICON_CLASS}" x="${x}" y="${y}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid slice" href="${escapeXml(iconUrl)}"/>`;
  } else {
    const dataUri = generateEncodedSVG(getRoleIcon(role), iconColor, iconInk);
    iconSvg = embedBuiltInIcon(decodeSvgDataUri(dataUri), x, y, iconSize);
  }

  let svg = `<g class="export-node topology-node" data-id="${escapeXml(node.id)}">`;
  if (labelStyle.box) svg += buildNodeBoxSvg(x, y, labelStyle.box, data.box);
  const centerX = x + iconSize / 2;
  const centerY = y + iconSize / 2;
  svg += `<g transform="rotate(${directionRotation} ${centerX} ${centerY})">`;
  svg += iconSvg;
  svg += `</g>`;

  // Label
  svg += buildNodeNameSvg(label, x, y, iconSize, labelStyle, data);

  svg += `</g>`;
  return svg;
}

// ============================================================================
// Network Node Builder
// ============================================================================

/**
 * Render a network node (host, mgmt-net, etc.) to SVG
 * Network nodes use the cloud icon with type-based colors
 */
function networkNodeToSvg(
  node: Node,
  labelStyle: NodeLabelStyle,
  iconInk: string,
  nodeIconSize: number = NODE_ICON_SIZE
): string {
  const data = node.data as NetworkNodeData;
  const iconSize = resolveNodeIconSize(nodeIconSize);
  const { x, y } = getIconTopLeft(node, iconSize);
  const label = data.label ?? node.id;
  const nodeType = data.nodeType ?? "host";
  const iconColor = getNetworkTypeColor(nodeType);
  // Boxed nodes keep the icon upright, like the canvas.
  const directionRotation = labelStyle.box ? 0 : getNodeDirectionRotation(data.direction);

  // Generate cloud icon
  const dataUri = generateEncodedSVG("cloud", iconColor, iconInk);
  const iconSvg = embedBuiltInIcon(decodeSvgDataUri(dataUri), x, y, iconSize);

  let svg = `<g class="export-node network-node" data-id="${escapeXml(node.id)}">`;
  if (labelStyle.box) svg += buildNodeBoxSvg(x, y, labelStyle.box, data.box);
  const centerX = x + iconSize / 2;
  const centerY = y + iconSize / 2;
  svg += `<g transform="rotate(${directionRotation} ${centerX} ${centerY})">`;
  svg += iconSvg;
  svg += `</g>`;

  // Label (network nodes use slightly smaller font)
  svg += buildNodeNameSvg(label, x, y, iconSize, labelStyle, data);

  svg += `</g>`;
  return svg;
}

// ============================================================================
// Batch Renderer
// ============================================================================

/**
 * Render all nodes to SVG
 * Filters out annotation nodes and returns combined SVG string
 */
export function renderNodesToSvg(
  nodes: Node[],
  customIconMap?: CustomIconMap,
  annotationNodeTypes?: Set<string>,
  renderOptions?: NodeSvgRenderOptions
): string {
  const nodeIconSize = resolveNodeIconSize(renderOptions?.nodeIconSize);
  const labelFont = resolveNodeLabelFont();
  const nodeStyle = renderOptions?.nodeStyle ?? DEFAULT_NODE_STYLE;
  const labelStyle: NodeLabelStyle = {
    font: labelFont,
    box:
      nodeStyle === "boxed"
        ? resolveNodeBoxStyle(nodeIconSize, renderOptions?.nodeBoxSpacing, labelFont)
        : undefined
  };
  const iconInk = renderOptions?.iconInk ?? getIconInk();
  const skipTypes =
    annotationNodeTypes ??
    new Set(["free-text-annotation", "free-shape-annotation", "group-annotation"]);

  let svg = "";

  for (const node of nodes) {
    const nodeType = node.type ?? "";

    // Skip annotation nodes
    if (skipTypes.has(nodeType)) continue;

    // Render based on node type
    if (nodeType === "network-node") {
      svg += networkNodeToSvg(node, labelStyle, iconInk, nodeIconSize);
    } else {
      svg += topologyNodeToSvg(node, labelStyle, iconInk, customIconMap, nodeIconSize);
    }
  }

  return svg;
}
