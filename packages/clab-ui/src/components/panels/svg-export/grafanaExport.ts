// Grafana Flow-panel export helpers.
import type { Edge, Node } from "@xyflow/react";

import { TRAFFIC_RATE_NODE_TYPE } from "../../../annotations/annotationNodeConverters";
import { GRAPH_LAYER_CLASS } from "./constants";

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_MIME_TYPE = "image/svg+xml";
const CELL_ID_PREAMBLE = "cell-";
const ANNOTATION_LAYER_CLASSES = new Set([
  "annotation-groups-layer",
  "annotation-shapes-layer",
  "annotation-text-layer"
]);
const DEFAULT_GRAFANA_RATE_LABEL_FONT_SIZE = 10;
const GRAFANA_TRAFFIC_NO_DATA_STROKE = "gray";
const TRAFFIC_RATE_TEXT_REF_WIDTH = 50;
const TRAFFIC_RATE_TEXT_REF_HEIGHT = 30;
const TRAFFIC_RATE_TEXT_MAX_SCALE = 2;
const TRAFFIC_RATE_LABEL_SAMPLE_TEXT = "775.3 Mbit/s";
type TrafficThresholdUnit = "kbit" | "mbit" | "gbit";
type GrafanaTrafficRateMetric = "rx" | "tx" | "combined";

export interface GrafanaEdgeCellMapping {
  edgeId: string;
  source: string;
  sourceEndpoint: string;
  target: string;
  targetEndpoint: string;
  operstateCellId: string;
  targetOperstateCellId: string;
  trafficCellId: string;
  reverseTrafficCellId: string;
}

export interface GrafanaTrafficThresholds {
  green: number;
  yellow: number;
  orange: number;
  red: number;
}

export interface GrafanaTrafficRateLabelPlacement {
  labelCellId: string;
  x: number;
  y: number;
  dataRef: string;
  fontSize?: number;
}

export interface GrafanaPanelYamlOptions {
  trafficThresholds?: GrafanaTrafficThresholds;
  includeHideRatesLegendToggle?: boolean;
  trafficRateLabelPlacements?: GrafanaTrafficRateLabelPlacement[];
}

export interface GrafanaCellIdSvgOptions {
  trafficRatesOnHoverOnly?: boolean;
  trafficRateLabelPlacements?: GrafanaTrafficRateLabelPlacement[];
}

export const DEFAULT_GRAFANA_TRAFFIC_THRESHOLDS: GrafanaTrafficThresholds = {
  green: 199999,
  yellow: 500000,
  orange: 1000000,
  red: 5000000
};

interface GrafanaDashboardTargetConfig {
  datasource: string;
  expr: string;
  legendFormat: string;
  instant: boolean;
  range: boolean;
  hide?: boolean;
}

function getTrafficLabelCellId(trafficCellId: string): string {
  return `${trafficCellId}:label`;
}

const DEFAULT_GRAFANA_TARGETS: GrafanaDashboardTargetConfig[] = [
  {
    datasource: "prometheus",
    expr: "interface_oper_state",
    legendFormat: "oper-state:{{source}}:{{interface_name}}",
    instant: false,
    range: true,
    hide: false
  },
  {
    datasource: "prometheus",
    expr: "interface_traffic_rate_out_bps",
    legendFormat: "{{source}}:{{interface_name}}:out",
    instant: false,
    range: true,
    hide: false
  },
  {
    datasource: "prometheus",
    expr: "interface_traffic_rate_in_bps",
    legendFormat: "{{source}}:{{interface_name}}:in",
    instant: false,
    range: true,
    hide: false
  }
];

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value));
}

function toCellMapping(edge: Edge): GrafanaEdgeCellMapping | null {
  const data = asRecord(edge.data);
  const sourceEndpoint = asString(data.sourceEndpoint);
  const targetEndpoint = asString(data.targetEndpoint);
  if (sourceEndpoint === null || targetEndpoint === null) return null;

  const operstateCellId = `${edge.source}:${sourceEndpoint}`;
  const targetOperstateCellId = `${edge.target}:${targetEndpoint}`;
  const trafficCellId = `link_id:${edge.source}:${sourceEndpoint}:${edge.target}:${targetEndpoint}`;
  const reverseTrafficCellId = `link_id:${edge.target}:${targetEndpoint}:${edge.source}:${sourceEndpoint}`;

  return {
    edgeId: edge.id,
    source: edge.source,
    sourceEndpoint,
    target: edge.target,
    targetEndpoint,
    operstateCellId,
    targetOperstateCellId,
    trafficCellId,
    reverseTrafficCellId
  };
}

function isAnnotationNode(
  nodeId: string,
  nodeTypesById: Map<string, string>,
  annotationNodeTypes: Set<string>
): boolean {
  const nodeType = nodeTypesById.get(nodeId) ?? "";
  return annotationNodeTypes.has(nodeType);
}

export function collectGrafanaEdgeCellMappings(
  edges: Edge[],
  nodes: Node[],
  annotationNodeTypes: Set<string>
): GrafanaEdgeCellMapping[] {
  const nodeTypesById = new Map(nodes.map((node) => [node.id, node.type ?? ""]));
  const seenTraffic = new Set<string>();
  const seenOperstate = new Set<string>();
  const mappings: GrafanaEdgeCellMapping[] = [];

  for (const edge of edges) {
    if (isAnnotationNode(edge.source, nodeTypesById, annotationNodeTypes)) continue;
    if (isAnnotationNode(edge.target, nodeTypesById, annotationNodeTypes)) continue;

    const mapping = toCellMapping(edge);
    if (!mapping) continue;
    if (
      seenTraffic.has(mapping.trafficCellId) ||
      seenTraffic.has(mapping.reverseTrafficCellId) ||
      seenOperstate.has(mapping.operstateCellId) ||
      seenOperstate.has(mapping.targetOperstateCellId)
    ) {
      continue;
    }

    seenTraffic.add(mapping.trafficCellId);
    seenTraffic.add(mapping.reverseTrafficCellId);
    seenOperstate.add(mapping.operstateCellId);
    seenOperstate.add(mapping.targetOperstateCellId);
    mappings.push(mapping);
  }

  return mappings;
}

function asFinitePositiveNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function getNodeDimension(node: Node, key: "width" | "height", fallback: number): number {
  const direct = asFinitePositiveNumber(node[key]);
  if (direct !== null) return direct;
  const fromData = asFinitePositiveNumber(asRecord(node.data)[key]);
  return fromData ?? fallback;
}

function getTrafficRateNodeCenter(node: Node): { x: number; y: number } {
  return {
    x: node.position.x + getNodeDimension(node, "width", 100) / 2,
    y: node.position.y + getNodeDimension(node, "height", 30) / 2
  };
}

function computeTrafficRateTextScale(width: number, height: number): number {
  const widthScale = width / TRAFFIC_RATE_TEXT_REF_WIDTH;
  const heightScale = height / TRAFFIC_RATE_TEXT_REF_HEIGHT;
  const rawScale = Math.min(widthScale, heightScale);
  return Math.max(0.01, Math.min(TRAFFIC_RATE_TEXT_MAX_SCALE, rawScale));
}

function computeFittedTrafficRateTextFontSize(
  text: string,
  width: number,
  height: number,
  baseSize: number
): number {
  const safeText = text.length > 0 ? text : " ";
  const maxWidth = Math.max(1, width - 6);
  const maxHeight = Math.max(1, height - 2);
  const widthBound = maxWidth / (safeText.length * 0.62);
  const heightBound = maxHeight / 1.1;
  return Math.max(0.5, Math.min(baseSize, widthBound, heightBound));
}

function getTrafficRateNodeLabelFontSize(node: Node): number {
  const width = getNodeDimension(node, "width", TRAFFIC_RATE_TEXT_REF_WIDTH);
  const height = getNodeDimension(node, "height", TRAFFIC_RATE_TEXT_REF_HEIGHT);
  const scale = computeTrafficRateTextScale(width, height);
  return computeFittedTrafficRateTextFontSize(
    TRAFFIC_RATE_LABEL_SAMPLE_TEXT,
    width,
    height,
    26 * scale
  );
}

function normalizeTrafficRateTextMetric(value: unknown): GrafanaTrafficRateMetric {
  if (value === "rx" || value === "tx" || value === "combined") return value;
  return "tx";
}

function getTrafficRateDataRef(
  nodeId: string,
  interfaceName: string,
  metric: GrafanaTrafficRateMetric
): string {
  const direction = metric === "rx" ? "in" : "out";
  return `${nodeId}:${interfaceName}:${direction}`;
}

function matchTrafficRateLabelCellId(
  nodeId: string,
  interfaceName: string,
  mapping: GrafanaEdgeCellMapping
): string | null {
  if (mapping.source === nodeId && mapping.sourceEndpoint === interfaceName) {
    return getTrafficLabelCellId(mapping.trafficCellId);
  }
  if (mapping.target === nodeId && mapping.targetEndpoint === interfaceName) {
    return getTrafficLabelCellId(mapping.reverseTrafficCellId);
  }
  return null;
}

export function collectGrafanaTrafficRateLabelPlacements(
  nodes: Node[],
  mappings: GrafanaEdgeCellMapping[]
): GrafanaTrafficRateLabelPlacement[] {
  if (mappings.length === 0) return [];

  const usedLabelCellIds = new Set<string>();
  const placements: GrafanaTrafficRateLabelPlacement[] = [];
  const trafficRateNodes = nodes
    .filter((node) => node.type === TRAFFIC_RATE_NODE_TYPE)
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const node of trafficRateNodes) {
    const data = asRecord(node.data);
    const nodeId = asString(data.nodeId);
    const interfaceName = asString(data.interfaceName);
    if (nodeId === null || interfaceName === null) continue;

    for (const mapping of mappings) {
      const labelCellId = matchTrafficRateLabelCellId(nodeId, interfaceName, mapping);
      if (labelCellId === null || usedLabelCellIds.has(labelCellId)) continue;

      const center = getTrafficRateNodeCenter(node);
      usedLabelCellIds.add(labelCellId);
      placements.push({
        labelCellId,
        x: center.x,
        y: center.y,
        dataRef: getTrafficRateDataRef(
          nodeId,
          interfaceName,
          normalizeTrafficRateTextMetric(data.textMetric)
        ),
        fontSize: getTrafficRateNodeLabelFontSize(node)
      });
      break;
    }
  }

  return placements;
}

export function collectLinkedNodeIds(
  edges: Edge[],
  nodes: Node[],
  annotationNodeTypes: Set<string>
): Set<string> {
  const nodeTypesById = new Map(nodes.map((node) => [node.id, node.type ?? ""]));
  const linkedNodeIds = new Set<string>();

  for (const edge of edges) {
    if (!nodeTypesById.has(edge.source) || !nodeTypesById.has(edge.target)) continue;
    if (isAnnotationNode(edge.source, nodeTypesById, annotationNodeTypes)) continue;
    if (isAnnotationNode(edge.target, nodeTypesById, annotationNodeTypes)) continue;

    linkedNodeIds.add(edge.source);
    linkedNodeIds.add(edge.target);
  }

  return linkedNodeIds;
}

interface GraphTransform {
  tx: number;
  ty: number;
  scale: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function createBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
}

function includeBoundsPoint(bounds: Bounds, x: number, y: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function includeBoundsRect(
  bounds: Bounds,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  includeBoundsPoint(bounds, x, y);
  includeBoundsPoint(bounds, x + width, y + height);
}

function hasBounds(bounds: Bounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    bounds.maxX > bounds.minX &&
    bounds.maxY > bounds.minY
  );
}

function applyGraphTransform(
  transform: GraphTransform,
  x: number,
  y: number
): { x: number; y: number } {
  return {
    x: x * transform.scale + transform.tx,
    y: y * transform.scale + transform.ty
  };
}

function parseNumericAttr(el: Element, attrName: string): number | null {
  const raw = el.getAttribute(attrName);
  if (raw === null || raw.length === 0) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function isAnnotationLayer(element: Element): boolean {
  const classes = (element.getAttribute("class") ?? "").split(/\s+/);
  return classes.some((className) => ANNOTATION_LAYER_CLASSES.has(className));
}

function findGraphTransformGroup(svgEl: Element): Element | null {
  const explicitGraphLayer = svgEl.querySelector(`g.${GRAPH_LAYER_CLASS}[transform]`);
  if (explicitGraphLayer instanceof Element) return explicitGraphLayer;

  for (const group of Array.from(svgEl.querySelectorAll("g[transform]"))) {
    if (isAnnotationLayer(group)) continue;
    if (group.querySelector("g.export-node, g.export-edge") !== null) return group;
  }

  return null;
}

function parseTransformArgs(rawArgs: string): number[] {
  return rawArgs
    .split(/[,\s]+/)
    .map((part) => Number.parseFloat(part))
    .filter((value) => Number.isFinite(value));
}

function parseTransformString(transformAttr: string): GraphTransform {
  let tx = 0;
  let ty = 0;
  let scale = 1;

  const translateRegex = /translate\(\s*([^)]+?)\s*\)/gi;
  let translateMatch: RegExpExecArray | null;
  while ((translateMatch = translateRegex.exec(transformAttr)) !== null) {
    const args = parseTransformArgs(translateMatch[1]);
    tx += args[0] ?? 0;
    ty += args[1] ?? 0;
  }

  const scaleMatch = /scale\(\s*([^)]+?)\s*\)/i.exec(transformAttr);
  if (scaleMatch !== null) {
    const scaleArgs = parseTransformArgs(scaleMatch[1]);
    scale = scaleArgs[0] ?? 1;
  }

  return {
    tx: Number.isFinite(tx) ? tx : 0,
    ty: Number.isFinite(ty) ? ty : 0,
    scale: Number.isFinite(scale) && scale !== 0 ? scale : 1
  };
}

function parseGraphTransform(svgEl: Element): GraphTransform {
  const transformedRoot = findGraphTransformGroup(svgEl);
  return parseTransformString(transformedRoot?.getAttribute("transform") ?? "");
}

function formatTransform(transform: GraphTransform): string {
  return `translate(${formatTransformNumber(transform.tx)}, ${formatTransformNumber(transform.ty)}) scale(${formatTransformNumber(transform.scale)})`;
}

function formatTransformNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function getCanvasTransformGroups(svgEl: Element, graphLayer: Element): Element[] {
  const groups = new Set<Element>([graphLayer]);
  for (const className of ANNOTATION_LAYER_CLASSES) {
    for (const layer of Array.from(svgEl.querySelectorAll(`g.${className}[transform]`))) {
      groups.add(layer);
    }
  }
  return Array.from(groups);
}

function normalizeCanvasLayerTransforms(
  svgEl: Element,
  graphLayer: Element,
  minX: number,
  minY: number
): void {
  for (const layer of getCanvasTransformGroups(svgEl, graphLayer)) {
    const layerTransform = parseTransformString(layer.getAttribute("transform") ?? "");
    layerTransform.tx -= minX;
    layerTransform.ty -= minY;
    layer.setAttribute("transform", formatTransform(layerTransform));
  }
}

function includePathBounds(bounds: Bounds, transform: GraphTransform, pathData: string): void {
  const numberMatches = pathData.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  if (numberMatches.length < 2) return;
  const points = numberMatches
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));

  for (let i = 0; i + 1 < points.length; i += 2) {
    const p = applyGraphTransform(transform, points[i], points[i + 1]);
    includeBoundsPoint(bounds, p.x, p.y);
  }
}

function includeNodeRectBounds(doc: XMLDocument, bounds: Bounds, transform: GraphTransform): void {
  for (const rect of Array.from(doc.querySelectorAll("g.export-node rect[x][y][width][height]"))) {
    const x = parseNumericAttr(rect, "x");
    const y = parseNumericAttr(rect, "y");
    const width = parseNumericAttr(rect, "width");
    const height = parseNumericAttr(rect, "height");
    if (x === null || y === null || width === null || height === null) continue;

    const p = applyGraphTransform(transform, x, y);
    includeBoundsRect(bounds, p.x, p.y, width * transform.scale, height * transform.scale);
  }
}

function includeEdgeCircleBounds(
  doc: XMLDocument,
  bounds: Bounds,
  transform: GraphTransform
): void {
  for (const circle of Array.from(doc.querySelectorAll("g.export-edge circle[cx][cy][r]"))) {
    const cx = parseNumericAttr(circle, "cx");
    const cy = parseNumericAttr(circle, "cy");
    const r = parseNumericAttr(circle, "r");
    if (cx === null || cy === null || r === null) continue;

    const p = applyGraphTransform(transform, cx, cy);
    const radius = Math.abs(r * transform.scale);
    includeBoundsRect(bounds, p.x - radius, p.y - radius, radius * 2, radius * 2);
  }
}

function includeEdgePathBounds(doc: XMLDocument, bounds: Bounds, transform: GraphTransform): void {
  for (const edgePath of Array.from(doc.querySelectorAll("g.export-edge path[d]"))) {
    const pathData = edgePath.getAttribute("d");
    if (pathData === null || pathData.length === 0) continue;
    includePathBounds(bounds, transform, pathData);
  }
}

const ROTATE_TRANSFORM_REGEX =
  /rotate\(\s*([-\d.]+)(?:\s*[, ]\s*([-\d.]+)\s*[, ]\s*([-\d.]+))?\s*\)/;

function parseRotation(element: Element | null): { angle: number; cx: number; cy: number } | null {
  const transformAttr = element?.getAttribute("transform") ?? "";
  const match = ROTATE_TRANSFORM_REGEX.exec(transformAttr);
  if (!match) return null;
  const angle = Number.parseFloat(match[1]);
  if (!Number.isFinite(angle) || angle === 0) return null;
  return {
    angle,
    cx: Number.parseFloat(match[2] ?? "0") || 0,
    cy: Number.parseFloat(match[3] ?? "0") || 0
  };
}

/** Include a model-space rect (optionally rotated around a center) in bounds. */
function includeModelRectBounds(
  bounds: Bounds,
  transform: GraphTransform,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: { angle: number; cx: number; cy: number } | null
): void {
  const corners: Array<[number, number]> = [
    [x, y],
    [x + width, y],
    [x, y + height],
    [x + width, y + height]
  ];
  const radians = rotation ? (rotation.angle * Math.PI) / 180 : 0;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  for (const [cornerX, cornerY] of corners) {
    let modelX = cornerX;
    let modelY = cornerY;
    if (rotation) {
      const dx = cornerX - rotation.cx;
      const dy = cornerY - rotation.cy;
      modelX = rotation.cx + dx * cos - dy * sin;
      modelY = rotation.cy + dx * sin + dy * cos;
    }
    const p = applyGraphTransform(transform, modelX, modelY);
    includeBoundsPoint(bounds, p.x, p.y);
  }
}

/** Parse a rect-like element's model box from four numeric attributes. */
function parseModelBox(
  element: Element,
  attrNames: [string, string, string, string]
): { x: number; y: number; width: number; height: number } | null {
  const values = attrNames.map((name) => parseNumericAttr(element, name));
  if (values.some((value) => value === null)) return null;
  const [a, b, c, d] = values as [number, number, number, number];
  return attrNames[0] === "cx"
    ? { x: a - c, y: b - d, width: c * 2, height: d * 2 }
    : { x: a, y: b, width: c, height: d };
}

function includeAnnotationBoxBounds(
  doc: XMLDocument,
  bounds: Bounds,
  transform: GraphTransform,
  selector: string,
  attrNames: [string, string, string, string]
): void {
  for (const element of Array.from(doc.querySelectorAll(selector))) {
    const box = parseModelBox(element, attrNames);
    if (!box) continue;
    includeModelRectBounds(
      bounds,
      transform,
      box.x,
      box.y,
      box.width,
      box.height,
      parseRotation(element.parentElement)
    );
  }
}

function includeAnnotationLineBounds(
  doc: XMLDocument,
  bounds: Bounds,
  transform: GraphTransform
): void {
  for (const line of Array.from(doc.querySelectorAll("g.annotation-shape line"))) {
    const x1 = parseNumericAttr(line, "x1");
    const y1 = parseNumericAttr(line, "y1");
    const x2 = parseNumericAttr(line, "x2");
    const y2 = parseNumericAttr(line, "y2");
    if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
    const p1 = applyGraphTransform(transform, x1, y1);
    const p2 = applyGraphTransform(transform, x2, y2);
    includeBoundsPoint(bounds, p1.x, p1.y);
    includeBoundsPoint(bounds, p2.x, p2.y);
  }
}

function includeGroupLabelBounds(
  doc: XMLDocument,
  bounds: Bounds,
  transform: GraphTransform
): void {
  // Group labels can sit outside the group rectangle (e.g. top: -20)
  for (const label of Array.from(doc.querySelectorAll("g.annotation-group text"))) {
    const x = parseNumericAttr(label, "x");
    const y = parseNumericAttr(label, "y");
    if (x === null || y === null) continue;
    const fontSize = parseNumericAttr(label, "font-size") ?? 12;
    const p = applyGraphTransform(transform, x, y - fontSize);
    includeBoundsPoint(bounds, p.x, p.y);
  }
}

/**
 * Include annotation layers (group/shape rectangles, ellipses, lines, free
 * text) in bounds so trimming never crops them. Annotation layers share the
 * graph layer's transform, so the same mapping applies.
 */
function includeAnnotationBounds(
  doc: XMLDocument,
  bounds: Bounds,
  transform: GraphTransform
): void {
  includeAnnotationBoxBounds(
    doc,
    bounds,
    transform,
    "g.annotation-group rect, g.annotation-shape rect",
    ["x", "y", "width", "height"]
  );
  includeAnnotationBoxBounds(doc, bounds, transform, "g.annotation-shape ellipse", [
    "cx",
    "cy",
    "rx",
    "ry"
  ]);
  includeAnnotationBoxBounds(doc, bounds, transform, "g.annotation-text foreignObject", [
    "x",
    "y",
    "width",
    "height"
  ]);
  includeAnnotationLineBounds(doc, bounds, transform);
  includeGroupLabelBounds(doc, bounds, transform);
}

export function trimGrafanaSvgToTopologyContent(svgContent: string, padding = 12): string {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return svgContent;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, SVG_MIME_TYPE);
  const svgEl = doc.documentElement;
  const graphLayer = findGraphTransformGroup(svgEl);
  const transform = parseGraphTransform(svgEl);
  const bounds = createBounds();

  includeNodeRectBounds(doc, bounds, transform);
  includeEdgeCircleBounds(doc, bounds, transform);
  includeEdgePathBounds(doc, bounds, transform);
  includeAnnotationBounds(doc, bounds, transform);

  if (!hasBounds(bounds)) return svgContent;

  const safePadding = Math.max(0, padding);
  const minX = bounds.minX - safePadding;
  const minY = bounds.minY - safePadding;
  const width = Math.max(1, bounds.maxX - bounds.minX + safePadding * 2);
  const height = Math.max(1, bounds.maxY - bounds.minY + safePadding * 2);

  if (graphLayer !== null) {
    normalizeCanvasLayerTransforms(svgEl, graphLayer, minX, minY);
    svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
  } else {
    svgEl.setAttribute("viewBox", `${minX} ${minY} ${width} ${height}`);
  }
  svgEl.setAttribute("width", Number(width.toFixed(3)).toString());
  svgEl.setAttribute("height", Number(height.toFixed(3)).toString());

  return new XMLSerializer().serializeToString(svgEl);
}

function getTrafficThresholdUnitLabel(unit: TrafficThresholdUnit): string {
  switch (unit) {
    case "kbit":
      return "Kbps";
    case "gbit":
      return "Gbps";
    default:
      return "Mbps";
  }
}

function getTrafficThresholdUnitDivisor(unit: TrafficThresholdUnit): number {
  switch (unit) {
    case "kbit":
      return 1_000;
    case "gbit":
      return 1_000_000_000;
    default:
      return 1_000_000;
  }
}

function formatTrafficUnit(valueBps: number, unit: TrafficThresholdUnit): string {
  const divisor = getTrafficThresholdUnitDivisor(unit);
  const scaled = Math.max(0, valueBps) / divisor;
  if (scaled === 0) return "0";

  const precision = scaled < 1 ? 2 : 1;
  return scaled
    .toFixed(precision)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*[1-9])0+$/, "$1");
}

function createLegendTextRows(
  thresholds: GrafanaTrafficThresholds,
  trafficThresholdUnit: TrafficThresholdUnit
): Array<{ color: string; text: string }> {
  const green = formatTrafficUnit(thresholds.green, trafficThresholdUnit);
  const yellow = formatTrafficUnit(thresholds.yellow, trafficThresholdUnit);
  const orange = formatTrafficUnit(thresholds.orange, trafficThresholdUnit);
  const red = formatTrafficUnit(thresholds.red, trafficThresholdUnit);
  const unitLabel = getTrafficThresholdUnitLabel(trafficThresholdUnit);

  return [
    { color: "#b8c4d3", text: `0 - ${green} ${unitLabel}` },
    { color: "#5fe15c", text: `${green} - ${yellow} ${unitLabel}` },
    { color: "#ffe24a", text: `${yellow} - ${orange} ${unitLabel}` },
    { color: "#ff9f1a", text: `${orange} - ${red} ${unitLabel}` },
    { color: "#ff4f6b", text: `${red}+ ${unitLabel}` }
  ];
}

function parseViewBox(svgEl: Element): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const viewBoxAttr = svgEl.getAttribute("viewBox");
  if (viewBoxAttr !== null && viewBoxAttr.length > 0) {
    const parts = viewBoxAttr
      .split(/[ ,]+/)
      .map((part) => Number.parseFloat(part))
      .filter((part) => Number.isFinite(part));
    if (parts.length === 4) {
      return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
    }
  }

  const width = Number.parseFloat(svgEl.getAttribute("width") ?? "1");
  const height = Number.parseFloat(svgEl.getAttribute("height") ?? "1");
  return {
    x: 0,
    y: 0,
    width: Number.isFinite(width) && width > 0 ? width : 1,
    height: Number.isFinite(height) && height > 0 ? height : 1
  };
}

interface LegendBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsIntersect(a: LegendBox, b: LegendBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Rects (in viewBox coordinates) the legend must not cover: node icons and
 * their label pills, plus free-text annotations.
 */
function collectLegendObstacles(doc: XMLDocument, transform: GraphTransform): LegendBox[] {
  const obstacles: LegendBox[] = [];

  for (const rect of Array.from(doc.querySelectorAll("g.export-node rect[x][y][width][height]"))) {
    const x = parseNumericAttr(rect, "x");
    const y = parseNumericAttr(rect, "y");
    const width = parseNumericAttr(rect, "width");
    const height = parseNumericAttr(rect, "height");
    if (x === null || y === null || width === null || height === null) continue;
    const p = applyGraphTransform(transform, x, y);
    obstacles.push({
      x: p.x,
      y: p.y,
      width: width * transform.scale,
      height: height * transform.scale
    });
  }

  for (const foreignObject of Array.from(doc.querySelectorAll("g.annotation-text foreignObject"))) {
    const x = parseNumericAttr(foreignObject, "x");
    const y = parseNumericAttr(foreignObject, "y");
    const width = parseNumericAttr(foreignObject, "width");
    const height = parseNumericAttr(foreignObject, "height");
    if (x === null || y === null || width === null || height === null) continue;
    const p = applyGraphTransform(transform, x, y);
    obstacles.push({
      x: p.x,
      y: p.y,
      width: width * transform.scale,
      height: height * transform.scale
    });
  }

  return obstacles;
}

/**
 * Pick a legend origin that does not cover any obstacle: try the four viewBox
 * corners (top-left preferred); when everything is occupied, expand the
 * viewBox upward and place the legend in the newly created empty strip.
 */
function resolveLegendPlacement(
  svgEl: Element,
  viewBox: { x: number; y: number; width: number; height: number },
  legendSize: { width: number; height: number },
  obstacles: LegendBox[],
  margin: number
): { x: number; y: number } {
  const corners = [
    { x: viewBox.x + margin, y: viewBox.y + margin },
    { x: viewBox.x + viewBox.width - margin - legendSize.width, y: viewBox.y + margin },
    { x: viewBox.x + margin, y: viewBox.y + viewBox.height - margin - legendSize.height },
    {
      x: viewBox.x + viewBox.width - margin - legendSize.width,
      y: viewBox.y + viewBox.height - margin - legendSize.height
    }
  ];

  for (const corner of corners) {
    const candidate: LegendBox = { ...corner, ...legendSize };
    if (
      candidate.x < viewBox.x ||
      candidate.y < viewBox.y ||
      candidate.x + candidate.width > viewBox.x + viewBox.width ||
      candidate.y + candidate.height > viewBox.y + viewBox.height
    ) {
      continue;
    }
    if (!obstacles.some((obstacle) => rectsIntersect(candidate, obstacle))) {
      return corner;
    }
  }

  // No free corner: grow the viewBox upward and use the new empty strip.
  const expansion = legendSize.height + margin * 2;
  const newY = viewBox.y - expansion;
  const newHeight = viewBox.height + expansion;
  svgEl.setAttribute(
    "viewBox",
    `${fmt(viewBox.x)} ${fmt(newY)} ${fmt(viewBox.width)} ${fmt(newHeight)}`
  );
  const heightAttr = Number.parseFloat(svgEl.getAttribute("height") ?? "");
  const widthAttr = Number.parseFloat(svgEl.getAttribute("width") ?? "");
  if (Number.isFinite(heightAttr) && Number.isFinite(widthAttr) && viewBox.height > 0) {
    svgEl.setAttribute(
      "height",
      Number((heightAttr * (newHeight / viewBox.height)).toFixed(3)).toString()
    );
  }
  return { x: viewBox.x + margin, y: newY + margin };
}

export function addGrafanaTrafficLegend(
  svgContent: string,
  trafficThresholds: GrafanaTrafficThresholds,
  trafficThresholdUnit: TrafficThresholdUnit = "mbit"
): string {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return svgContent;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, SVG_MIME_TYPE);
  const svgEl = doc.documentElement;
  const legendRows = createLegendTextRows(trafficThresholds, trafficThresholdUnit);
  const viewBox = parseViewBox(svgEl);
  const transform = parseGraphTransform(svgEl);
  const legendScale = Math.max(0.1, Math.abs(transform.scale));

  const legendGroup = doc.createElementNS(SVG_NS, "g");
  legendGroup.setAttribute("class", "grafana-traffic-legend");
  legendGroup.setAttribute("opacity", "0.95");

  const rowHeight = 16 * legendScale;
  const fontSize = 11 * legendScale;
  const bulletRadius = 4 * legendScale;
  const maxTextChars = Math.max(...legendRows.map((row) => row.text.length));
  const legendSize = {
    width: bulletRadius + 10 * legendScale + maxTextChars * fontSize * 0.62,
    height: legendRows.length * rowHeight
  };
  const margin = 10 * legendScale;
  const obstacles = collectLegendObstacles(doc, transform);
  const origin = resolveLegendPlacement(svgEl, viewBox, legendSize, obstacles, margin);

  // Rows are drawn around the bullet center: offset from the legend box origin
  const startX = origin.x + bulletRadius;
  const startY = origin.y + rowHeight / 2;

  for (let i = 0; i < legendRows.length; i++) {
    const row = legendRows[i];
    const rowGroup = doc.createElementNS(SVG_NS, "g");
    rowGroup.setAttribute("transform", `translate(${startX} ${startY + i * rowHeight})`);

    const bullet = doc.createElementNS(SVG_NS, "circle");
    bullet.setAttribute("cx", "0");
    bullet.setAttribute("cy", "0");
    bullet.setAttribute("r", `${4 * legendScale}`);
    bullet.setAttribute("fill", row.color);
    rowGroup.appendChild(bullet);

    const text = doc.createElementNS(SVG_NS, "text");
    text.setAttribute("x", `${10 * legendScale}`);
    text.setAttribute("y", "0");
    text.setAttribute("dy", "0.35em");
    text.setAttribute("font-size", `${11 * legendScale}`);
    text.setAttribute("font-family", "Helvetica, Arial, sans-serif");
    text.setAttribute("font-weight", "500");
    text.setAttribute("fill", "#e7edf7");
    text.setAttribute("stroke", "rgba(0, 0, 0, 0.65)");
    text.setAttribute("stroke-width", `${0.45 * legendScale}`);
    text.setAttribute("paint-order", "stroke");
    text.textContent = row.text;
    rowGroup.appendChild(text);

    legendGroup.appendChild(rowGroup);
  }

  svgEl.appendChild(legendGroup);
  return new XMLSerializer().serializeToString(svgEl);
}

export function makeGrafanaSvgResponsive(svgContent: string): string {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return svgContent;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, SVG_MIME_TYPE);
  const svgEl = doc.documentElement;

  svgEl.setAttribute("width", "100%");
  svgEl.setAttribute("height", "100%");
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");

  return new XMLSerializer().serializeToString(svgEl);
}

function setCellIdAttributes(element: Element, shortCellId: string): void {
  element.setAttribute("id", `${CELL_ID_PREAMBLE}${shortCellId}`);
  element.setAttribute("data-cell-id", shortCellId);
}

function removeInlineStyleProperty(element: Element, propertyName: string): void {
  const style = element.getAttribute("style");
  if (style === null || style.length === 0) return;

  const propertyPattern = new RegExp(`^\\s*${propertyName}\\s*:`, "i");
  const remainingDeclarations = style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.length > 0 && !propertyPattern.test(declaration));

  if (remainingDeclarations.length === 0) {
    element.removeAttribute("style");
    return;
  }

  element.setAttribute("style", remainingDeclarations.join("; "));
}

function setGrafanaTrafficNoDataStroke(element: Element): void {
  element.setAttribute("stroke", GRAFANA_TRAFFIC_NO_DATA_STROKE);
  removeInlineStyleProperty(element, "stroke");
}

function parsePathStart(pathData: string | null): { x: number; y: number } | null {
  if (pathData === null || pathData.length === 0) return null;
  const trimmed = pathData.trim();
  if (trimmed.length === 0) return null;
  const command = trimmed[0];
  if (command !== "M" && command !== "m") return null;

  const remainder = trimmed.slice(1).replaceAll(",", " ").trim();
  const parts = remainder.split(" ").filter((part) => part.length > 0);
  if (parts.length < 2) return null;

  const x = Number.parseFloat(parts[0]);
  const y = Number.parseFloat(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function createFallbackOperstateMarker(doc: XMLDocument, sourceGroup: Element): SVGElement {
  const firstPath = sourceGroup.querySelector("path");
  const startPoint = parsePathStart(firstPath?.getAttribute("d") ?? null);
  const marker = doc.createElementNS(SVG_NS, "rect");
  const markerX = startPoint ? startPoint.x - 3 : 0;
  const markerY = startPoint ? startPoint.y - 3 : 0;
  marker.setAttribute("x", markerX.toString());
  marker.setAttribute("y", markerY.toString());
  marker.setAttribute("width", "6");
  marker.setAttribute("height", "6");
  marker.setAttribute("rx", "1");
  marker.setAttribute("ry", "1");
  marker.setAttribute("fill", "transparent");
  marker.setAttribute("stroke", "none");
  return marker;
}

function createOperstateCellGroup(
  doc: XMLDocument,
  sourceGroup: Element,
  shortCellId: string
): Element {
  const operstateGroup = doc.createElementNS(SVG_NS, "g");
  operstateGroup.setAttribute("class", "export-edge grafana-operstate-cell");
  setCellIdAttributes(operstateGroup, shortCellId);
  operstateGroup.appendChild(createFallbackOperstateMarker(doc, sourceGroup));

  return operstateGroup;
}

function resolveTrafficCellElement(edgeGroup: Element): Element {
  const directPath = Array.from(edgeGroup.children).find(
    (child) => child.tagName.toLowerCase() === "path"
  );
  if (directPath) return directPath;

  const nestedPath = edgeGroup.querySelector("path");
  if (nestedPath) return nestedPath;

  return edgeGroup;
}

interface Point {
  x: number;
  y: number;
}

function lerp(a: Point, b: Point, t = 0.5): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

function fmt(n: number): string {
  return Number(n.toFixed(3)).toString();
}

type ParsedPathCommand =
  | { sx: number; sy: number; command: "L"; args: [number, number] }
  | {
      sx: number;
      sy: number;
      command: "Q";
      args: [number, number, number, number];
    }
  | {
      sx: number;
      sy: number;
      command: "C";
      args: [number, number, number, number, number, number];
    };

function parseNumericPathArgs(
  tokens: string[],
  startIndex: number,
  count: number
): number[] | null {
  const args: number[] = [];
  for (let i = 0; i < count; i++) {
    const value = Number.parseFloat(tokens[startIndex + i] ?? "");
    if (!Number.isFinite(value)) return null;
    args.push(value);
  }
  return args;
}

function parsePathCommand(pathData: string): ParsedPathCommand | null {
  const tokens = pathData.match(/[A-Za-z]|[-+]?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!tokens || tokens.length < 6) return null;
  if (tokens[0]?.toUpperCase() !== "M") return null;

  const sx = Number.parseFloat(tokens[1]);
  const sy = Number.parseFloat(tokens[2]);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;

  switch (tokens[3]?.toUpperCase()) {
    case "L": {
      const args = parseNumericPathArgs(tokens, 4, 2);
      if (!args) return null;
      return { sx, sy, command: "L", args: [args[0], args[1]] };
    }
    case "Q": {
      const args = parseNumericPathArgs(tokens, 4, 4);
      if (!args) return null;
      return { sx, sy, command: "Q", args: [args[0], args[1], args[2], args[3]] };
    }
    case "C": {
      const args = parseNumericPathArgs(tokens, 4, 6);
      if (!args) return null;
      return {
        sx,
        sy,
        command: "C",
        args: [args[0], args[1], args[2], args[3], args[4], args[5]]
      };
    }
    default:
      return null;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function pointForLinePathAtT(sx: number, sy: number, args: [number, number], t: number): Point {
  const [tx, ty] = args;
  const clampedT = clamp01(t);
  return {
    x: sx + (tx - sx) * clampedT,
    y: sy + (ty - sy) * clampedT
  };
}

function pointForQuadraticPathAtT(
  sx: number,
  sy: number,
  args: [number, number, number, number],
  t: number
): Point {
  const [cx, cy, tx, ty] = args;
  const clampedT = clamp01(t);
  const oneMinusT = 1 - clampedT;
  return {
    x: oneMinusT * oneMinusT * sx + 2 * oneMinusT * clampedT * cx + clampedT * clampedT * tx,
    y: oneMinusT * oneMinusT * sy + 2 * oneMinusT * clampedT * cy + clampedT * clampedT * ty
  };
}

function pointForCubicPathAtT(
  sx: number,
  sy: number,
  args: [number, number, number, number, number, number],
  t: number
): Point {
  const [c1x, c1y, c2x, c2y, tx, ty] = args;
  const clampedT = clamp01(t);
  const oneMinusT = 1 - clampedT;
  return {
    x:
      oneMinusT * oneMinusT * oneMinusT * sx +
      3 * oneMinusT * oneMinusT * clampedT * c1x +
      3 * oneMinusT * clampedT * clampedT * c2x +
      clampedT * clampedT * clampedT * tx,
    y:
      oneMinusT * oneMinusT * oneMinusT * sy +
      3 * oneMinusT * oneMinusT * clampedT * c1y +
      3 * oneMinusT * clampedT * clampedT * c2y +
      clampedT * clampedT * clampedT * ty
  };
}

function pointOnParsedPathAtT(parsed: ParsedPathCommand, t: number): Point {
  switch (parsed.command) {
    case "L":
      return pointForLinePathAtT(parsed.sx, parsed.sy, parsed.args, t);
    case "Q":
      return pointForQuadraticPathAtT(parsed.sx, parsed.sy, parsed.args, t);
    case "C":
      return pointForCubicPathAtT(parsed.sx, parsed.sy, parsed.args, t);
  }
}

function normalizeVector(x: number, y: number): Point {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length < 0.0001) {
    return { x: 1, y: 0 };
  }
  return { x: x / length, y: y / length };
}

function tangentForLinePath(args: [number, number], sx: number, sy: number): Point {
  const [tx, ty] = args;
  return normalizeVector(tx - sx, ty - sy);
}

function tangentForQuadraticPath(
  args: [number, number, number, number],
  sx: number,
  sy: number,
  t: number
): Point {
  const [cx, cy, tx, ty] = args;
  const clampedT = clamp01(t);
  const dx = 2 * (1 - clampedT) * (cx - sx) + 2 * clampedT * (tx - cx);
  const dy = 2 * (1 - clampedT) * (cy - sy) + 2 * clampedT * (ty - cy);
  return normalizeVector(dx, dy);
}

function tangentForCubicPath(
  args: [number, number, number, number, number, number],
  sx: number,
  sy: number,
  t: number
): Point {
  const [c1x, c1y, c2x, c2y, tx, ty] = args;
  const clampedT = clamp01(t);
  const oneMinusT = 1 - clampedT;
  const dx =
    3 * oneMinusT * oneMinusT * (c1x - sx) +
    6 * oneMinusT * clampedT * (c2x - c1x) +
    3 * clampedT * clampedT * (tx - c2x);
  const dy =
    3 * oneMinusT * oneMinusT * (c1y - sy) +
    6 * oneMinusT * clampedT * (c2y - c1y) +
    3 * clampedT * clampedT * (ty - c2y);
  return normalizeVector(dx, dy);
}

function tangentOnParsedPathAtT(parsed: ParsedPathCommand, t: number): Point {
  switch (parsed.command) {
    case "L":
      return tangentForLinePath(parsed.args, parsed.sx, parsed.sy);
    case "Q":
      return tangentForQuadraticPath(parsed.args, parsed.sx, parsed.sy, t);
    case "C":
      return tangentForCubicPath(parsed.args, parsed.sx, parsed.sy, t);
  }
}

function splitLinePath(
  sx: number,
  sy: number,
  args: [number, number]
): { first: string; second: string } {
  const [tx, ty] = args;
  const p0 = { x: sx, y: sy };
  const p1 = { x: tx, y: ty };
  const m = lerp(p0, p1);
  return {
    first: `M ${fmt(p0.x)} ${fmt(p0.y)} L ${fmt(m.x)} ${fmt(m.y)}`,
    second: `M ${fmt(m.x)} ${fmt(m.y)} L ${fmt(p1.x)} ${fmt(p1.y)}`
  };
}

function splitQuadraticPath(
  sx: number,
  sy: number,
  args: [number, number, number, number]
): { first: string; second: string } {
  const [cx, cy, tx, ty] = args;
  const p0 = { x: sx, y: sy };
  const p1 = { x: cx, y: cy };
  const p2 = { x: tx, y: ty };
  const p01 = lerp(p0, p1);
  const p12 = lerp(p1, p2);
  const mid = lerp(p01, p12);
  return {
    first: `M ${fmt(p0.x)} ${fmt(p0.y)} Q ${fmt(p01.x)} ${fmt(p01.y)} ${fmt(mid.x)} ${fmt(mid.y)}`,
    second: `M ${fmt(mid.x)} ${fmt(mid.y)} Q ${fmt(p12.x)} ${fmt(p12.y)} ${fmt(p2.x)} ${fmt(p2.y)}`
  };
}

function splitCubicPath(
  sx: number,
  sy: number,
  args: [number, number, number, number, number, number]
): { first: string; second: string } {
  const [c1x, c1y, c2x, c2y, tx, ty] = args;
  const p0 = { x: sx, y: sy };
  const p1 = { x: c1x, y: c1y };
  const p2 = { x: c2x, y: c2y };
  const p3 = { x: tx, y: ty };
  const p01 = lerp(p0, p1);
  const p12 = lerp(p1, p2);
  const p23 = lerp(p2, p3);
  const p012 = lerp(p01, p12);
  const p123 = lerp(p12, p23);
  const mid = lerp(p012, p123);
  return {
    first:
      `M ${fmt(p0.x)} ${fmt(p0.y)} C ${fmt(p01.x)} ${fmt(p01.y)} ${fmt(p012.x)} ${fmt(p012.y)} ` +
      `${fmt(mid.x)} ${fmt(mid.y)}`,
    second:
      `M ${fmt(mid.x)} ${fmt(mid.y)} C ${fmt(p123.x)} ${fmt(p123.y)} ${fmt(p23.x)} ${fmt(p23.y)} ` +
      `${fmt(p3.x)} ${fmt(p3.y)}`
  };
}

function splitPathIntoHalves(pathData: string): { first: string; second: string } | null {
  const parsed = parsePathCommand(pathData);
  if (!parsed) return null;
  switch (parsed.command) {
    case "L":
      return splitLinePath(parsed.sx, parsed.sy, parsed.args);
    case "Q":
      return splitQuadraticPath(parsed.sx, parsed.sy, parsed.args);
    case "C":
      return splitCubicPath(parsed.sx, parsed.sy, parsed.args);
  }
}

function estimateParsedPathLength(parsed: ParsedPathCommand): number {
  switch (parsed.command) {
    case "L": {
      const [tx, ty] = parsed.args;
      return Math.hypot(tx - parsed.sx, ty - parsed.sy);
    }
    case "Q": {
      const [cx, cy, tx, ty] = parsed.args;
      return Math.hypot(cx - parsed.sx, cy - parsed.sy) + Math.hypot(tx - cx, ty - cy);
    }
    case "C": {
      const [c1x, c1y, c2x, c2y, tx, ty] = parsed.args;
      return (
        Math.hypot(c1x - parsed.sx, c1y - parsed.sy) +
        Math.hypot(c2x - c1x, c2y - c1y) +
        Math.hypot(tx - c2x, ty - c2y)
      );
    }
  }
}

function buildTrafficLabelCandidateTs(
  interfaceSide: "start" | "end",
  pathLength: number,
  graphScale: number
): number[] {
  const safeScale = Math.max(0.05, Math.abs(graphScale));
  const alongStepPx = 20 / safeScale;
  const stepT = Math.min(0.22, Math.max(0.06, alongStepPx / Math.max(1, pathLength)));
  // Prefer labels away from the shared midpoint area in dense fanouts.
  const baseT = interfaceSide === "start" ? 0.38 : 0.62;
  const offsets = [
    0,
    stepT,
    -stepT,
    stepT * 2,
    -stepT * 2,
    stepT * 3,
    -stepT * 3,
    stepT * 4,
    -stepT * 4
  ];

  const candidates: number[] = [];
  const seen = new Set<string>();
  for (const offset of offsets) {
    const candidateT = clamp01(baseT + offset);
    if (candidateT < 0.08 || candidateT > 0.92) continue;
    const key = candidateT.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidateT);
  }
  return candidates;
}

function buildExpandedTrafficLabelCandidateTs(interfaceSide: "start" | "end"): number[] {
  const minT = 0.08;
  const maxT = 0.92;
  const sampleCount = 81;
  const preferredT = interfaceSide === "start" ? 0.38 : 0.62;
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const ratio = index / (sampleCount - 1);
    return minT + (maxT - minT) * ratio;
  });
  samples.sort((a, b) => Math.abs(a - preferredT) - Math.abs(b - preferredT));
  return samples;
}

function getTrafficLabelCollisionThresholds(graphScale: number): { minDx: number; minDy: number } {
  const safeScale = Math.max(0.05, Math.abs(graphScale));
  const sampleLabel = "775.3 Mb/s";
  const fontSizePx = 10;
  const charWidthPx = fontSizePx * 0.58;
  // Keep a tight collision box: approximate glyph bounds plus ~1px gap.
  const labelWidthPx = sampleLabel.length * charWidthPx + 2;
  const labelHeightPx = fontSizePx + 2;
  return {
    minDx: labelWidthPx / safeScale,
    minDy: labelHeightPx / safeScale
  };
}

function buildTrafficLabelOffsetPairs(maxStep: number): Array<{ along: number; normal: number }> {
  const pairs: Array<{ along: number; normal: number }> = [];
  const seen = new Set<string>();

  const pushPair = (along: number, normal: number) => {
    const key = `${along}:${normal}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ along, normal });
  };

  pushPair(0, 0);
  for (let step = 1; step <= maxStep; step++) {
    pushPair(0, step);
    pushPair(0, -step);
    pushPair(step, 0);
    pushPair(-step, 0);
    for (let along = 1; along <= step; along++) {
      pushPair(along, step);
      pushPair(-along, step);
      pushPair(along, -step);
      pushPair(-along, -step);
      if (along === step) continue;
      pushPair(step, along);
      pushPair(step, -along);
      pushPair(-step, along);
      pushPair(-step, -along);
    }
  }
  return pairs;
}

/**
 * Uniform-grid index for "any point within a dx/dy box" collision probes.
 * The label placement search tests thousands of candidate points against
 * hundreds of placed labels; linear scans froze the webview on large
 * topologies (100+ links), so probes must stay near O(1).
 */
class LabelPointIndex {
  private readonly cellSize: number;
  private readonly buckets = new Map<string, Point[]>();

  constructor(cellSize: number) {
    this.cellSize = Math.max(1e-6, cellSize);
  }

  add(point: Point): void {
    const key = this.keyFor(point.x, point.y);
    const bucket = this.buckets.get(key);
    if (bucket) {
      bucket.push(point);
    } else {
      this.buckets.set(key, [point]);
    }
  }

  /** True when any indexed point satisfies |dx| < maxDx and |dy| < maxDy. */
  anyWithinBox(probe: Point, maxDx: number, maxDy: number): boolean {
    const ringX = Math.ceil(maxDx / this.cellSize);
    const ringY = Math.ceil(maxDy / this.cellSize);
    const col = Math.floor(probe.x / this.cellSize);
    const row = Math.floor(probe.y / this.cellSize);
    for (let dc = -ringX; dc <= ringX; dc++) {
      for (let dr = -ringY; dr <= ringY; dr++) {
        const bucket = this.buckets.get(`${col + dc}:${row + dr}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (Math.abs(probe.x - other.x) < maxDx && Math.abs(probe.y - other.y) < maxDy) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private keyFor(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)}:${Math.floor(y / this.cellSize)}`;
  }
}

/** Shared state for placing traffic labels across all edges of one export. */
interface TrafficLabelSearchContext {
  graphScale: number;
  interfaceLabelPoints: Point[];
  occupiedPoints: Point[];
  interfaceIndex: LabelPointIndex;
  occupiedIndex: LabelPointIndex;
  interfaceMinDx: number;
  interfaceMinDy: number;
  trafficMinDx: number;
  trafficMinDy: number;
  addOccupied(point: Point): void;
}

function createTrafficLabelSearchContext(
  interfaceLabelPoints: Point[],
  graphScale: number
): TrafficLabelSearchContext {
  const safeScale = Math.max(0.05, Math.abs(graphScale));
  const trafficThresholds = getTrafficLabelCollisionThresholds(graphScale);
  const interfaceMinDx = 38 / safeScale;
  const interfaceMinDy = 14 / safeScale;

  const interfaceIndex = new LabelPointIndex(Math.max(interfaceMinDx, interfaceMinDy));
  for (const point of interfaceLabelPoints) {
    interfaceIndex.add(point);
  }

  const occupiedPoints: Point[] = [];
  const occupiedIndex = new LabelPointIndex(
    Math.max(trafficThresholds.minDx, trafficThresholds.minDy)
  );

  return {
    graphScale,
    interfaceLabelPoints,
    occupiedPoints,
    interfaceIndex,
    occupiedIndex,
    interfaceMinDx,
    interfaceMinDy,
    trafficMinDx: trafficThresholds.minDx,
    trafficMinDy: trafficThresholds.minDy,
    addOccupied(point: Point): void {
      occupiedPoints.push(point);
      occupiedIndex.add(point);
    }
  };
}

/**
 * Squared distance from `point` to the nearest occupied/interface label.
 * Abandons early once the running minimum cannot beat `abandonAtOrBelowSq`
 * (the returned value is then only guaranteed to be <= that bound).
 */
function nearestLabelDistanceSquared(
  point: Point,
  context: TrafficLabelSearchContext,
  abandonAtOrBelowSq: number
): number {
  let minSq = Number.POSITIVE_INFINITY;
  for (const other of context.occupiedPoints) {
    const dx = point.x - other.x;
    const dy = point.y - other.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < minSq) {
      minSq = distanceSq;
      if (minSq <= abandonAtOrBelowSq) return minSq;
    }
  }
  for (const other of context.interfaceLabelPoints) {
    const dx = point.x - other.x;
    const dy = point.y - other.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < minSq) {
      minSq = distanceSq;
      if (minSq <= abandonAtOrBelowSq) return minSq;
    }
  }
  return minSq;
}

function canPlaceTrafficLabelAt(point: Point, context: TrafficLabelSearchContext): boolean {
  if (context.interfaceIndex.anyWithinBox(point, context.interfaceMinDx, context.interfaceMinDy)) {
    return false;
  }
  return !context.occupiedIndex.anyWithinBox(point, context.trafficMinDx, context.trafficMinDy);
}

/** Offset search pattern is scale-independent; compute it once. */
const TRAFFIC_LABEL_OFFSET_PAIRS = buildTrafficLabelOffsetPairs(10);

/**
 * Sparse offsets for the whole-path rescue sweep. When the dense search near
 * the preferred point is fully blocked, the path corridor is saturated —
 * probing every offset again for all 81 sweep samples costs tens of millions
 * of collision checks on large fanouts (this froze the webview).
 */
const TRAFFIC_LABEL_SWEEP_OFFSET_PAIRS: Array<{ along: number; normal: number }> = [
  { along: 0, normal: 0 },
  { along: 0, normal: 3 },
  { along: 0, normal: -3 },
  { along: 0, normal: 6 },
  { along: 0, normal: -6 },
  { along: 0, normal: 10 },
  { along: 0, normal: -10 }
];

interface TrafficLabelCandidate {
  point: Point;
  distanceFromPreferred: number;
}

function buildTrafficLabelCandidates(
  parsed: ParsedPathCommand,
  candidateTs: number[],
  seenCandidateTs: Set<string>,
  base: Point,
  stepSize: number,
  offsetPairs: Array<{ along: number; normal: number }>
): TrafficLabelCandidate[] {
  const candidates: TrafficLabelCandidate[] = [];
  for (const candidateT of candidateTs) {
    const candidateKey = candidateT.toFixed(3);
    if (seenCandidateTs.has(candidateKey)) continue;
    seenCandidateTs.add(candidateKey);
    const anchor = pointOnParsedPathAtT(parsed, candidateT);
    const tangent = tangentOnParsedPathAtT(parsed, candidateT);
    const normal = { x: -tangent.y, y: tangent.x };

    for (const offset of offsetPairs) {
      const candidate = {
        x: anchor.x + tangent.x * offset.along * stepSize + normal.x * offset.normal * stepSize,
        y: anchor.y + tangent.y * offset.along * stepSize + normal.y * offset.normal * stepSize
      };
      candidates.push({
        point: candidate,
        distanceFromPreferred: Math.hypot(candidate.x - base.x, candidate.y - base.y)
      });
    }
  }
  candidates.sort((a, b) => a.distanceFromPreferred - b.distanceFromPreferred);
  return candidates;
}

function resolveTrafficLabelPoint(
  halfPathData: string,
  context: TrafficLabelSearchContext,
  interfaceSide: "start" | "end"
): Point {
  const safeScale = Math.max(0.05, Math.abs(context.graphScale));
  const stepSize = 1 / safeScale;
  const parsed = parsePathCommand(halfPathData);
  const preferredT = interfaceSide === "start" ? 0.38 : 0.62;
  const base = parsed
    ? pointOnParsedPathAtT(parsed, preferredT)
    : (parsePathStart(halfPathData) ?? { x: 0, y: 0 });

  if (!parsed) {
    context.addOccupied(base);
    return base;
  }

  // Search in two stages: a dense set near the preferred point first, then a
  // sparse sweep along the whole path only when the dense set is fully blocked.
  const seenCandidateTs = new Set<string>();
  const candidateStages = [
    buildTrafficLabelCandidates(
      parsed,
      buildTrafficLabelCandidateTs(interfaceSide, estimateParsedPathLength(parsed), safeScale),
      seenCandidateTs,
      base,
      stepSize,
      TRAFFIC_LABEL_OFFSET_PAIRS
    ),
    () =>
      buildTrafficLabelCandidates(
        parsed,
        buildExpandedTrafficLabelCandidateTs(interfaceSide),
        seenCandidateTs,
        base,
        stepSize,
        TRAFFIC_LABEL_SWEEP_OFFSET_PAIRS
      )
  ] as const;

  let fallback = base;
  let bestScoreSq = -1;
  const considerFallback = (candidate: Point): void => {
    const scoreSq = nearestLabelDistanceSquared(candidate, context, bestScoreSq);
    if (scoreSq > bestScoreSq) {
      bestScoreSq = scoreSq;
      fallback = candidate;
    }
  };

  for (const stage of candidateStages) {
    const candidates = typeof stage === "function" ? stage() : stage;
    for (const candidate of candidates) {
      if (canPlaceTrafficLabelAt(candidate.point, context)) {
        context.addOccupied(candidate.point);
        return candidate.point;
      }
      considerFallback(candidate.point);
    }
  }

  context.addOccupied(fallback);
  return fallback;
}

function buildTrafficRateLabelPlacementMap(
  placements: GrafanaTrafficRateLabelPlacement[] | undefined
): Map<string, GrafanaTrafficRateLabelPlacement> {
  const result = new Map<string, GrafanaTrafficRateLabelPlacement>();
  for (const placement of placements ?? []) {
    if (result.has(placement.labelCellId)) continue;
    if (!Number.isFinite(placement.x) || !Number.isFinite(placement.y)) continue;
    result.set(placement.labelCellId, placement);
  }
  return result;
}

function getGrafanaRateLabelFontSize(
  placement: GrafanaTrafficRateLabelPlacement | undefined
): number {
  if (placement === undefined) return DEFAULT_GRAFANA_RATE_LABEL_FONT_SIZE;
  return asFinitePositiveNumber(placement.fontSize) ?? DEFAULT_GRAFANA_RATE_LABEL_FONT_SIZE;
}

function createTrafficHalfCell(
  doc: XMLDocument,
  sourcePath: Element,
  halfPathData: string,
  shortCellId: string,
  labelSearchContext: TrafficLabelSearchContext,
  interfaceSide: "start" | "end",
  trafficRateLabelPlacementsByCellId: Map<string, GrafanaTrafficRateLabelPlacement>,
  trafficRatesOnHoverOnly: boolean
): Element {
  const trafficLabelPlaceholder = "rate";
  const labelCellId = getTrafficLabelCellId(shortCellId);

  const group = doc.createElementNS(SVG_NS, "g");
  group.setAttribute("class", "grafana-traffic-half");
  setCellIdAttributes(group, shortCellId);

  const clonedPath = sourcePath.cloneNode(true);
  if (!(clonedPath instanceof Element)) {
    throw new Error("Expected cloned traffic path to be an Element");
  }
  const path = clonedPath;
  path.setAttribute("d", halfPathData);
  setGrafanaTrafficNoDataStroke(path);
  path.removeAttribute("id");
  path.removeAttribute("data-cell-id");
  group.appendChild(path);

  if (trafficRatesOnHoverOnly) {
    const hitboxPath = doc.createElementNS(SVG_NS, "path");
    hitboxPath.setAttribute("class", "grafana-traffic-hitbox");
    hitboxPath.setAttribute("d", halfPathData);
    group.appendChild(hitboxPath);
  }

  const placement = trafficRateLabelPlacementsByCellId.get(labelCellId);
  const mid =
    placement !== undefined
      ? { x: placement.x, y: placement.y }
      : resolveTrafficLabelPoint(halfPathData, labelSearchContext, interfaceSide);
  if (placement !== undefined) {
    labelSearchContext.addOccupied(mid);
  }
  const text = doc.createElementNS(SVG_NS, "text");
  text.setAttribute("x", fmt(mid.x));
  text.setAttribute("y", fmt(mid.y));
  text.setAttribute("font-size", fmt(getGrafanaRateLabelFontSize(placement)));
  text.setAttribute("font-family", "Helvetica, Arial, sans-serif");
  setCellIdAttributes(text, labelCellId);
  text.style.color = "#FFFFFF";
  text.style.filter = "drop-shadow(0 0 1px rgba(0, 0, 0, 0.95))";
  text.setAttribute("fill", "currentColor");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  text.setAttribute("stroke", "none");
  text.textContent = trafficLabelPlaceholder;
  group.appendChild(text);

  return group;
}

function resolveOperstateCellElements(edgeGroup: Element): {
  source: Element | null;
  target: Element | null;
} {
  const labelRects = Array.from(edgeGroup.querySelectorAll("g.edge-label"))
    .map((labelGroup) => labelGroup.querySelector("circle,ellipse,rect,path,polygon,polyline"))
    .filter((shape): shape is Element => shape !== null);
  return {
    source: labelRects[0] ?? null,
    target: labelRects[1] ?? null
  };
}

function buildEdgeGroupByDataId(doc: XMLDocument): Map<string, Element> {
  const edgeGroupByDataId = new Map<string, Element>();
  for (const group of Array.from(doc.querySelectorAll("g.export-edge"))) {
    const edgeDataId = group.getAttribute("data-id");
    if (edgeDataId === null || edgeDataId.length === 0 || edgeGroupByDataId.has(edgeDataId)) {
      continue;
    }
    edgeGroupByDataId.set(edgeDataId, group);
  }
  return edgeGroupByDataId;
}

function collectInterfaceLabelPoints(doc: XMLDocument): Point[] {
  const interfaceLabelPoints: Point[] = [];
  for (const textEl of Array.from(doc.querySelectorAll("g.edge-label text[x][y]"))) {
    const x = parseNumericAttr(textEl, "x");
    const y = parseNumericAttr(textEl, "y");
    if (x === null || y === null) continue;
    interfaceLabelPoints.push({ x, y });
  }
  return interfaceLabelPoints;
}

function applyTrafficLabelHoverOnlyStyle(doc: XMLDocument): void {
  const svgEl = doc.documentElement;
  if (svgEl.querySelector("#grafana-traffic-hover-style")) return;

  const styleEl = doc.createElementNS(SVG_NS, "style");
  styleEl.setAttribute("id", "grafana-traffic-hover-style");
  styleEl.setAttribute("type", "text/css");
  styleEl.textContent = [
    ".grafana-traffic-half > path.grafana-traffic-hitbox{fill:none;stroke:transparent !important;stroke-width:14;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;pointer-events:stroke;}",
    ".grafana-traffic-half > text{opacity:0;pointer-events:none;transition:opacity 120ms ease-in-out;}",
    ".grafana-traffic-half:hover > text{opacity:1;}"
  ].join("");
  svgEl.insertBefore(styleEl, svgEl.firstChild);
}

function replaceTrafficPathWithHalfCells(
  doc: XMLDocument,
  trafficPath: Element,
  mapping: GrafanaEdgeCellMapping,
  labelSearchContext: TrafficLabelSearchContext,
  trafficRateLabelPlacementsByCellId: Map<string, GrafanaTrafficRateLabelPlacement>,
  trafficRatesOnHoverOnly: boolean
): void {
  const parent = trafficPath.parentNode;
  if (!parent) return;

  const pathData = trafficPath.getAttribute("d") ?? "";
  const split = splitPathIntoHalves(pathData);
  const firstHalfData = split?.first ?? pathData;
  const secondHalfData = split?.second ?? pathData;

  const firstHalf = createTrafficHalfCell(
    doc,
    trafficPath,
    firstHalfData,
    mapping.trafficCellId,
    labelSearchContext,
    "start",
    trafficRateLabelPlacementsByCellId,
    trafficRatesOnHoverOnly
  );
  const secondHalf = createTrafficHalfCell(
    doc,
    trafficPath,
    secondHalfData,
    mapping.reverseTrafficCellId,
    labelSearchContext,
    "end",
    trafficRateLabelPlacementsByCellId,
    trafficRatesOnHoverOnly
  );
  parent.insertBefore(firstHalf, trafficPath);
  parent.insertBefore(secondHalf, trafficPath);
  trafficPath.remove();
}

function applyTrafficCellsToEdgeGroup(
  doc: XMLDocument,
  mapping: GrafanaEdgeCellMapping,
  trafficGroup: Element,
  labelSearchContext: TrafficLabelSearchContext,
  trafficRateLabelPlacementsByCellId: Map<string, GrafanaTrafficRateLabelPlacement>,
  trafficRatesOnHoverOnly: boolean
): void {
  const trafficCellEl = resolveTrafficCellElement(trafficGroup);
  if (trafficCellEl.tagName.toLowerCase() !== "path") {
    setCellIdAttributes(trafficCellEl, mapping.trafficCellId);
    setGrafanaTrafficNoDataStroke(trafficCellEl);
    return;
  }

  replaceTrafficPathWithHalfCells(
    doc,
    trafficCellEl,
    mapping,
    labelSearchContext,
    trafficRateLabelPlacementsByCellId,
    trafficRatesOnHoverOnly
  );
}

function applyOperstateCellsToEdgeGroup(
  doc: XMLDocument,
  mapping: GrafanaEdgeCellMapping,
  trafficGroup: Element
): void {
  const operstateCellEls = resolveOperstateCellElements(trafficGroup);
  if (operstateCellEls.source) {
    setCellIdAttributes(operstateCellEls.source, mapping.operstateCellId);
    operstateCellEls.source.classList.add("grafana-operstate-cell");
  } else {
    const operstateGroup = createOperstateCellGroup(doc, trafficGroup, mapping.operstateCellId);
    trafficGroup.parentNode?.insertBefore(operstateGroup, trafficGroup);
  }

  if (!operstateCellEls.target) return;
  setCellIdAttributes(operstateCellEls.target, mapping.targetOperstateCellId);
  operstateCellEls.target.classList.add("grafana-operstate-cell");
}

export function applyGrafanaCellIdsToSvg(
  svgContent: string,
  mappings: GrafanaEdgeCellMapping[],
  options: GrafanaCellIdSvgOptions = {}
): string {
  if (mappings.length === 0) return svgContent;
  const trafficRatesOnHoverOnly = options.trafficRatesOnHoverOnly === true;

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, SVG_MIME_TYPE);
  const graphTransform = parseGraphTransform(doc.documentElement);
  const graphScale = Math.max(0.05, Math.abs(graphTransform.scale));
  const edgeGroupByDataId = buildEdgeGroupByDataId(doc);
  const labelSearchContext = createTrafficLabelSearchContext(
    collectInterfaceLabelPoints(doc),
    graphScale
  );
  const trafficRateLabelPlacementsByCellId = buildTrafficRateLabelPlacementMap(
    options.trafficRateLabelPlacements
  );

  for (const mapping of mappings) {
    const trafficGroup = edgeGroupByDataId.get(mapping.edgeId);
    if (!trafficGroup) continue;
    applyTrafficCellsToEdgeGroup(
      doc,
      mapping,
      trafficGroup,
      labelSearchContext,
      trafficRateLabelPlacementsByCellId,
      trafficRatesOnHoverOnly
    );
    applyOperstateCellsToEdgeGroup(doc, mapping, trafficGroup);
  }

  if (trafficRatesOnHoverOnly) {
    applyTrafficLabelHoverOnlyStyle(doc);
  }

  return new XMLSerializer().serializeToString(doc.documentElement);
}

export function sanitizeSvgForGrafana(svgContent: string): string {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return svgContent
      .replace(/\sfilter=(["'])url\(#text-shadow\)\1/gi, "")
      .replace(/<filter[^>]*id=(["'])text-shadow\1[\s\S]*?<\/filter>/gi, "");
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, SVG_MIME_TYPE);

  for (const textEl of Array.from(doc.querySelectorAll("text[filter]"))) {
    textEl.removeAttribute("filter");
  }

  for (const filterEl of Array.from(doc.querySelectorAll("defs filter#text-shadow"))) {
    filterEl.remove();
  }

  // Keep interface labels readable while minimally affecting operstate color.
  for (const edgeLabelBg of Array.from(doc.querySelectorAll("g.edge-label rect"))) {
    edgeLabelBg.setAttribute("fill", "rgba(0, 0, 0, 0.36)");
    edgeLabelBg.setAttribute("stroke", "none");
  }

  return new XMLSerializer().serializeToString(doc.documentElement);
}

export function removeUnlinkedNodesFromSvg(svgContent: string, linkedNodeIds: Set<string>): string {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return svgContent.replace(
      /<g\b[^>]*class=(["'])[^"']*\bexport-node\b[^"']*\1[^>]*data-id=(["'])([^"']+)\2[^>]*>[\s\S]*?<\/g>/gi,
      (match, _classQuote: string, _idQuote: string, nodeId: string) =>
        linkedNodeIds.has(nodeId) ? match : ""
    );
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgContent, SVG_MIME_TYPE);

  for (const nodeEl of Array.from(doc.querySelectorAll("g.export-node[data-id]"))) {
    const nodeId = nodeEl.getAttribute("data-id");
    if (nodeId === null || nodeId.length === 0 || linkedNodeIds.has(nodeId)) continue;
    nodeEl.remove();
  }

  return new XMLSerializer().serializeToString(doc.documentElement);
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function buildTrafficRateLabelDataRefMap(
  placements: GrafanaTrafficRateLabelPlacement[] | undefined
): Map<string, string> {
  const result = new Map<string, string>();
  for (const placement of placements ?? []) {
    if (result.has(placement.labelCellId)) continue;
    const dataRef = asString(placement.dataRef);
    if (dataRef === null) continue;
    result.set(placement.labelCellId, dataRef);
  }
  return result;
}

function asValidYamlNumber(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

const RATE_LABEL_HIDE_TAG = "hide-rates";

export function buildGrafanaPanelYaml(
  mappings: GrafanaEdgeCellMapping[],
  options: GrafanaPanelYamlOptions = {}
): string {
  const trafficThresholds = options.trafficThresholds ?? DEFAULT_GRAFANA_TRAFFIC_THRESHOLDS;
  const includeHideRatesLegendToggle = options.includeHideRatesLegendToggle !== false;
  const trafficRateLabelDataRefByCellId = buildTrafficRateLabelDataRefMap(
    options.trafficRateLabelPlacements
  );
  const greenThreshold = asValidYamlNumber(
    trafficThresholds.green,
    DEFAULT_GRAFANA_TRAFFIC_THRESHOLDS.green
  );
  const yellowThreshold = asValidYamlNumber(
    trafficThresholds.yellow,
    DEFAULT_GRAFANA_TRAFFIC_THRESHOLDS.yellow
  );
  const orangeThreshold = asValidYamlNumber(
    trafficThresholds.orange,
    DEFAULT_GRAFANA_TRAFFIC_THRESHOLDS.orange
  );
  const redThreshold = asValidYamlNumber(
    trafficThresholds.red,
    DEFAULT_GRAFANA_TRAFFIC_THRESHOLDS.red
  );
  const lines: string[] = [
    "---",
    "anchors:",
    "  thresholds-operstate: &thresholds-operstate",
    '    - { color: "red", level: 0 }',
    '    - { color: "green", level: 1 }',
    "  thresholds-traffic: &thresholds-traffic",
    '    - { color: "gray", level: 0 }',
    `    - { color: "green", level: ${greenThreshold} }`,
    `    - { color: "yellow", level: ${yellowThreshold} }`,
    `    - { color: "orange", level: ${orangeThreshold} }`,
    `    - { color: "red", level: ${redThreshold} }`,
    "  thresholds-rate-label: &thresholds-rate-label",
    '    - { color: "white", level: 0 }',
    "  label-config: &label-config",
    '    separator: "replace"',
    '    units: "bps"',
    "    decimalPoints: 1",
    "    valueMappings:",
    `      - { valueMax: ${greenThreshold}, text: "\\u200B" }`,
    'cellIdPreamble: "cell-"',
    "cells:"
  ];
  if (includeHideRatesLegendToggle) {
    lines.splice(
      lines.length - 1,
      0,
      "tagConfig:",
      `  legend: ["${RATE_LABEL_HIDE_TAG}"]`,
      "  lowlightAlphaFactor: 0",
      "  highlightRgbFactor: 1"
    );
  }

  if (mappings.length === 0) {
    lines.push("  {}");
    return `${lines.join("\n")}\n`;
  }

  for (const mapping of mappings) {
    const operstateDataRef = `oper-state:${mapping.source}:${mapping.sourceEndpoint}`;
    const targetOperstateDataRef = `oper-state:${mapping.target}:${mapping.targetEndpoint}`;
    const trafficDataRef = `${mapping.source}:${mapping.sourceEndpoint}:out`;
    const reverseTrafficDataRef = `${mapping.target}:${mapping.targetEndpoint}:out`;
    const trafficLabelCellId = getTrafficLabelCellId(mapping.trafficCellId);
    const reverseTrafficLabelCellId = getTrafficLabelCellId(mapping.reverseTrafficCellId);
    const trafficLabelDataRef =
      trafficRateLabelDataRefByCellId.get(trafficLabelCellId) ?? trafficDataRef;
    const reverseTrafficLabelDataRef =
      trafficRateLabelDataRefByCellId.get(reverseTrafficLabelCellId) ?? reverseTrafficDataRef;
    lines.push(`  ${quoteYaml(mapping.operstateCellId)}:`);
    lines.push(`    dataRef: ${quoteYaml(operstateDataRef)}`);
    lines.push("    fillColor:");
    lines.push("      thresholds: *thresholds-operstate");
    if (includeHideRatesLegendToggle) {
      lines.push(`    tags: ["${RATE_LABEL_HIDE_TAG}"]`);
    }
    lines.push(`  ${quoteYaml(mapping.targetOperstateCellId)}:`);
    lines.push(`    dataRef: ${quoteYaml(targetOperstateDataRef)}`);
    lines.push("    fillColor:");
    lines.push("      thresholds: *thresholds-operstate");
    if (includeHideRatesLegendToggle) {
      lines.push(`    tags: ["${RATE_LABEL_HIDE_TAG}"]`);
    }
    lines.push(`  ${quoteYaml(mapping.trafficCellId)}:`);
    lines.push(`    dataRef: ${quoteYaml(trafficDataRef)}`);
    lines.push("    strokeColor:");
    lines.push("      thresholds: *thresholds-traffic");
    if (includeHideRatesLegendToggle) {
      lines.push(`    tags: ["${RATE_LABEL_HIDE_TAG}"]`);
    }
    lines.push(`  ${quoteYaml(trafficLabelCellId)}:`);
    lines.push(`    dataRef: ${quoteYaml(trafficLabelDataRef)}`);
    lines.push("    label: *label-config");
    lines.push("    labelColor:");
    lines.push("      thresholds: *thresholds-rate-label");
    lines.push(`  ${quoteYaml(mapping.reverseTrafficCellId)}:`);
    lines.push(`    dataRef: ${quoteYaml(reverseTrafficDataRef)}`);
    lines.push("    strokeColor:");
    lines.push("      thresholds: *thresholds-traffic");
    if (includeHideRatesLegendToggle) {
      lines.push(`    tags: ["${RATE_LABEL_HIDE_TAG}"]`);
    }
    lines.push(`  ${quoteYaml(reverseTrafficLabelCellId)}:`);
    lines.push(`    dataRef: ${quoteYaml(reverseTrafficLabelDataRef)}`);
    lines.push("    label: *label-config");
    lines.push("    labelColor:");
    lines.push("      thresholds: *thresholds-rate-label");
  }

  return `${lines.join("\n")}\n`;
}

function buildDashboardTargets() {
  return DEFAULT_GRAFANA_TARGETS.map((target, index) => ({
    datasource: { type: target.datasource },
    editorMode: "code",
    expr: target.expr,
    hide: target.hide ?? false,
    instant: target.instant,
    legendFormat: target.legendFormat,
    range: target.range,
    refId: String.fromCharCode("A".charCodeAt(0) + index)
  }));
}

export function buildGrafanaDashboardJson(
  panelConfigYaml: string,
  svgContent: string,
  dashboardTitle: string
): string {
  const title = dashboardTitle.trim() || "Network Telemetry";
  const dashboard = {
    annotations: {
      list: [
        {
          builtIn: 1,
          datasource: { type: "prometheus" },
          enable: true,
          hide: true,
          iconColor: "rgba(0, 211, 255, 1)",
          name: "Annotations & Alerts",
          type: "dashboard"
        }
      ]
    },
    editable: true,
    fiscalYearStartMonth: 0,
    graphTooltip: 0,
    id: 3,
    links: [],
    liveNow: false,
    panels: [
      {
        datasource: { type: "prometheus" },
        gridPos: { h: 23, w: 13, x: 0, y: 0 },
        id: 1,
        options: {
          animationControlEnabled: true,
          animationsEnabled: true,
          debuggingCtr: {
            colorsCtr: 1,
            dataCtr: 0,
            displaySvgCtr: 0,
            mappingsCtr: 0,
            timingsCtr: 0
          },
          highlighterEnabled: true,
          panZoomEnabled: true,
          panelConfig: panelConfigYaml,
          siteConfig: "",
          svg: svgContent,
          testDataEnabled: false,
          timeSliderEnabled: true
        },
        targets: buildDashboardTargets(),
        title,
        type: "andrewbmchugh-flow-panel"
      }
    ],
    refresh: "5s",
    schemaVersion: 38,
    tags: [],
    time: { from: "now-5m", to: "now" },
    timepicker: {},
    timezone: "",
    title,
    version: 6,
    weekStart: ""
  };

  return JSON.stringify(dashboard, null, 2);
}
