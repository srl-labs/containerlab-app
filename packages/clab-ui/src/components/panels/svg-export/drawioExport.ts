// Canvas-to-Draw.io conversion for export. The file holds real shapes and
// connectors, so the diagram stays editable, unlike an SVG placed in Draw.io.
import type { Edge, Node } from "@xyflow/react";

import { DEFAULT_ARROW_SIZE, DEFAULT_LINE_LENGTH } from "../../../annotations/constants";
import type {
  FreeShapeAnnotation,
  FreeTextAnnotation,
  GroupStyleAnnotation,
  NodeBoxAppearance
} from "../../../core/types/topology";
import { getIconInk } from "../../../icons/iconInk";
import { renderMarkdown } from "../../../utils/markdownRenderer";
import {
  DEFAULT_NODE_STYLE,
  NODE_BOX_LABEL_FONT_SIZE_PX,
  fitNodeBoxLabel,
  getNodeBoxMetrics,
  getNodeConnectionRect,
  resolveNodeBoxPaint
} from "../../canvas/nodeBox";

import {
  getShapeStyle,
  getTextDimensions,
  getTextStyle,
  resolveGroupPaint,
  type AnnotationData
} from "./annotationsToSvg";
import { EDGE_STYLE, NODE_LABEL, escapeXml, resolveCssColor } from "./constants";
import { layoutEdges, type EdgeLayout, type EndpointLabelLayout } from "./edgesToSvg";
import type { GraphSvgRenderOptions } from "./graphSvg";
import {
  getIconTopLeft,
  getNodeDirectionRotation,
  normalizeNodeLabelPosition,
  resolveNodeBoxThemeColors,
  resolveNodeIconDataUri,
  resolveNodeIconSize,
  type CustomIconMap
} from "./nodesToSvg";
import { measureTextWidth } from "./textMetrics";

export interface DrawioExportOptions {
  /** Name of the diagram page. */
  name: string;
  nodes: Node[];
  edges: Edge[];
  /** Left out, the export has no groups, shapes or text. */
  annotations?: AnnotationData;
  annotationNodeTypes?: Set<string>;
  customIcons?: CustomIconMap;
  includeEdgeLabels: boolean;
  renderOptions?: GraphSvgRenderOptions;
  /** Page color. Icons and labels are drawn for this color. */
  background?: string;
}

interface Point {
  x: number;
  y: number;
}

interface Rect extends Point {
  width: number;
  height: number;
}

/** A cell children are placed in; their coordinates are relative to its corner. */
interface Frame extends Point {
  id: string;
  parent: Frame | null;
  /** Below links: shapes and child groups. Groups go on top on equal z. */
  below: { zIndex: number; isGroup: boolean; cell: (frame: Frame) => string }[];
  nodes: string[];
  /** Above nodes, so a node's name does not hide an interface label, as on the canvas. */
  links: string[];
  texts: string[];
}

type StyleValue = string | number | undefined;

const ROOT_CELL_ID = "1";
const PAGE_MARGIN = 40;
/** Draw.io draws an image this far inside a label shape, on top of the `spacing` style. */
const LABEL_IMAGE_INSET = 5;
/** Draw.io draws a top-aligned HTML label this far below its anchor, at every font size. */
const TOP_LABEL_OFFSET = 5;
/** Group label below the box, from its top edge. Matches GroupNode.tsx. */
const GROUP_LABEL_GAP_BELOW = 3;
/** Draw.io's default font, in the size and weight of a boxed node's name. */
const NODE_BOX_LABEL_FONT = {
  fontFamily: "Helvetica, Arial, sans-serif",
  fontSizePx: NODE_BOX_LABEL_FONT_SIZE_PX,
  fontWeight: "700"
};

// ============================================================================
// Style helpers
// ============================================================================

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** A style string. `;` separates entries, so values cannot contain one. */
function cellStyle(values: Record<string, StyleValue>, base?: string): string {
  const entries = Object.entries(values)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${String(value).replaceAll(";", "")}`);
  return [...(base === undefined ? [] : [base]), ...entries].join(";") + ";";
}

/** A label shown as HTML: the name must survive both the XML and the HTML parser. */
function htmlLabel(text: string): string {
  return escapeXml(escapeXml(text));
}

function parseHexColor(value: string): { color: string; opacity: number } | null {
  const digits = /^#([0-9a-f]{3,8})$/i.exec(value)?.[1];
  if (digits === undefined) return null;
  if (digits.length === 3) {
    const [r, g, b] = digits;
    return { color: `#${r}${r}${g}${g}${b}${b}`, opacity: 100 };
  }
  if (digits.length === 6) return { color: `#${digits}`, opacity: 100 };
  if (digits.length === 8) {
    return {
      color: `#${digits.slice(0, 6)}`,
      opacity: Math.round((parseInt(digits.slice(6), 16) / 255) * 100)
    };
  }
  return null;
}

function parseRgbColor(value: string): { color: string; opacity: number } | null {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(
    value
  );
  if (!match) return null;
  const hex = [match[1], match[2], match[3]]
    .map((channel) => Math.round(Number(channel)).toString(16).padStart(2, "0"))
    .join("");
  const parsedAlpha = Number.parseFloat(match[4]);
  const alpha = Number.isFinite(parsedAlpha) ? parsedAlpha : 1;
  return { color: `#${hex}`, opacity: Math.round(alpha * 100) };
}

/**
 * Draw.io keeps a color and its opacity in separate entries and only takes
 * plain colors, so CSS values are split up. Null when nothing is painted.
 */
function parseColor(value: string | undefined): { color: string; opacity: number } | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "transparent" || lower === "none") return null;
  if (lower.startsWith("var(")) return parseColor(resolveCssColor(trimmed, "#808080"));
  const parsed = parseHexColor(lower) ?? parseRgbColor(lower);
  if (parsed) return parsed.opacity > 0 ? parsed : null;
  return /^[a-z]+$/.test(lower) ? { color: lower, opacity: 100 } : null;
}

function colorOrNone(value: string | undefined): string {
  return parseColor(value)?.color ?? "none";
}

/** A translucent label background flattened onto the page: label backgrounds have no opacity. */
function flattenColor(value: string, background: string | undefined): string | undefined {
  const color = parseColor(value);
  if (!color) return undefined;
  const page = parseColor(background)?.color;
  if (color.opacity >= 100 || page === undefined || !page.startsWith("#")) return color.color;
  const alpha = color.opacity / 100;
  const channels = [1, 3, 5].map((start) => {
    const front = parseInt(color.color.slice(start, start + 2), 16);
    const back = parseInt(page.slice(start, start + 2), 16);
    return Math.round(front * alpha + back * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function dashStyle(dashArray: string): Record<string, StyleValue> {
  if (dashArray.length === 0) return {};
  // fixDash keeps the pattern in pixels, as on the canvas, whatever the stroke width.
  return { dashed: 1, dashPattern: dashArray.replaceAll(",", " "), fixDash: 1 };
}

function cornerStyle(radius: number): Record<string, StyleValue> {
  if (radius <= 0) return { rounded: 0 };
  return { rounded: 1, absoluteArcSize: 1, arcSize: round(radius * 2) };
}

function fontFamilyStyle(fontFamily: string | undefined): string | undefined {
  if (fontFamily === undefined || fontFamily === "inherit") return undefined;
  return fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

/** Decodes what a browser would: a literal %, as in width="100%", stays as it is. */
function decodePercent(text: string): string {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (escapes) => {
    try {
      return decodeURIComponent(escapes);
    } catch {
      return escapes;
    }
  });
}

/** Draw.io's form of an image data URI, which fits in a style: `data:<type>,<base64>`. */
function toDrawioImage(dataUri: string): string {
  const match = /^data:([^;,]+)((?:;[^,;]*)*),([\s\S]*)$/.exec(dataUri);
  if (!match) return dataUri;
  const [, type, parameters, payload] = match;
  if (parameters.includes(";base64")) return `data:${type},${payload}`;
  return `data:${type},${encodeBase64(decodePercent(payload))}`;
}

/** Turns the image only: a label on a rotated cell would swing around the icon. */
function rotateIcon(dataUri: string, degrees: number, size: number): string {
  if (degrees === 0) return dataUri;
  const center = size / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<g transform="rotate(${degrees} ${center} ${center})">` +
    `<image href="${escapeXml(dataUri)}" width="${size}" height="${size}"/></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ============================================================================
// Cells
// ============================================================================

function vertexGeometry(rect: Rect, frame: Frame): string {
  const x = round(rect.x - frame.x);
  const y = round(rect.y - frame.y);
  return `<mxGeometry x="${x}" y="${y}" width="${round(rect.width)}" height="${round(rect.height)}" as="geometry"/>`;
}

function mxPoint(point: Point, frame: Frame, role?: string): string {
  const as = role === undefined ? "" : ` as="${role}"`;
  return `<mxPoint x="${round(point.x - frame.x)}" y="${round(point.y - frame.y)}"${as}/>`;
}

const NODE_LABEL_PLACEMENT = {
  bottom: {
    labelPosition: "center",
    verticalLabelPosition: "bottom",
    align: "center",
    verticalAlign: "top",
    spacingTop: NODE_LABEL.paddingY - TOP_LABEL_OFFSET
  },
  top: { labelPosition: "center", verticalLabelPosition: "top", align: "center", verticalAlign: "bottom" },
  left: { labelPosition: "left", verticalLabelPosition: "middle", align: "right", verticalAlign: "middle" },
  right: { labelPosition: "right", verticalLabelPosition: "middle", align: "left", verticalAlign: "middle" }
} as const;

interface NodeContext {
  iconSize: number;
  boxed: boolean;
  spacing: GraphSvgRenderOptions["nodeBoxSpacing"];
  iconInk: string;
  customIcons?: CustomIconMap;
  background?: string;
}

function nodeRect(node: Node, ctx: NodeContext): Rect {
  const { x, y } = getIconTopLeft(node, ctx.iconSize);
  return getNodeConnectionRect(
    { x, y, width: ctx.iconSize, height: ctx.iconSize },
    ctx.boxed ? "boxed" : "icon",
    ctx.iconSize,
    ctx.spacing
  );
}

/** A square box with the icon and the name inside, as one cell. */
function boxedNodeStyle(node: Node, image: string, ctx: NodeContext): string {
  const metrics = getNodeBoxMetrics(ctx.iconSize, ctx.spacing);
  const paint = resolveNodeBoxPaint(node.data.box as NodeBoxAppearance | undefined, metrics);
  const theme = resolveNodeBoxThemeColors();
  const fill = parseColor(paint.fill ?? theme.background);
  const spacing = Math.max(0, -metrics.offsetY - LABEL_IMAGE_INSET);
  return cellStyle(
    {
      html: 1,
      whiteSpace: "nowrap",
      ...cornerStyle(paint.cornerRadius),
      fillColor: fill?.color ?? "none",
      fillOpacity: fill === null ? undefined : Math.round(fill.opacity * paint.fillOpacity),
      strokeColor: paint.borderWidth > 0 ? colorOrNone(paint.borderColor ?? theme.border) : "none",
      strokeWidth: paint.borderWidth > 0 ? paint.borderWidth : undefined,
      fontColor: colorOrNone(paint.textColor ?? theme.foreground),
      fontSize: NODE_BOX_LABEL_FONT_SIZE_PX,
      fontStyle: 1,
      align: "center",
      verticalAlign: "bottom",
      spacing: round(spacing),
      spacingBottom: round(metrics.labelInset - spacing),
      image,
      imageWidth: ctx.iconSize,
      imageHeight: ctx.iconSize,
      imageAlign: "center",
      imageVerticalAlign: "top"
    },
    "shape=label"
  );
}

function iconNodeStyle(node: Node, image: string, ctx: NodeContext): string {
  const placement = NODE_LABEL_PLACEMENT[normalizeNodeLabelPosition(node.data.labelPosition)];
  const labelBackground =
    typeof node.data.labelBackgroundColor === "string" && node.data.labelBackgroundColor.length > 0
      ? node.data.labelBackgroundColor
      : NODE_LABEL.backgroundColor;
  return cellStyle({
    shape: "image",
    html: 1,
    whiteSpace: "nowrap",
    aspect: "fixed",
    imageAspect: 1,
    image,
    ...placement,
    fontSize: NODE_LABEL.fontSize,
    fontColor: NODE_LABEL.color,
    labelBackgroundColor: flattenColor(labelBackground, ctx.background),
    spacing: NODE_LABEL.marginTop
  });
}

/** Facts about the node, shown under Edit Data in Draw.io. */
function nodeProperties(node: Node, fullName: string, shownName: string): string {
  const extra = node.data.extraData as Record<string, unknown> | undefined;
  const properties: Record<string, unknown> = {
    name: shownName === fullName ? undefined : fullName,
    kind: node.data.kind ?? extra?.kind,
    type: node.data.nodeType ?? extra?.type,
    image: node.data.image ?? extra?.image
  };
  return Object.entries(properties)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([key, value]) => ` ${key}="${escapeXml(value as string)}"`)
    .join("");
}

function nodeCell(node: Node, frame: Frame, ctx: NodeContext): string {
  const icon = resolveNodeIconDataUri(node, ctx.iconInk, ctx.customIcons);
  const rotation = ctx.boxed ? 0 : getNodeDirectionRotation(node.data.direction);
  const image = toDrawioImage(rotateIcon(icon, rotation, ctx.iconSize));
  const style = ctx.boxed ? boxedNodeStyle(node, image, ctx) : iconNodeStyle(node, image, ctx);
  const fullName = typeof node.data.label === "string" ? node.data.label : node.id;
  // A box has room for one row, so a long name shortens like the canvas. Icons have no such limit.
  const name = ctx.boxed
    ? fitNodeBoxLabel(
        fullName,
        ctx.iconSize,
        (value) => measureTextWidth(value, NODE_BOX_LABEL_FONT),
        ctx.spacing
      ).text
    : fullName;
  return (
    `<object id="${escapeXml(nodeCellId(node.id))}" label="${htmlLabel(name)}"${nodeProperties(node, fullName, name)}>` +
    `<mxCell style="${escapeXml(style)}" vertex="1" parent="${escapeXml(frame.id)}">` +
    vertexGeometry(nodeRect(node, ctx), frame) +
    `</mxCell></object>`
  );
}

function nodeCellId(nodeId: string): string {
  return `node-${nodeId}`;
}

/** The closest point on a path, and how far along the path it lies, from 0 to 1. */
function projectOntoPath(path: Point[], point: Point): { point: Point; fraction: number } {
  let walked = 0;
  let total = 0;
  let best = { point: path[0], walked: 0, distance: Number.POSITIVE_INFINITY };
  for (let i = 0; i + 1 < path.length; i++) {
    const [from, to] = [path[i], path[i + 1]];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const t =
      length === 0
        ? 0
        : Math.min(1, Math.max(0, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length ** 2));
    const closest = { x: from.x + dx * t, y: from.y + dy * t };
    const distance = Math.hypot(point.x - closest.x, point.y - closest.y);
    if (distance < best.distance) best = { point: closest, walked: walked + length * t, distance };
    walked += length;
    total += length;
  }
  return { point: best.point, fraction: total === 0 ? 0 : best.walked / total };
}

/** A label is a child of its link, so it follows when the link changes. */
function endpointLabelCell(link: EdgeLayout, label: EndpointLabelLayout, id: string): string {
  const { point, fraction } = projectOntoPath([link.start, ...link.bends, link.end], label);
  const background = parseColor(label.background);
  const outline = parseColor(label.outline);
  const style = cellStyle(
    {
      html: 1,
      whiteSpace: "nowrap",
      ...(label.shape === "pill" ? cornerStyle(4) : {}),
      fillColor: background?.color ?? "none",
      strokeColor: outline?.color ?? "none",
      strokeOpacity: outline?.opacity,
      strokeWidth: label.outlineWidth,
      fontColor: colorOrNone(label.color),
      fontSize: round(label.fontSize),
      fontStyle: label.bold ? 1 : 0,
      align: "center",
      verticalAlign: "middle",
      spacing: 0,
      resizable: 0,
      connectable: 0
    },
    label.shape === "bubble" ? "ellipse" : undefined
  );
  const offset = {
    x: round(label.x - point.x - label.width / 2),
    y: round(label.y - point.y - label.height / 2)
  };
  return (
    `<mxCell id="${escapeXml(id)}" value="${htmlLabel(label.text)}" style="${escapeXml(style)}" vertex="1" parent="${escapeXml(linkCellId(link.id))}">` +
    `<mxGeometry x="${round(fraction * 2 - 1, 4)}" width="${round(label.width)}" height="${round(label.height)}" relative="1" as="geometry">` +
    `<mxPoint x="${offset.x}" y="${offset.y}" as="offset"/>` +
    `</mxGeometry></mxCell>`
  );
}

function linkCellId(linkId: string): string {
  return `link-${linkId}`;
}

/** A fixed connection point: anywhere relative to the node, also just outside its outline. */
function pinnedEnd(role: "exit" | "entry", point: Point, rect: Rect): Record<string, StyleValue> {
  return {
    [`${role}X`]: round((point.x - rect.x) / rect.width, 4),
    [`${role}Y`]: round((point.y - rect.y) / rect.height, 4),
    [`${role}Dx`]: 0,
    [`${role}Dy`]: 0,
    [`${role}Perimeter`]: 0
  };
}

function linkCell(link: EdgeLayout, frame: Frame, rectOf: (id: string) => Rect | undefined): string {
  const sourceRect = rectOf(link.source);
  const targetRect = rectOf(link.target);
  const style = cellStyle({
    html: 1,
    rounded: 0,
    // A curved link with one point draws the same curve as the canvas: that point is its control point.
    curved: link.bends.length > 0 ? 1 : undefined,
    startArrow: "none",
    endArrow: "none",
    strokeColor: link.strokeColor,
    strokeWidth: EDGE_STYLE.strokeWidth,
    opacity: Math.round(EDGE_STYLE.opacity * 100),
    ...(link.startPinned && sourceRect ? pinnedEnd("exit", link.start, sourceRect) : {}),
    ...(link.endPinned && targetRect ? pinnedEnd("entry", link.end, targetRect) : {})
  });
  const bends =
    link.bends.length > 0
      ? `<Array as="points">${link.bends.map((bend) => mxPoint(bend, frame)).join("")}</Array>`
      : "";
  const id = linkCellId(link.id);
  return (
    `<mxCell id="${escapeXml(id)}" style="${escapeXml(style)}" edge="1" parent="${escapeXml(frame.id)}" ` +
    `source="${escapeXml(nodeCellId(link.source))}" target="${escapeXml(nodeCellId(link.target))}">` +
    `<mxGeometry relative="1" as="geometry">${bends}</mxGeometry></mxCell>` +
    link.labels.map((label, index) => endpointLabelCell(link, label, `${id}-label-${index}`)).join("")
  );
}

const GROUP_LABEL_BELOW = {
  verticalLabelPosition: "bottom",
  verticalAlign: "top",
  spacingTop: GROUP_LABEL_GAP_BELOW - TOP_LABEL_OFFSET
};

const GROUP_LABEL_PLACEMENT: Record<string, Record<string, StyleValue>> = {
  "top-left": { verticalLabelPosition: "top", verticalAlign: "bottom", align: "left", spacingLeft: 14 },
  "top-center": { verticalLabelPosition: "top", verticalAlign: "bottom", align: "center" },
  "top-right": { verticalLabelPosition: "top", verticalAlign: "bottom", align: "right", spacingRight: 14 },
  "bottom-left": { ...GROUP_LABEL_BELOW, align: "left", spacingLeft: 14 },
  "bottom-center": { ...GROUP_LABEL_BELOW, align: "center" },
  "bottom-right": { ...GROUP_LABEL_BELOW, align: "right", spacingRight: 14 }
};

/** A container: its members move with it, and resizing it leaves them as they are. */
function groupCell(group: GroupStyleAnnotation, id: string, frame: Frame): string {
  const paint = resolveGroupPaint(group);
  const fill = parseColor(paint.fillColor);
  const placement = GROUP_LABEL_PLACEMENT[group.labelPosition ?? "top-left"] ?? GROUP_LABEL_PLACEMENT["top-left"];
  const style = cellStyle({
    html: 1,
    whiteSpace: "nowrap",
    container: 1,
    collapsible: 0,
    recursiveResize: 0,
    connectable: 0,
    ...cornerStyle(paint.borderRadius),
    fillColor: fill?.color ?? "none",
    fillOpacity: fill?.opacity,
    strokeColor: colorOrNone(paint.borderColor),
    strokeWidth: paint.borderWidth,
    ...dashStyle(paint.dashArray),
    fontSize: 12,
    fontColor: colorOrNone(paint.labelColor),
    labelPosition: "center",
    ...placement
  });
  return (
    `<mxCell id="${escapeXml(id)}" value="${htmlLabel(group.name || "")}" style="${escapeXml(style)}" vertex="1" parent="${escapeXml(frame.id)}">` +
    vertexGeometry({ ...group.position, width: group.width, height: group.height }, frame) +
    `</mxCell>`
  );
}

function shapeRect(shape: FreeShapeAnnotation): Rect {
  return { ...shape.position, width: shape.width ?? 50, height: shape.height ?? 50 };
}

function lineEnd(shape: FreeShapeAnnotation): Point {
  return {
    x: shape.endPosition?.x ?? shape.position.x + DEFAULT_LINE_LENGTH,
    y: shape.endPosition?.y ?? shape.position.y
  };
}

function strokeStyle(paint: ReturnType<typeof getShapeStyle>): Record<string, StyleValue> {
  return {
    strokeColor: colorOrNone(paint.strokeColor),
    strokeWidth: paint.strokeWidth,
    ...dashStyle(paint.dashArray)
  };
}

function arrowStyle(end: "start" | "end", enabled: boolean | undefined, size: number): Record<string, StyleValue> {
  if (enabled !== true) return { [`${end}Arrow`]: "none" };
  return { [`${end}Arrow`]: "block", [`${end}Fill`]: 1, [`${end}Size`]: size };
}

function lineShapeCell(shape: FreeShapeAnnotation, frame: Frame): string {
  const arrowSize = shape.lineArrowSize ?? DEFAULT_ARROW_SIZE;
  const style = cellStyle({
    html: 1,
    rounded: 0,
    ...arrowStyle("start", shape.lineStartArrow, arrowSize),
    ...arrowStyle("end", shape.lineEndArrow, arrowSize),
    ...strokeStyle(getShapeStyle(shape))
  });
  return (
    `<mxCell id="${escapeXml(`shape-${shape.id}`)}" style="${escapeXml(style)}" edge="1" parent="${escapeXml(frame.id)}">` +
    `<mxGeometry relative="1" as="geometry">` +
    mxPoint(shape.position, frame, "sourcePoint") +
    mxPoint(lineEnd(shape), frame, "targetPoint") +
    `</mxGeometry></mxCell>`
  );
}

function shapeCell(shape: FreeShapeAnnotation, frame: Frame): string {
  if (shape.shapeType === "line") return lineShapeCell(shape, frame);
  const isCircle = shape.shapeType === "circle";
  const paint = getShapeStyle(shape);
  const fill = parseColor(paint.fillColor);
  const style = cellStyle(
    {
      html: 1,
      whiteSpace: "wrap",
      connectable: 0,
      ...(isCircle ? {} : cornerStyle(shape.cornerRadius ?? 0)),
      fillColor: fill?.color ?? "none",
      fillOpacity: fill?.opacity,
      ...strokeStyle(paint),
      rotation: shape.rotation === 0 ? undefined : shape.rotation
    },
    isCircle ? "ellipse" : undefined
  );
  return (
    `<mxCell id="${escapeXml(`shape-${shape.id}`)}" value="" style="${escapeXml(style)}" vertex="1" parent="${escapeXml(frame.id)}">` +
    vertexGeometry(shapeRect(shape), frame) +
    `</mxCell>`
  );
}

/** Margins and line height of FreeTextNode.css, which a Draw.io label has no stylesheet for. */
function markdownToLabel(markdown: string): string {
  const html = renderMarkdown(markdown)
    .trim()
    .replace(/(<\/p>\s*)<p>/g, '$1<p style="margin:1.5em 0 0">')
    .replace(/<p>/g, '<p style="margin:0">')
    .replace(/^<(?!p[\s>])([a-z][a-z0-9]*)(?=>)/i, '<$1 style="margin-top:0"');
  return `<div style="line-height:1.5">${html}</div>`;
}

function textCell(text: FreeTextAnnotation, frame: Frame): string {
  const paint = getTextStyle(text);
  const { w, h } = getTextDimensions(text);
  const background = parseColor(paint.backgroundColor);
  const [paddingY, paddingX = paddingY] = paint.padding.split(" ").map((value) => parseFloat(value));
  const fontStyle =
    (paint.fontWeight === "bold" ? 1 : 0) +
    (paint.fontStyle === "italic" ? 2 : 0) +
    (paint.textDecoration === "underline" ? 4 : 0);
  const style = cellStyle(
    {
      html: 1,
      // Without a set size the text is as wide as its longest line, as on the canvas.
      whiteSpace: text.width === undefined ? "nowrap" : "wrap",
      connectable: 0,
      ...cornerStyle(paint.borderRadius),
      fillColor: background?.color ?? "none",
      fillOpacity: background?.opacity,
      strokeColor: "none",
      fontSize: paint.fontSize,
      fontColor: colorOrNone(paint.fontColor),
      fontStyle,
      fontFamily: fontFamilyStyle(text.fontFamily),
      align: paint.textAlign,
      verticalAlign: "top",
      spacing: 0,
      spacingTop: paddingY - TOP_LABEL_OFFSET,
      spacingBottom: paddingY,
      spacingLeft: paddingX,
      spacingRight: paddingX,
      rotation: text.rotation === 0 ? undefined : text.rotation
    },
    "text"
  );
  return (
    `<mxCell id="${escapeXml(`text-${text.id}`)}" value="${escapeXml(markdownToLabel(text.text || ""))}" style="${escapeXml(style)}" vertex="1" parent="${escapeXml(frame.id)}">` +
    vertexGeometry({ ...text.position, width: w, height: h }, frame) +
    `</mxCell>`
  );
}

// ============================================================================
// Document
// ============================================================================

function newFrame(id: string, position: Point, parent: Frame | null): Frame {
  return { id, x: position.x, y: position.y, parent, below: [], nodes: [], links: [], texts: [] };
}

function groupParentId(group: GroupStyleAnnotation): string | undefined {
  return group.parentId ?? group.groupId;
}

/** A frame per group, nested as on the canvas. A group in a parent cycle moves to the root. */
function buildGroupFrames(groups: GroupStyleAnnotation[], root: Frame): Map<string, Frame> {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const frames = new Map<string, Frame>();
  const frameFor = (group: GroupStyleAnnotation, path: Set<string>): Frame => {
    const existing = frames.get(group.id);
    if (existing) return existing;
    const parentGroup = byId.get(groupParentId(group) ?? "");
    const pathHere = new Set(path).add(group.id);
    const parent = parentGroup && !pathHere.has(parentGroup.id) ? frameFor(parentGroup, pathHere) : root;
    const frame = newFrame(`group-${group.id}`, group.position, parent);
    frames.set(group.id, frame);
    parent.below.push({
      zIndex: group.zIndex ?? 0,
      isGroup: true,
      cell: (at) => groupCell(group, frame.id, at) + emitFrame(frame)
    });
    return frame;
  };
  for (const group of groups) frameFor(group, new Set());
  return frames;
}

function frameChain(frame: Frame): Frame[] {
  const chain: Frame[] = [];
  for (let current: Frame | null = frame; current; current = current.parent) chain.unshift(current);
  return chain;
}

/** The innermost frame holding both ends: a link in a group moves with it. */
function commonFrame(a: Frame, b: Frame): Frame {
  const chainA = frameChain(a);
  const chainB = frameChain(b);
  let common = chainA[0];
  for (let i = 0; i < chainA.length && chainA[i] === chainB[i]; i++) common = chainA[i];
  return common;
}

/**
 * Draw.io stacks cells in file order, and a group's members right after the
 * group. A shape on top of a group would therefore cover its members, so on
 * equal z the group comes last.
 */
function emitFrame(frame: Frame): string {
  const below = frame.below
    .toSorted((a, b) => a.zIndex - b.zIndex || Number(a.isGroup) - Number(b.isGroup))
    .map((item) => item.cell(frame))
    .join("");
  return below + frame.nodes.join("") + frame.links.join("") + frame.texts.join("");
}

function pageOrigin(rects: Rect[]): Point {
  if (rects.length === 0) return { x: 0, y: 0 };
  return {
    x: Math.min(...rects.map((rect) => rect.x)) - PAGE_MARGIN,
    y: Math.min(...rects.map((rect) => rect.y)) - PAGE_MARGIN
  };
}

function annotationRects(annotations: AnnotationData | undefined): Rect[] {
  if (!annotations) return [];
  const { groups, shapeAnnotations, textAnnotations } = annotations;
  return [
    ...groups.map((group) => ({ ...group.position, width: group.width, height: group.height })),
    ...shapeAnnotations.map((shape) =>
      shape.shapeType === "line"
        ? {
            x: Math.min(shape.position.x, lineEnd(shape).x),
            y: Math.min(shape.position.y, lineEnd(shape).y),
            width: 0,
            height: 0
          }
        : shapeRect(shape)
    ),
    ...textAnnotations.map((text) => ({ ...text.position, width: 0, height: 0 }))
  ];
}

/** The page color for an export that keeps the canvas look. */
export function resolveCanvasBackground(canvasColor?: string | null): string {
  if (canvasColor !== undefined && canvasColor !== null && canvasColor.length > 0) return canvasColor;
  return resolveCssColor("var(--clab-ui-editor-background, var(--vscode-editor-background))", "#1e1e1e");
}

function nodeContext(options: DrawioExportOptions): NodeContext {
  const { renderOptions, background } = options;
  return {
    iconSize: resolveNodeIconSize(renderOptions?.nodeIconSize),
    boxed: (renderOptions?.nodeStyle ?? DEFAULT_NODE_STYLE) === "boxed",
    spacing: renderOptions?.nodeBoxSpacing,
    iconInk: renderOptions?.iconInk ?? getIconInk(background),
    customIcons: options.customIcons,
    background
  };
}

function graphModelAttributes(background: string | undefined): string {
  const page = parseColor(background)?.color;
  return [
    `dx="0" dy="0" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="0" page="0" pageScale="1" math="0" shadow="0"`,
    // Colors stay as exported when Draw.io runs in dark mode.
    `adaptiveColors="none"`,
    ...(page === undefined ? [] : [`background="${escapeXml(page)}"`])
  ].join(" ");
}

export function buildDrawioXml(options: DrawioExportOptions): string {
  const { annotations } = options;
  const skipTypes = options.annotationNodeTypes ?? new Set<string>();
  const graphNodes = options.nodes.filter((node) => !skipTypes.has(node.type ?? ""));
  const ctx = nodeContext(options);

  const rects = new Map(graphNodes.map((node) => [node.id, nodeRect(node, ctx)]));
  const root = newFrame(
    ROOT_CELL_ID,
    pageOrigin([...rects.values(), ...annotationRects(annotations)]),
    null
  );
  const groupFrames = buildGroupFrames(annotations?.groups ?? [], root);
  const frameOf = (groupId: unknown): Frame =>
    (typeof groupId === "string" ? groupFrames.get(groupId) : undefined) ?? root;

  for (const shape of annotations?.shapeAnnotations ?? []) {
    frameOf(shape.groupId).below.push({
      zIndex: shape.zIndex ?? 0,
      isGroup: false,
      cell: (frame) => shapeCell(shape, frame)
    });
  }
  const nodeFrames = new Map(graphNodes.map((node) => [node.id, frameOf(node.data.groupId)]));
  for (const node of graphNodes) {
    const frame = frameOf(node.data.groupId);
    frame.nodes.push(nodeCell(node, frame, ctx));
  }
  const links = layoutEdges(
    options.edges,
    options.nodes,
    options.includeEdgeLabels,
    options.annotationNodeTypes,
    options.renderOptions
  );
  for (const link of links) {
    const frame = commonFrame(
      nodeFrames.get(link.source) ?? root,
      nodeFrames.get(link.target) ?? root
    );
    frame.links.push(linkCell(link, frame, (id) => rects.get(id)));
  }
  for (const text of annotations?.textAnnotations ?? []) {
    const frame = frameOf(text.groupId);
    frame.texts.push(textCell(text, frame));
  }

  return (
    `<mxfile host="containerlab">` +
    `<diagram name="${escapeXml(options.name)}" id="topology">` +
    `<mxGraphModel ${graphModelAttributes(options.background)}><root>` +
    `<mxCell id="0"/><mxCell id="${ROOT_CELL_ID}" parent="0"/>` +
    emitFrame(root) +
    `</root></mxGraphModel></diagram></mxfile>`
  );
}
