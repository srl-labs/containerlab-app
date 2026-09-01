// Annotation-to-SVG conversion for export.
import type {
  FreeTextAnnotation,
  FreeShapeAnnotation,
  GroupStyleAnnotation
} from "../../../core/types/topology";
import { DEFAULT_ARROW_SIZE, DEFAULT_LINE_LENGTH } from "../../../annotations/constants";
import { applyAlphaToColor } from "../../../utils/color";
import { renderMarkdown } from "../../../utils/markdownRenderer";
import { GRAPH_LAYER_CLASS, resolveCssColor } from "./constants";

// ============================================================================
// Constants
// ============================================================================

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_MIME_TYPE = "image/svg+xml";
const ANNOTATION_GROUPS_LAYER = "annotation-groups-layer";
const ANNOTATION_SHAPES_LAYER = "annotation-shapes-layer";
const ANNOTATION_TEXT_LAYER = "annotation-text-layer";
const DEFAULT_FONT_FAMILY = "sans-serif";

/** Theme foreground used by canvas annotation defaults (vscodePalette.text.primary). */
const THEME_FOREGROUND_CSS = "var(--clab-ui-editor-foreground, var(--vscode-foreground))";
const THEME_FOREGROUND_FALLBACK = "#d4d4d4";

/** Canvas shape defaults (matches FreeShapeNode.tsx BoxNode/LineNode fallbacks). */
const SHAPE_DEFAULT_FILL_COLOR = "rgba(100, 100, 100, 0.2)";
const SHAPE_DEFAULT_FILL_OPACITY = 0.2;
const SHAPE_DEFAULT_BORDER_WIDTH = 2;
const SHAPE_DEFAULT_BORDER_STYLE = "solid" as const;

/** Canvas group defaults (matches GroupNode.tsx constants). */
const GROUP_DEFAULT_BACKGROUND_CSS = "var(--vscode-list-hoverBackground)";
const GROUP_DEFAULT_BACKGROUND_FALLBACK = "#2a2d2e";
const GROUP_DEFAULT_BORDER_WIDTH = 2;
const GROUP_DEFAULT_BORDER_STYLE = "dashed" as const;
const GROUP_DEFAULT_BORDER_RADIUS = 8;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getBorderDashArray(style?: FreeShapeAnnotation["borderStyle"]): string {
  switch (style) {
    case "dashed":
      return "8,4"; // Match FreeShapeNode.tsx getStrokeDasharray()
    case "dotted":
      return "2,2";
    default:
      return "";
  }
}

function getGroupBorderDashArray(style?: GroupStyleAnnotation["borderStyle"]): string {
  switch (style) {
    case "dashed":
      return "8,4"; // Match FreeShapeNode.tsx getStrokeDasharray()
    case "dotted":
      return "2,2";
    case "double":
      return ""; // Double style not directly supported in SVG dash, render as solid
    default:
      return "";
  }
}

interface ShapeStyle {
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  dashArray: string;
}

function getShapeStyle(shape: FreeShapeAnnotation): ShapeStyle {
  return {
    fillColor: applyAlphaToColor(
      shape.fillColor ?? SHAPE_DEFAULT_FILL_COLOR,
      shape.fillOpacity ?? SHAPE_DEFAULT_FILL_OPACITY
    ),
    strokeColor:
      shape.borderColor ?? resolveCssColor(THEME_FOREGROUND_CSS, THEME_FOREGROUND_FALLBACK),
    strokeWidth: shape.borderWidth ?? SHAPE_DEFAULT_BORDER_WIDTH,
    dashArray: getBorderDashArray(shape.borderStyle ?? SHAPE_DEFAULT_BORDER_STYLE)
  };
}

function buildRectAttrs(style: ShapeStyle, cornerRadius: number): string {
  let attrs = `fill="${style.fillColor}" stroke="${style.strokeColor}" stroke-width="${style.strokeWidth}" `;
  if (cornerRadius > 0) attrs += `rx="${cornerRadius}" ry="${cornerRadius}" `;
  if (style.dashArray) attrs += `stroke-dasharray="${style.dashArray}" `;
  return attrs;
}

function buildStrokeAttrs(style: ShapeStyle): string {
  let attrs = `stroke="${style.strokeColor}" stroke-width="${style.strokeWidth}" `;
  if (style.dashArray) attrs += `stroke-dasharray="${style.dashArray}" `;
  return attrs;
}

// ============================================================================
// Group to SVG
// ============================================================================

interface LabelPosition {
  x: number;
  y: number;
  textAnchor: string;
}

interface GroupRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Calculate label position based on labelPosition property.
 * Matches GroupNode.tsx getLabelPositionStyle() CSS offsets:
 * - top positions: top: -20, left/right: 8, with 2px/6px label padding
 * - bottom positions: bottom: -20, left/right: 8
 */
function calculateLabelPosition(
  rect: GroupRect,
  labelPosition: string,
  labelFontSize: number
): LabelPosition {
  const { x, y, width, height } = rect;
  // CSS offsets from GroupNode.tsx (top: -20, left: 8) plus the label's own
  // 2px/6px padding; the label div is ~18px tall, so the text baseline sits
  // ~12px below the div top.
  const sideOffset = 8 + 6;
  const topBaseline = y - 20 + labelFontSize;
  const bottomBaseline = y + height + 20 - 18 + labelFontSize;

  const positions: Record<string, LabelPosition> = {
    "top-left": { x: x + sideOffset, y: topBaseline, textAnchor: "start" },
    "top-center": { x: x + width / 2, y: topBaseline, textAnchor: "middle" },
    "top-right": {
      x: x + width - sideOffset,
      y: topBaseline,
      textAnchor: "end"
    },
    "bottom-left": {
      x: x + sideOffset,
      y: bottomBaseline,
      textAnchor: "start"
    },
    "bottom-center": {
      x: x + width / 2,
      y: bottomBaseline,
      textAnchor: "middle"
    },
    "bottom-right": {
      x: x + width - sideOffset,
      y: bottomBaseline,
      textAnchor: "end"
    }
  };

  return positions[labelPosition] ?? positions["top-left"];
}

/**
 * Build SVG for group label (no background - matches GroupNode.tsx).
 * Uses MODEL coordinates - the parent transform handles scaling.
 */
function buildGroupLabelSvg(
  name: string,
  labelPos: LabelPosition,
  labelColor: string,
  labelFontSize: number
): string {
  // No background rect - canvas GroupNode.tsx doesn't have one.
  // The canvas label inherits the app font, so resolve it from the live DOM.
  let svg = `<text x="${labelPos.x}" y="${labelPos.y}" `;
  svg += `fill="${labelColor}" font-size="${labelFontSize}" font-weight="500" `;
  svg += `font-family='${escapeXml(resolveInheritedFontFamily())}' text-anchor="${labelPos.textAnchor}">`;
  svg += escapeXml(name);
  svg += `</text>`;

  return svg;
}

/**
 * Apply background opacity like the canvas (GroupNode.tsx getBackgroundWithOpacity):
 * only when an explicit opacity is present; rgba alpha gets replaced, hex gets
 * an alpha channel appended.
 */
function getGroupBackgroundWithOpacity(color: string, opacity: number | undefined): string {
  if (opacity === undefined) return color;
  return applyAlphaToColor(color, opacity / 100);
}

/**
 * Convert a GroupStyleAnnotation to an SVG string.
 * Groups are rendered as rectangles with optional label.
 * NOTE: Uses MODEL coordinates - the parent transform handles scaling.
 * Group position is the TOP-LEFT corner (React Flow node position, same as canvas).
 */
function groupToSvgString(group: GroupStyleAnnotation): string {
  const width = group.width;
  const height = group.height;
  const x = group.position.x;
  const y = group.position.y;

  const bgColor =
    group.backgroundColor ??
    resolveCssColor(GROUP_DEFAULT_BACKGROUND_CSS, GROUP_DEFAULT_BACKGROUND_FALLBACK);
  const fillColor =
    bgColor === "transparent"
      ? "none"
      : getGroupBackgroundWithOpacity(bgColor, group.backgroundOpacity);

  const themeForeground = resolveCssColor(THEME_FOREGROUND_CSS, THEME_FOREGROUND_FALLBACK);
  const borderColor = group.borderColor ?? themeForeground;
  const borderWidth = group.borderWidth ?? GROUP_DEFAULT_BORDER_WIDTH;
  const borderRadius = group.borderRadius ?? GROUP_DEFAULT_BORDER_RADIUS;
  const dashArray = getGroupBorderDashArray(group.borderStyle ?? GROUP_DEFAULT_BORDER_STYLE);

  let svg = `<g class="annotation-group" data-id="${escapeXml(group.id)}">`;
  svg += `<rect x="${x}" y="${y}" width="${width}" height="${height}" `;
  svg += `fill="${fillColor}" stroke="${borderColor}" stroke-width="${borderWidth}" `;
  if (borderRadius > 0) svg += `rx="${borderRadius}" ry="${borderRadius}" `;
  if (dashArray) svg += `stroke-dasharray="${dashArray}" `;
  svg += `/>`;

  if (group.name) {
    // Match GroupNode.tsx: fontSize 12, fontWeight 500, no background
    const labelFontSize = 12;
    const labelPos = calculateLabelPosition(
      { x, y, width, height },
      group.labelPosition ?? "top-left",
      labelFontSize
    );
    svg += buildGroupLabelSvg(
      group.name,
      labelPos,
      group.labelColor ?? themeForeground,
      labelFontSize
    );
  }

  svg += `</g>`;
  return svg;
}

// ============================================================================
// Shape to SVG - Subcomponents
// ============================================================================

function makeArrowPoints(
  arrowSize: number,
  x: number,
  y: number,
  fromX: number,
  fromY: number
): string {
  const angle = Math.atan2(y - fromY, x - fromX);
  const arrowAngle = Math.PI / 6;
  const p1x = x - arrowSize * Math.cos(angle - arrowAngle);
  const p1y = y - arrowSize * Math.sin(angle - arrowAngle);
  const p3x = x - arrowSize * Math.cos(angle + arrowAngle);
  const p3y = y - arrowSize * Math.sin(angle + arrowAngle);
  return `${p1x},${p1y} ${x},${y} ${p3x},${p3y}`;
}

function buildRectangleSvg(shape: FreeShapeAnnotation): string {
  const style = getShapeStyle(shape);
  const width = shape.width ?? 50;
  const height = shape.height ?? 50;
  // Shape position is the TOP-LEFT corner (React Flow node position, same as canvas)
  const x = shape.position.x;
  const y = shape.position.y;
  const cornerRadius = shape.cornerRadius ?? 0;
  const rotation = shape.rotation ?? 0;
  // Canvas rotates around the shape center
  const cx = x + width / 2;
  const cy = y + height / 2;

  let svg = `<g class="annotation-shape" data-id="${escapeXml(shape.id)}"`;
  if (rotation !== 0) svg += ` transform="rotate(${rotation}, ${cx}, ${cy})"`;
  svg += `>`;
  svg += `<rect x="${x}" y="${y}" width="${width}" height="${height}" ${buildRectAttrs(style, cornerRadius)}/>`;
  svg += `</g>`;
  return svg;
}

function buildCircleSvg(shape: FreeShapeAnnotation): string {
  const style = getShapeStyle(shape);
  const width = shape.width ?? 50;
  const height = shape.height ?? 50;
  // Shape position is the TOP-LEFT corner (React Flow node position, same as canvas)
  const cx = shape.position.x + width / 2;
  const cy = shape.position.y + height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const rotation = shape.rotation ?? 0;

  let svg = `<g class="annotation-shape" data-id="${escapeXml(shape.id)}"`;
  if (rotation !== 0) svg += ` transform="rotate(${rotation}, ${cx}, ${cy})"`;
  svg += `>`;
  svg += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${style.fillColor}" ${buildStrokeAttrs(style)}/>`;
  svg += `</g>`;
  return svg;
}

function buildLineSvg(shape: FreeShapeAnnotation): string {
  const style = getShapeStyle(shape);
  const startX = shape.position.x;
  const startY = shape.position.y;
  const endX = shape.endPosition?.x ?? shape.position.x + DEFAULT_LINE_LENGTH;
  const endY = shape.endPosition?.y ?? shape.position.y;
  const arrowSize = shape.lineArrowSize ?? DEFAULT_ARROW_SIZE;

  // Shorten line ends if arrows are present
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.sqrt(dx * dx + dy * dy);
  let lineStartX = startX,
    lineStartY = startY,
    lineEndX = endX,
    lineEndY = endY;

  if (length > 0) {
    const ux = dx / length;
    const uy = dy / length;
    // Canvas (FreeShapeNode LineShape) shortens by the full arrow size
    if (shape.lineStartArrow === true) {
      lineStartX += ux * arrowSize;
      lineStartY += uy * arrowSize;
    }
    if (shape.lineEndArrow === true) {
      lineEndX -= ux * arrowSize;
      lineEndY -= uy * arrowSize;
    }
  }

  let svg = `<g class="annotation-shape" data-id="${escapeXml(shape.id)}">`;
  svg += `<line x1="${lineStartX}" y1="${lineStartY}" x2="${lineEndX}" y2="${lineEndY}" ${buildStrokeAttrs(style)}/>`;

  if (shape.lineStartArrow === true) {
    svg += `<polygon points="${makeArrowPoints(arrowSize, startX, startY, endX, endY)}" fill="${style.strokeColor}" />`;
  }
  if (shape.lineEndArrow === true) {
    svg += `<polygon points="${makeArrowPoints(arrowSize, endX, endY, startX, startY)}" fill="${style.strokeColor}" />`;
  }

  svg += `</g>`;
  return svg;
}

/**
 * Convert a FreeShapeAnnotation to an SVG string.
 * NOTE: Uses MODEL coordinates - the parent transform handles scaling.
 */
function shapeToSvgString(shape: FreeShapeAnnotation): string {
  switch (shape.shapeType) {
    case "rectangle":
      return buildRectangleSvg(shape);
    case "circle":
      return buildCircleSvg(shape);
    case "line":
    default:
      return buildLineSvg(shape);
  }
}

// ============================================================================
// Text to SVG
// ============================================================================

interface TextStyle {
  fontSize: number;
  fontColor: string;
  fontWeight: string;
  fontStyle: string;
  textDecoration: string;
  textAlign: string;
  fontFamily: string;
  backgroundColor: string;
  borderRadius: number;
  padding: string;
}

function isNoFillBackground(backgroundColor: string | undefined): boolean {
  if (backgroundColor === undefined) return true;
  const normalized = backgroundColor.trim().toLowerCase();
  return normalized.length === 0 || normalized === "transparent";
}

/** Resolve the app font used by the canvas for `fontFamily: inherit` texts. */
function resolveInheritedFontFamily(): string {
  if (typeof document === "undefined" || document.body === null) return DEFAULT_FONT_FAMILY;
  const fontFamily = getComputedStyle(document.body).fontFamily;
  return fontFamily.length > 0 ? fontFamily : DEFAULT_FONT_FAMILY;
}

function getTextStyle(text: FreeTextAnnotation): TextStyle {
  // Match FreeTextNode.tsx buildTextStyle() defaults
  const backgroundColor = isNoFillBackground(text.backgroundColor)
    ? "transparent"
    : (text.backgroundColor as string);
  const hasBackground = backgroundColor !== "transparent";
  const roundedBackground = text.roundedBackground ?? true;
  const fontFamily = text.fontFamily ?? "inherit";
  return {
    fontSize: text.fontSize ?? 14,
    fontColor: text.fontColor ?? "#333", // Match FreeTextNode default
    fontWeight: text.fontWeight ?? "normal",
    fontStyle: text.fontStyle ?? "normal",
    textDecoration: text.textDecoration ?? "none",
    textAlign: text.textAlign ?? "left",
    fontFamily: fontFamily === "inherit" ? resolveInheritedFontFamily() : fontFamily,
    backgroundColor,
    borderRadius: roundedBackground && hasBackground ? 4 : 0,
    // Matches FreeTextNode.tsx getTextPadding(): "4px 8px" with background, "4px" without
    padding: hasBackground ? "4px 8px" : "4px"
  };
}

function buildTextStyleString(style: TextStyle): string {
  let css = `width: 100%; height: 100%; overflow: hidden; `;
  // Match TEXT_LINE_HEIGHT in FreeTextNode.tsx so exports lay out like the canvas.
  css += `font-size: ${style.fontSize}px; line-height: 1.5; color: ${style.fontColor}; `;
  css += `font-weight: ${style.fontWeight}; font-style: ${style.fontStyle}; `;
  css += `text-decoration: ${style.textDecoration}; text-align: ${style.textAlign}; `;
  css += `font-family: ${style.fontFamily}; `;
  css += `background-color: ${style.backgroundColor}; `;
  if (style.borderRadius > 0) css += `border-radius: ${style.borderRadius}px; `;
  css += `box-sizing: border-box; padding: ${style.padding};`;
  return css;
}

/**
 * Estimate text dimensions based on content and font properties.
 * Returns { width, height } in unscaled coordinates.
 */
function estimateTextDimensions(
  textContent: string,
  fontSize: number,
  fontFamily: string,
  fontWeight: string,
  marginResetActive = true
): { width: number; height: number } {
  // Split into lines for multi-line text
  const lines = textContent.split("\n");
  const lineCount = Math.max(1, lines.length);

  // Find the longest line
  const longestLine = lines.reduce((a, b) => (a.length > b.length ? a : b), "");

  // Character width multiplier based on font family
  // Monospace fonts have consistent width, proportional fonts vary
  const isMonospace = fontFamily.toLowerCase().includes("mono");
  const charWidthRatio = isMonospace ? 0.6 : 0.55;

  // Bold text is slightly wider
  const boldMultiplier = fontWeight === "bold" ? 1.1 : 1.0;

  // Calculate dimensions
  const charWidth = fontSize * charWidthRatio * boldMultiplier;
  const lineHeight = fontSize * 1.5; // Match TEXT_LINE_HEIGHT in FreeTextNode.tsx

  // Add padding (4px on each side, matching the canvas no-background padding);
  // without the paragraph-margin reset, default <p> margins add ~1em above and below
  const padding = 8;
  const marginAllowance = marginResetActive ? 0 : fontSize * 2;
  const width = Math.max(50, longestLine.length * charWidth + padding);
  const height = Math.max(fontSize + padding, lineCount * lineHeight + padding + marginAllowance);

  return { width, height };
}

/**
 * Markdown layout rules matching FreeTextNode.css so exported text lays out
 * like the canvas (default <p> margins would otherwise push content out of
 * the fixed-height, overflow-hidden box).
 */
const EXPORT_TEXT_MARKDOWN_CSS =
  ".export-free-text>:first-child{margin-top:0}" +
  ".export-free-text>:last-child{margin-bottom:0}" +
  ".export-free-text p{margin-block:0}" +
  ".export-free-text p+p{margin-block-start:1.5em;margin-block-start:1lh}" +
  ".export-free-text img{display:block;max-width:100%}" +
  ".export-free-text--fixed img{width:100%;height:100%;max-height:100%;object-fit:contain}" +
  ".export-free-text--auto img{width:100%;height:auto;object-fit:contain}";

/**
 * Whether the canvas actually applies the FreeTextNode.css paragraph-margin
 * reset. Some hosts load clab-ui without that stylesheet; there the canvas
 * renders free text with browser-default <p> margins (one line lower), and
 * the export must reproduce that instead of forcing the reset. Sampling a
 * live paragraph keeps the export true to whatever is on screen.
 */
function isFreeTextMarginResetActive(): boolean {
  if (typeof document === "undefined") return true;
  const paragraph = document.querySelector(".free-text-markdown p:first-child");
  if (!paragraph) return true;
  return Number.parseFloat(getComputedStyle(paragraph).marginBlockStart) === 0;
}

/**
 * Convert a FreeTextAnnotation to an SVG string using foreignObject.
 * This preserves markdown rendering and styling.
 * NOTE: Uses MODEL coordinates - the parent transform handles scaling.
 * Text position represents the TOP-LEFT of the annotation (React Flow convention).
 */
function textToSvgString(text: FreeTextAnnotation, marginResetActive: boolean): string {
  // Use explicit dimensions if provided, otherwise estimate from content
  let width: number;
  let height: number;

  if (text.width !== undefined && text.height !== undefined) {
    width = text.width;
    height = text.height;
  } else {
    const estimated = estimateTextDimensions(
      text.text || "",
      text.fontSize ?? 14,
      text.fontFamily ?? "inherit",
      text.fontWeight ?? "normal",
      marginResetActive
    );
    width = text.width ?? estimated.width;
    height = text.height ?? estimated.height;
  }

  // Text position is TOP-LEFT based in React Flow
  // Use position directly for SVG foreignObject
  const x = text.position.x;
  const y = text.position.y;

  const rotation = text.rotation ?? 0;
  // Center point for rotation
  const cx = text.position.x + width / 2;
  const cy = text.position.y + height / 2;

  const style = getTextStyle(text);
  const styleStr = buildTextStyleString(style);
  const htmlContent = renderMarkdown(text.text || "");

  const sizeClass =
    text.width !== undefined && text.height !== undefined
      ? "export-free-text--fixed"
      : "export-free-text--auto";

  let svg = `<g class="annotation-text" data-id="${escapeXml(text.id)}"`;
  if (rotation !== 0) svg += ` transform="rotate(${rotation}, ${cx}, ${cy})"`;
  svg += `>`;

  svg += `<foreignObject x="${x}" y="${y}" width="${width}" height="${height}">`;
  // Only force the margin reset when the live canvas applies it; otherwise the
  // exported markdown keeps browser-default margins, matching the screen.
  if (marginResetActive) {
    svg += `<style xmlns="${XHTML_NS}">${EXPORT_TEXT_MARKDOWN_CSS}</style>`;
  }
  svg += `<div xmlns="${XHTML_NS}" class="export-free-text ${sizeClass}" style="${styleStr}">`;
  svg += htmlContent;
  svg += `</div>`;
  svg += `</foreignObject>`;
  svg += `</g>`;

  return svg;
}

// ============================================================================
// Composite into SVG
// ============================================================================

export interface AnnotationData {
  groups: GroupStyleAnnotation[];
  textAnnotations: FreeTextAnnotation[];
  shapeAnnotations: FreeShapeAnnotation[];
}

/**
 * Add a background rectangle to the SVG content.
 * Handles both SVGs with viewBox and those with only width/height.
 */
export function addBackgroundRect(svgContent: string, color: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, SVG_MIME_TYPE);
  const svgEl = doc.documentElement;

  const viewBox = svgEl.getAttribute("viewBox");
  let x = 0,
    y = 0,
    width = 0,
    height = 0;

  if (viewBox !== null && viewBox.length > 0) {
    [x, y, width, height] = viewBox.split(" ").map(parseFloat);
  } else {
    // Fall back to width/height attributes
    width = parseFloat(svgEl.getAttribute("width") ?? "0");
    height = parseFloat(svgEl.getAttribute("height") ?? "0");
    if (width === 0 || height === 0) return svgContent;
  }

  const rect = doc.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", x.toString());
  rect.setAttribute("y", y.toString());
  rect.setAttribute("width", width.toString());
  rect.setAttribute("height", height.toString());
  rect.setAttribute("fill", color);

  svgEl.insertBefore(rect, svgEl.firstChild);

  return new XMLSerializer().serializeToString(svgEl);
}

function parseAndImportElement(doc: Document, parser: DOMParser, svgStr: string): Element | null {
  const tempDoc = parser.parseFromString(`<svg xmlns="${SVG_NS}">${svgStr}</svg>`, SVG_MIME_TYPE);
  const element = tempDoc.documentElement.firstChild;
  if (!(element instanceof Element)) return null;
  const imported = doc.importNode(element, true);
  return imported instanceof Element ? imported : null;
}

function elementHasClass(element: Element, className: string): boolean {
  return (element.getAttribute("class") ?? "").split(/\s+/).includes(className);
}

function isAnnotationLayer(element: Element): boolean {
  return (
    elementHasClass(element, ANNOTATION_GROUPS_LAYER) ||
    elementHasClass(element, ANNOTATION_SHAPES_LAYER) ||
    elementHasClass(element, ANNOTATION_TEXT_LAYER)
  );
}

/**
 * Extract the full transform attribute from the SVG's main group.
 * Returns the complete transform string including all translates and scale.
 */
function extractGraphTransform(svgEl: Element): string {
  const explicitGraphLayer = svgEl.querySelector(`g.${GRAPH_LAYER_CLASS}[transform]`);
  if (explicitGraphLayer instanceof Element) {
    return explicitGraphLayer.getAttribute("transform") ?? "";
  }

  for (const group of Array.from(svgEl.querySelectorAll("g[transform]"))) {
    if (isAnnotationLayer(group)) continue;
    if (group.querySelector("g.export-node, g.export-edge") === null) continue;

    const transform = group.getAttribute("transform") ?? "";
    if (transform.includes("scale(")) {
      return transform;
    }
  }

  const firstGroup = Array.from(svgEl.querySelectorAll("g[transform]")).find(
    (group) => !isAnnotationLayer(group)
  );
  return firstGroup?.getAttribute("transform") ?? "";
}

/**
 * Parse transform to extract scale value for bounds calculation.
 */
function extractScaleFromTransform(transform: string): number {
  const scaleMatch = /scale\(\s*([-\d.]+)(?:\s*,\s*([-\d.]+))?\s*\)/.exec(transform);
  return scaleMatch ? parseFloat(scaleMatch[1]) : 1;
}

/**
 * Parse transform to extract the total translate values for bounds calculation.
 * Sums all translate operations in the transform string.
 */
function extractTranslateFromTransform(transform: string): {
  tx: number;
  ty: number;
} {
  let totalTx = 0;
  let totalTy = 0;

  const translateRegex = /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g;
  let match;
  while ((match = translateRegex.exec(transform)) !== null) {
    totalTx += parseFloat(match[1]);
    totalTy += parseFloat(match[2]);
  }

  return { tx: totalTx, ty: totalTy };
}

interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Merge a rect (x1,y1,x2,y2) into bounds */
function mergeBounds(bounds: BoundingBox, x1: number, y1: number, x2: number, y2: number): void {
  bounds.minX = Math.min(bounds.minX, x1);
  bounds.minY = Math.min(bounds.minY, y1);
  bounds.maxX = Math.max(bounds.maxX, x2);
  bounds.maxY = Math.max(bounds.maxY, y2);
}

function addGroupBounds(bounds: BoundingBox, groups: GroupStyleAnnotation[]): void {
  for (const group of groups) {
    const { x, y } = group.position;
    mergeBounds(bounds, x, y, x + group.width, y + group.height);
  }
}

function addShapeBounds(bounds: BoundingBox, shapes: FreeShapeAnnotation[]): void {
  for (const shape of shapes) {
    if (shape.shapeType === "line") {
      const x1 = shape.position.x;
      const y1 = shape.position.y;
      const x2 = shape.endPosition?.x ?? shape.position.x;
      const y2 = shape.endPosition?.y ?? shape.position.y;
      mergeBounds(bounds, Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2));
    } else {
      // Rect/circle positions are TOP-LEFT based (React Flow convention)
      const { x, y } = shape.position;
      mergeBounds(bounds, x, y, x + (shape.width ?? 50), y + (shape.height ?? 50));
    }
  }
}

function getTextDimensions(text: FreeTextAnnotation): { w: number; h: number } {
  if (text.width !== undefined && text.height !== undefined) {
    return { w: text.width, h: text.height };
  }
  const estimated = estimateTextDimensions(
    text.text || "",
    text.fontSize ?? 14,
    text.fontFamily ?? "sans-serif",
    text.fontWeight ?? "normal"
  );
  return {
    w: text.width ?? estimated.width,
    h: text.height ?? estimated.height
  };
}

function addTextBounds(bounds: BoundingBox, texts: FreeTextAnnotation[]): void {
  for (const text of texts) {
    const { w, h } = getTextDimensions(text);
    // Text position is TOP-LEFT based (React Flow convention)
    const x1 = text.position.x;
    const y1 = text.position.y;
    const x2 = text.position.x + w;
    const y2 = text.position.y + h;
    mergeBounds(bounds, x1, y1, x2, y2);
  }
}

/**
 * Calculate bounding box for all annotations (in MODEL coordinates).
 * NOTE: All annotation positions are TOP-LEFT based (React Flow convention).
 */
function calculateAnnotationsBounds(annotations: AnnotationData): BoundingBox {
  const bounds: BoundingBox = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  };
  addGroupBounds(bounds, annotations.groups);
  addShapeBounds(bounds, annotations.shapeAnnotations);
  addTextBounds(bounds, annotations.textAnnotations);
  return bounds;
}

function shiftGroupTransforms(svgEl: Element, shiftX: number, shiftY: number): void {
  const children = svgEl.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.tagName === "g") {
      const existingTransform = child.getAttribute("transform") ?? "";
      const newTransform = existingTransform
        ? `translate(${shiftX}, ${shiftY}) ${existingTransform}`
        : `translate(${shiftX}, ${shiftY})`;
      child.setAttribute("transform", newTransform);
    }
  }
}

function shiftBackgroundRect(
  svgEl: Element,
  shiftX: number,
  shiftY: number,
  newWidth: number,
  newHeight: number
): void {
  const bgRect = svgEl.querySelector("rect");
  if (bgRect && !bgRect.closest("g")) {
    const rectX = parseFloat(bgRect.getAttribute("x") ?? "0");
    const rectY = parseFloat(bgRect.getAttribute("y") ?? "0");
    bgRect.setAttribute("x", (rectX + shiftX).toString());
    bgRect.setAttribute("y", (rectY + shiftY).toString());
    bgRect.setAttribute("width", newWidth.toString());
    bgRect.setAttribute("height", newHeight.toString());
  }
}

/**
 * Expand SVG dimensions to include annotation bounds.
 * @param transform - The full transform string from the graph
 */
function expandSvgBounds(svgEl: Element, annotationBounds: BoundingBox, transform: string): void {
  const currentWidth = parseFloat(svgEl.getAttribute("width") ?? "0");
  const currentHeight = parseFloat(svgEl.getAttribute("height") ?? "0");

  // Extract translate and scale from the transform
  const { tx, ty } = extractTranslateFromTransform(transform);
  const scale = extractScaleFromTransform(transform);

  // Transform annotation bounds from model coordinates to SVG coordinates
  // The transform applies scale THEN translate, so:
  // SVG_x = model_x * scale + tx
  const margin = 20;
  const annMinX = annotationBounds.minX * scale + tx - margin;
  const annMinY = annotationBounds.minY * scale + ty - margin;
  const annMaxX = annotationBounds.maxX * scale + tx + margin;
  const annMaxY = annotationBounds.maxY * scale + ty + margin;

  // Combined bounds
  const newMinX = Math.min(0, annMinX);
  const newMinY = Math.min(0, annMinY);
  const newMaxX = Math.max(currentWidth, annMaxX);
  const newMaxY = Math.max(currentHeight, annMaxY);

  const newWidth = newMaxX - newMinX;
  const newHeight = newMaxY - newMinY;
  const needsExpansion =
    newMinX < 0 || newMinY < 0 || newWidth > currentWidth || newHeight > currentHeight;

  if (!needsExpansion) return;

  svgEl.setAttribute("width", newWidth.toString());
  svgEl.setAttribute("height", newHeight.toString());

  // If we expanded to negative coordinates, shift all content
  if (newMinX < 0 || newMinY < 0) {
    const shiftX = newMinX < 0 ? -newMinX : 0;
    const shiftY = newMinY < 0 ? -newMinY : 0;

    shiftGroupTransforms(svgEl, shiftX, shiftY);
    shiftBackgroundRect(svgEl, shiftX, shiftY, newWidth, newHeight);
  }
}

/**
 * Composite annotations into an existing graph SVG.
 * Annotations are inserted in z-order: groups (background), shapes, text (foreground).
 * The graph transform is extracted and applied to annotation layers so they
 * use the same coordinate system as the graph nodes (model coordinates).
 */
export function compositeAnnotationsIntoSvg(
  graphSvg: string,
  annotations: AnnotationData,
  _scale: number // Kept for API compatibility but not used - scale comes from transform
): string {
  const { groups, textAnnotations, shapeAnnotations } = annotations;

  // Skip if no annotations
  if (groups.length === 0 && textAnnotations.length === 0 && shapeAnnotations.length === 0) {
    return graphSvg;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(graphSvg, SVG_MIME_TYPE);
  const svgEl = doc.documentElement;

  // Extract the FULL transform from graph content (including all translates and scale)
  // This ensures annotations use the exact same coordinate system as graph nodes
  const transform = extractGraphTransform(svgEl);

  const makeLayer = (className: string): Element => {
    const layer = doc.createElementNS(SVG_NS, "g");
    layer.setAttribute("class", className);
    layer.setAttribute("transform", transform);
    return layer;
  };

  // Create annotation layer groups with the SAME transform as graph content
  const groupsLayer = makeLayer(ANNOTATION_GROUPS_LAYER);
  const backgroundShapesLayer = makeLayer(ANNOTATION_SHAPES_LAYER);
  const foregroundShapesLayer = makeLayer(ANNOTATION_SHAPES_LAYER);
  const textLayer = makeLayer(ANNOTATION_TEXT_LAYER);

  // Sort by zIndex (canvas default zIndex is -1 for groups and shapes)
  const sortedGroups = [...groups].sort((a, b) => (a.zIndex ?? -1) - (b.zIndex ?? -1));
  const sortedShapes = [...shapeAnnotations].sort((a, b) => (a.zIndex ?? -1) - (b.zIndex ?? -1));
  const sortedText = [...textAnnotations].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

  // Render groups (in model coordinates - the transform handles scaling)
  for (const group of sortedGroups) {
    const element = parseAndImportElement(doc, parser, groupToSvgString(group));
    if (element) groupsLayer.appendChild(element);
  }

  // Render shapes; negative zIndex renders behind topology nodes on the canvas
  for (const shape of sortedShapes) {
    const element = parseAndImportElement(doc, parser, shapeToSvgString(shape));
    if (!element) continue;
    const layer = (shape.zIndex ?? -1) < 0 ? backgroundShapesLayer : foregroundShapesLayer;
    layer.appendChild(element);
  }

  // Render text annotations, matching the live canvas paragraph-margin behavior
  const marginResetActive = isFreeTextMarginResetActive();
  for (const text of sortedText) {
    const element = parseAndImportElement(doc, parser, textToSvgString(text, marginResetActive));
    if (element) textLayer.appendChild(element);
  }

  // Insert layers in z-order matching the canvas:
  // groups and negative-zIndex shapes behind graph content, the rest in front
  svgEl.insertBefore(backgroundShapesLayer, svgEl.firstChild);
  svgEl.insertBefore(groupsLayer, backgroundShapesLayer);
  svgEl.appendChild(foregroundShapesLayer);
  svgEl.appendChild(textLayer);

  // Calculate annotation bounds (in model coordinates) and expand SVG if needed
  const annotationBounds = calculateAnnotationsBounds(annotations);
  if (annotationBounds.minX !== Infinity) {
    expandSvgBounds(svgEl, annotationBounds, transform);
  }

  return new XMLSerializer().serializeToString(svgEl);
}
