// Edge-to-SVG conversion for export.
import type { Node, Edge } from "@xyflow/react";

import {
  getEdgePoints,
  calculateControlPoint,
  getLabelPosition,
  getNodeIntersection,
  isVisuallyCanonicalDirection
} from "../../canvas/edgeGeometry";
import type { EdgeInfo } from "../../../stores/canvasStore";
// Despite the hook-style name, useEdgeInfo is a plain cached function
// (no React state) and is safe to call outside of components.
import { useEdgeInfo as buildEdgeInfo } from "../../../stores/canvasStore";
import { DEFAULT_ENDPOINT_LABEL_OFFSET } from "../../../annotations/endpointLabelOffset";
import {
  INTERFACE_SELECT_AUTO,
  resolveTelemetryInterfaceLabel
} from "../../../utils/telemetryInterfaceLabels";

import {
  NODE_ICON_SIZE,
  EDGE_COLOR,
  EDGE_STYLE,
  EDGE_LABEL,
  TELEMETRY_EDGE_LABEL,
  CONTROL_POINT_STEP_SIZE,
  escapeXml,
  resolveCssColor
} from "./constants";
import { measureTextWidth } from "./textMetrics";

// ============================================================================
// Types
// ============================================================================

interface TopologyEdgeData {
  sourceEndpoint?: string;
  targetEndpoint?: string;
  linkStatus?: "up" | "down";
  endpointLabelOffsetEnabled?: boolean;
  endpointLabelOffset?: number;
  [key: string]: unknown;
}

interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeSvgRenderOptions {
  nodeIconSize?: number;
  interfaceScale?: number;
  interfaceLabelOverrides?: Record<string, string>;
  globalInterfaceOverrideSelection?: string;
  /** Render endpoint labels like the canvas telemetry style (bubbles anchored at node sides). */
  telemetryStyleLabels?: boolean;
}

type InterfaceSide = "top" | "right" | "bottom" | "left";

interface EndpointVector {
  dx: number;
  dy: number;
  samples: number;
}

interface InterfaceAnchor {
  x: number;
  y: number;
}

type NodeInterfaceAnchorMap = Map<string, Map<string, InterfaceAnchor>>;

interface EndpointAssignment {
  endpoint: string;
  sortKey: number;
  radius: number;
}

interface ResolvedEdgeRenderOptions {
  nodeIconSize: number;
  interfaceScale: number;
  interfaceLabelOverrides: Record<string, string>;
  globalInterfaceOverrideSelection: string;
  telemetryStyleLabels: boolean;
  /** Theme colors for the default-style pill labels */
  defaultLabelBackground: string;
  defaultLabelForeground: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get stroke color based on link status
 */
function getEdgeColor(linkStatus: string | undefined): string {
  switch (linkStatus) {
    case "up":
      return EDGE_COLOR.up;
    case "down":
      return EDGE_COLOR.down;
    default:
      return EDGE_COLOR.default;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveEdgeRenderOptions(renderOptions?: EdgeSvgRenderOptions): ResolvedEdgeRenderOptions {
  const nodeIconSizeRaw = renderOptions?.nodeIconSize;
  const interfaceScaleRaw = renderOptions?.interfaceScale;
  const nodeIconSize =
    typeof nodeIconSizeRaw === "number" && Number.isFinite(nodeIconSizeRaw)
      ? clamp(nodeIconSizeRaw, 12, 240)
      : NODE_ICON_SIZE;
  const interfaceScale =
    typeof interfaceScaleRaw === "number" && Number.isFinite(interfaceScaleRaw)
      ? clamp(interfaceScaleRaw, 0.4, 4)
      : 1;
  const interfaceLabelOverrides =
    renderOptions?.interfaceLabelOverrides &&
    typeof renderOptions.interfaceLabelOverrides === "object"
      ? renderOptions.interfaceLabelOverrides
      : {};

  return {
    nodeIconSize,
    interfaceScale,
    interfaceLabelOverrides,
    globalInterfaceOverrideSelection:
      renderOptions?.globalInterfaceOverrideSelection ?? INTERFACE_SELECT_AUTO,
    telemetryStyleLabels: renderOptions?.telemetryStyleLabels === true,
    defaultLabelBackground: resolveCssColor(
      "var(--topoviewer-edge-label-background)",
      EDGE_LABEL.backgroundColor
    ),
    defaultLabelForeground: resolveCssColor(
      "var(--topoviewer-edge-label-foreground)",
      EDGE_LABEL.color
    )
  };
}

function normalizeEndpoint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getMeasuredNodeWidth(node: Node, fallback: number): number {
  if (typeof node.measured?.width === "number") return node.measured.width;
  if (typeof node.width === "number") return node.width;
  return fallback;
}

/**
 * Node icon rect in flow coordinates. Matches the canvas (TopologyEdge.tsx
 * getNodeRect): the icon is horizontally centered within the measured node.
 */
function getNodeRect(node: Node, nodeIconSize: number): NodeRect {
  const measuredWidth = getMeasuredNodeWidth(node, nodeIconSize);
  return {
    x: node.position.x + (measuredWidth - nodeIconSize) / 2,
    y: node.position.y,
    width: nodeIconSize,
    height: nodeIconSize
  };
}

function getRectCenter(rect: NodeRect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}

function sideBuckets(): Record<InterfaceSide, EndpointAssignment[]> {
  return { top: [], right: [], bottom: [], left: [] };
}

function getOrCreateNodeEndpointVectors(
  vectorsByNode: Map<string, Map<string, EndpointVector>>,
  nodeId: string
): Map<string, EndpointVector> {
  const existing = vectorsByNode.get(nodeId);
  if (existing) return existing;
  const created = new Map<string, EndpointVector>();
  vectorsByNode.set(nodeId, created);
  return created;
}

function addEndpointVector(
  vectorsByNode: Map<string, Map<string, EndpointVector>>,
  nodeId: string,
  endpoint: string,
  dx: number,
  dy: number
): void {
  const nodeVectors = getOrCreateNodeEndpointVectors(vectorsByNode, nodeId);
  const existing = nodeVectors.get(endpoint) ?? { dx: 0, dy: 0, samples: 0 };
  existing.dx += dx;
  existing.dy += dy;
  existing.samples += 1;
  nodeVectors.set(endpoint, existing);
}

function getOrCreateEndpointSet(
  endpointsByNode: Map<string, Set<string>>,
  nodeId: string
): Set<string> {
  const existing = endpointsByNode.get(nodeId);
  if (existing) return existing;
  const created = new Set<string>();
  endpointsByNode.set(nodeId, created);
  return created;
}

function trackNodeEndpoint(
  endpointsByNode: Map<string, Set<string>>,
  nodeId: string,
  endpoint: string | null
): void {
  if (endpoint === null) return;
  getOrCreateEndpointSet(endpointsByNode, nodeId).add(endpoint);
}

function collectEdgeEndpointVectors(
  edge: Edge,
  sourceEndpoint: string | null,
  targetEndpoint: string | null,
  nodeMap: Map<string, Node>,
  nodeIconSize: number,
  vectorsByNode: Map<string, Map<string, EndpointVector>>
): void {
  if (sourceEndpoint === null && targetEndpoint === null) return;
  if (edge.source === edge.target) return;

  const sourceNode = nodeMap.get(edge.source);
  const targetNode = nodeMap.get(edge.target);
  if (!sourceNode || !targetNode) return;

  const sourceCenter = getRectCenter(getNodeRect(sourceNode, nodeIconSize));
  const targetCenter = getRectCenter(getNodeRect(targetNode, nodeIconSize));
  const forwardDx = targetCenter.x - sourceCenter.x;
  const forwardDy = targetCenter.y - sourceCenter.y;

  if (sourceEndpoint !== null) {
    addEndpointVector(vectorsByNode, edge.source, sourceEndpoint, forwardDx, forwardDy);
  }
  if (targetEndpoint !== null) {
    addEndpointVector(vectorsByNode, edge.target, targetEndpoint, -forwardDx, -forwardDy);
  }
}

function collectInterfaceAnchorInputs(
  edges: Edge[],
  nodeMap: Map<string, Node>,
  nodeIconSize: number
): {
  endpointsByNode: Map<string, Set<string>>;
  vectorsByNode: Map<string, Map<string, EndpointVector>>;
} {
  const endpointsByNode = new Map<string, Set<string>>();
  const vectorsByNode = new Map<string, Map<string, EndpointVector>>();

  for (const edge of edges) {
    const data = edge.data as TopologyEdgeData | undefined;
    const sourceEndpoint = normalizeEndpoint(data?.sourceEndpoint);
    const targetEndpoint = normalizeEndpoint(data?.targetEndpoint);
    trackNodeEndpoint(endpointsByNode, edge.source, sourceEndpoint);
    trackNodeEndpoint(endpointsByNode, edge.target, targetEndpoint);
    collectEdgeEndpointVectors(
      edge,
      sourceEndpoint,
      targetEndpoint,
      nodeMap,
      nodeIconSize,
      vectorsByNode
    );
  }

  return { endpointsByNode, vectorsByNode };
}

const HORIZONTAL_SLOPE_THRESHOLD = 0.25;

function classifyInterfaceSide(vector: EndpointVector | undefined): InterfaceSide {
  if (!vector || vector.samples <= 0) return "bottom";

  const dx = vector.dx / vector.samples;
  const dy = vector.dy / vector.samples;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // Keep anchors on top/bottom by default; use sides only for near-horizontal links.
  if (absDx > 0.001 && absDy <= absDx * HORIZONTAL_SLOPE_THRESHOLD) {
    return dx >= 0 ? "right" : "left";
  }

  return dy >= 0 ? "bottom" : "top";
}

function getInterfaceSortKey(side: InterfaceSide, vector: EndpointVector | undefined): number {
  if (!vector || vector.samples <= 0) return 0;
  const avgDx = vector.dx / vector.samples;
  const avgDy = vector.dy / vector.samples;
  return side === "top" || side === "bottom" ? avgDx : avgDy;
}

function positionInterfaceAnchor(
  rect: NodeRect,
  side: InterfaceSide,
  index: number,
  total: number,
  radius: number
): InterfaceAnchor {
  const slot = (index + 1) / (total + 1);
  const out = radius + 1;

  switch (side) {
    case "top":
      return { x: rect.x + rect.width * slot, y: rect.y - out };
    case "right":
      return { x: rect.x + rect.width + out, y: rect.y + rect.height * slot };
    case "bottom":
      return { x: rect.x + rect.width * slot, y: rect.y + rect.height + out };
    case "left":
      return { x: rect.x - out, y: rect.y + rect.height * slot };
  }
}

function buildNodeSideAssignments(
  endpoints: Set<string>,
  nodeVectors: Map<string, EndpointVector> | undefined,
  renderOptions: ResolvedEdgeRenderOptions
): Record<InterfaceSide, EndpointAssignment[]> {
  const buckets = sideBuckets();
  for (const endpoint of endpoints) {
    const vector = nodeVectors?.get(endpoint);
    const side = classifyInterfaceSide(vector);
    const sortKey = getInterfaceSortKey(side, vector);
    const { radius } = getTelemetryLabelMetrics(
      resolveDisplayInterfaceLabel(endpoint, renderOptions),
      renderOptions.interfaceScale
    );
    buckets[side].push({ endpoint, sortKey, radius });
  }
  return buckets;
}

function sortEndpointAssignments(assignments: EndpointAssignment[]): void {
  assignments.sort((a, b) => {
    const bySort = a.sortKey - b.sortKey;
    if (bySort !== 0) return bySort;
    return a.endpoint.localeCompare(b.endpoint);
  });
}

function assignNodeAnchors(
  rect: NodeRect,
  buckets: Record<InterfaceSide, EndpointAssignment[]>
): Map<string, InterfaceAnchor> {
  const endpointAnchors = new Map<string, InterfaceAnchor>();
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const assignments = buckets[side];
    sortEndpointAssignments(assignments);
    for (let i = 0; i < assignments.length; i++) {
      const assignment = assignments[i];
      endpointAnchors.set(
        assignment.endpoint,
        positionInterfaceAnchor(rect, side, i, assignments.length, assignment.radius)
      );
    }
  }
  return endpointAnchors;
}

function buildInterfaceAnchorMap(
  edges: Edge[],
  nodeMap: Map<string, Node>,
  renderOptions: ResolvedEdgeRenderOptions
): NodeInterfaceAnchorMap {
  const { endpointsByNode, vectorsByNode } = collectInterfaceAnchorInputs(
    edges,
    nodeMap,
    renderOptions.nodeIconSize
  );
  const anchorsByNode: NodeInterfaceAnchorMap = new Map();
  for (const [nodeId, endpoints] of endpointsByNode) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const rect = getNodeRect(node, renderOptions.nodeIconSize);
    const nodeVectors = vectorsByNode.get(nodeId);
    const buckets = buildNodeSideAssignments(endpoints, nodeVectors, renderOptions);
    const endpointAnchors = assignNodeAnchors(rect, buckets);
    anchorsByNode.set(nodeId, endpointAnchors);
  }
  return anchorsByNode;
}

function resolveEdgePointsWithInterfaceAnchors(
  sourceRect: NodeRect,
  targetRect: NodeRect,
  sourceAnchor?: InterfaceAnchor,
  targetAnchor?: InterfaceAnchor
): { sx: number; sy: number; tx: number; ty: number } {
  if (sourceAnchor && targetAnchor) {
    return {
      sx: sourceAnchor.x,
      sy: sourceAnchor.y,
      tx: targetAnchor.x,
      ty: targetAnchor.y
    };
  }

  if (sourceAnchor) {
    const targetCenter = getRectCenter(targetRect);
    const targetPoint = getNodeIntersection(
      targetCenter.x,
      targetCenter.y,
      targetRect.width,
      targetRect.height,
      sourceAnchor.x,
      sourceAnchor.y
    );
    return {
      sx: sourceAnchor.x,
      sy: sourceAnchor.y,
      tx: targetPoint.x,
      ty: targetPoint.y
    };
  }

  if (targetAnchor) {
    const sourceCenter = getRectCenter(sourceRect);
    const sourcePoint = getNodeIntersection(
      sourceCenter.x,
      sourceCenter.y,
      sourceRect.width,
      sourceRect.height,
      targetAnchor.x,
      targetAnchor.y
    );
    return {
      sx: sourcePoint.x,
      sy: sourcePoint.y,
      tx: targetAnchor.x,
      ty: targetAnchor.y
    };
  }

  return getEdgePoints(sourceRect, targetRect);
}

// ============================================================================
// Edge Label Builder
// ============================================================================

/**
 * Resolve the label text shown for an endpoint. Telemetry style compacts the
 * interface name exactly like the canvas (per-endpoint overrides, then global
 * selection, then auto-compact); the default style shows the full name.
 */
function resolveDisplayInterfaceLabel(
  endpoint: string,
  renderOptions: ResolvedEdgeRenderOptions
): string {
  if (!renderOptions.telemetryStyleLabels) return endpoint;
  return resolveTelemetryInterfaceLabel(
    endpoint,
    renderOptions.globalInterfaceOverrideSelection,
    renderOptions.interfaceLabelOverrides
  );
}

/**
 * Telemetry-style bubble metrics. Matches TopologyEdge.tsx getTelemetryLabelMetrics().
 */
function getTelemetryLabelMetrics(
  labelText: string,
  interfaceScale: number
): {
  text: string;
  radius: number;
  fontSize: number;
  textStrokeWidth: number;
} {
  const text = labelText.trim();
  const fontSize = TELEMETRY_EDGE_LABEL.fontSize * interfaceScale;
  const textWidth = Math.max(
    fontSize * 0.8,
    text.length * fontSize * TELEMETRY_EDGE_LABEL.charWidthRatio
  );
  const radius = Math.max(
    TELEMETRY_EDGE_LABEL.minRadius * interfaceScale,
    textWidth / 2 + TELEMETRY_EDGE_LABEL.paddingX * interfaceScale
  );
  return {
    text,
    radius,
    fontSize,
    textStrokeWidth: TELEMETRY_EDGE_LABEL.textStrokeWidth * interfaceScale
  };
}

/**
 * Build SVG for a telemetry-style endpoint bubble (circle + compact text).
 */
function buildTelemetryEndpointLabelSvg(
  text: string,
  x: number,
  y: number,
  interfaceScale: number
): string {
  const metrics = getTelemetryLabelMetrics(text, interfaceScale);
  if (!metrics.text) return "";

  let svg = `<g class="edge-label">`;

  svg += `<circle cx="${x}" cy="${y}" r="${metrics.radius}" `;
  svg += `fill="${TELEMETRY_EDGE_LABEL.backgroundColor}" stroke="${TELEMETRY_EDGE_LABEL.outlineColor}" `;
  svg += `stroke-width="${TELEMETRY_EDGE_LABEL.bubbleStrokeWidth}"/>`;

  svg += `<text x="${x}" y="${y}" `;
  svg += `font-size="${metrics.fontSize}" font-weight="${TELEMETRY_EDGE_LABEL.fontWeight}" `;
  svg += `font-family='${TELEMETRY_EDGE_LABEL.fontFamily}' `;
  svg += `dominant-baseline="central" `;
  svg += `fill="${TELEMETRY_EDGE_LABEL.color}" text-anchor="middle" `;
  svg += `stroke="${TELEMETRY_EDGE_LABEL.textStrokeColor}" stroke-width="${metrics.textStrokeWidth}" `;
  svg += `paint-order="stroke" stroke-linejoin="round">`;
  svg += escapeXml(metrics.text);
  svg += `</text>`;

  svg += `</g>`;
  return svg;
}

/**
 * Build SVG for a default-style endpoint label (rounded pill + full text).
 * Matches the canvas EndpointLabel default variant (TopologyEdge.tsx).
 */
function buildDefaultEndpointLabelSvg(
  text: string,
  x: number,
  y: number,
  renderOptions: ResolvedEdgeRenderOptions
): string {
  if (!text) return "";

  const { interfaceScale } = renderOptions;
  const fontSize = Math.max(8, EDGE_LABEL.fontSize * interfaceScale);
  const paddingX = Math.max(2, EDGE_LABEL.paddingX * interfaceScale);
  const textWidth = measureTextWidth(text, {
    fontFamily: EDGE_LABEL.fontFamily,
    fontSizePx: fontSize,
    fontWeight: "400"
  });
  const bgWidth = textWidth + paddingX * 2;
  const bgHeight = fontSize * EDGE_LABEL.lineHeight;

  let svg = `<g class="edge-label">`;

  svg += `<rect x="${x - bgWidth / 2}" y="${y - bgHeight / 2}" width="${bgWidth}" height="${bgHeight}" `;
  svg += `fill="${renderOptions.defaultLabelBackground}" rx="${EDGE_LABEL.borderRadius}" ry="${EDGE_LABEL.borderRadius}"/>`;

  svg += `<text x="${x}" y="${y}" `;
  svg += `font-size="${fontSize}" `;
  svg += `font-family='${EDGE_LABEL.fontFamily}' `;
  svg += `dominant-baseline="central" `;
  svg += `fill="${renderOptions.defaultLabelForeground}" text-anchor="middle">`;
  svg += escapeXml(text);
  svg += `</text>`;

  svg += `</g>`;
  return svg;
}

function buildEndpointLabelSvg(
  endpoint: string,
  x: number,
  y: number,
  renderOptions: ResolvedEdgeRenderOptions
): string {
  const text = resolveDisplayInterfaceLabel(endpoint, renderOptions);
  if (renderOptions.telemetryStyleLabels) {
    return buildTelemetryEndpointLabelSvg(text, x, y, renderOptions.interfaceScale);
  }
  return buildDefaultEndpointLabelSvg(text, x, y, renderOptions);
}

/**
 * Per-endpoint label offsets. Matches TopologyEdge.tsx resolveEdgeLabelOffsets().
 */
function resolveEdgeLabelOffsets(
  edgeData: TopologyEdgeData | undefined,
  renderOptions: ResolvedEdgeRenderOptions
): { source: number; target: number; loop: number } {
  if (edgeData?.endpointLabelOffsetEnabled === false) {
    return { source: 0, target: 0, loop: 0 };
  }

  const { interfaceScale } = renderOptions;
  if (renderOptions.telemetryStyleLabels) {
    const resolveOffset = (endpoint: string | null): number => {
      if (endpoint === null) return DEFAULT_ENDPOINT_LABEL_OFFSET;
      const label = resolveDisplayInterfaceLabel(endpoint, renderOptions);
      return (
        getTelemetryLabelMetrics(label, interfaceScale).radius +
        TELEMETRY_EDGE_LABEL.offsetPadding * interfaceScale
      );
    };
    return {
      source: resolveOffset(normalizeEndpoint(edgeData?.sourceEndpoint)),
      target: resolveOffset(normalizeEndpoint(edgeData?.targetEndpoint)),
      loop: TELEMETRY_EDGE_LABEL.loopOffset * interfaceScale
    };
  }

  const defaultOffset =
    typeof edgeData?.endpointLabelOffset === "number"
      ? edgeData.endpointLabelOffset
      : DEFAULT_ENDPOINT_LABEL_OFFSET;
  const scaledDefaultOffset = defaultOffset * interfaceScale;
  return {
    source: scaledDefaultOffset,
    target: scaledDefaultOffset,
    loop: scaledDefaultOffset
  };
}

function getRegularEdgeLabelPositions(
  ctx: EdgeRenderContext,
  points: { sx: number; sy: number; tx: number; ty: number },
  controlPoint: { x: number; y: number } | null,
  sourceAnchor?: InterfaceAnchor,
  targetAnchor?: InterfaceAnchor
): {
  sourceLabelPos: { x: number; y: number };
  targetLabelPos: { x: number; y: number };
} {
  if (ctx.renderOptions.telemetryStyleLabels && sourceAnchor && targetAnchor) {
    return {
      sourceLabelPos: sourceAnchor,
      targetLabelPos: targetAnchor
    };
  }

  const labelOffsets = resolveEdgeLabelOffsets(ctx.edgeData, ctx.renderOptions);

  return {
    sourceLabelPos: getLabelPosition(
      points.sx,
      points.sy,
      points.tx,
      points.ty,
      labelOffsets.source,
      controlPoint ?? undefined
    ),
    targetLabelPos: getLabelPosition(
      points.tx,
      points.ty,
      points.sx,
      points.sy,
      labelOffsets.target,
      controlPoint ?? undefined
    )
  };
}

// ============================================================================
// Loop Edge Builder
// ============================================================================

const LOOP_EDGE_SIZE = 50;
const LOOP_EDGE_OFFSET = 10;

/**
 * Calculate loop edge geometry for self-referencing edges
 */
function buildLoopEdgePath(
  nodeX: number,
  nodeY: number,
  nodeWidth: number,
  nodeHeight: number,
  loopIndex: number,
  labelOffset: number
): {
  path: string;
  sourceLabelPos: { x: number; y: number };
  targetLabelPos: { x: number; y: number };
} {
  const centerX = nodeX + nodeWidth / 2;
  const centerY = nodeY + nodeHeight / 2;
  const size = LOOP_EDGE_SIZE + loopIndex * LOOP_EDGE_OFFSET;

  const startX = centerX + nodeWidth / 2;
  const startY = centerY - nodeHeight / 4;
  const endX = centerX + nodeWidth / 2;
  const endY = centerY + nodeHeight / 4;

  const cp1X = startX + size;
  const cp1Y = startY - size * 0.5;
  const cp2X = endX + size;
  const cp2Y = endY + size * 0.5;

  const path = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
  const labelX = centerX + nodeWidth / 2 + size * 0.8;

  return {
    path,
    sourceLabelPos: { x: labelX, y: centerY - labelOffset },
    targetLabelPos: { x: labelX, y: centerY + labelOffset }
  };
}

// ============================================================================
// Single Edge Builder
// ============================================================================

interface EdgeRenderContext {
  edgeId: string;
  strokeColor: string;
  edgeData: TopologyEdgeData | undefined;
  includeLabels: boolean;
  renderOptions: ResolvedEdgeRenderOptions;
  interfaceAnchors?: NodeInterfaceAnchorMap;
}

/**
 * Build the edge labels SVG if enabled
 */
function buildEdgeLabels(
  ctx: EdgeRenderContext,
  sourceLabelPos: { x: number; y: number },
  targetLabelPos: { x: number; y: number }
): string {
  if (!ctx.includeLabels) return "";
  const sourceEndpoint = normalizeEndpoint(ctx.edgeData?.sourceEndpoint);
  const targetEndpoint = normalizeEndpoint(ctx.edgeData?.targetEndpoint);
  let svg = "";
  if (sourceEndpoint !== null) {
    svg += buildEndpointLabelSvg(
      sourceEndpoint,
      sourceLabelPos.x,
      sourceLabelPos.y,
      ctx.renderOptions
    );
  }
  if (targetEndpoint !== null) {
    svg += buildEndpointLabelSvg(
      targetEndpoint,
      targetLabelPos.x,
      targetLabelPos.y,
      ctx.renderOptions
    );
  }
  return svg;
}

/**
 * Render a loop edge (self-referencing) to SVG
 */
function renderLoopEdge(ctx: EdgeRenderContext, sourceNode: Node, loopIndex: number): string {
  const rect = getNodeRect(sourceNode, ctx.renderOptions.nodeIconSize);
  const { loop: loopLabelOffset } = resolveEdgeLabelOffsets(ctx.edgeData, ctx.renderOptions);

  const { path, sourceLabelPos, targetLabelPos } = buildLoopEdgePath(
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    loopIndex,
    loopLabelOffset
  );

  let svg = `<g class="export-edge loop-edge" data-id="${escapeXml(ctx.edgeId)}">`;
  svg += `<path d="${path}" fill="none" stroke="${ctx.strokeColor}" `;
  svg += `stroke-width="${EDGE_STYLE.strokeWidth}" opacity="${EDGE_STYLE.opacity}"/>`;
  svg += buildEdgeLabels(ctx, sourceLabelPos, targetLabelPos);
  svg += `</g>`;
  return svg;
}

function resolveRegularEdgeAnchors(
  ctx: EdgeRenderContext,
  sourceNode: Node,
  targetNode: Node
): { sourceAnchor?: InterfaceAnchor; targetAnchor?: InterfaceAnchor } {
  const sourceEndpoint = normalizeEndpoint(ctx.edgeData?.sourceEndpoint);
  const targetEndpoint = normalizeEndpoint(ctx.edgeData?.targetEndpoint);
  return {
    sourceAnchor:
      sourceEndpoint !== null
        ? ctx.interfaceAnchors?.get(sourceNode.id)?.get(sourceEndpoint)
        : undefined,
    targetAnchor:
      targetEndpoint !== null
        ? ctx.interfaceAnchors?.get(targetNode.id)?.get(targetEndpoint)
        : undefined
  };
}

function buildRegularEdgePath(
  points: { sx: number; sy: number; tx: number; ty: number },
  parallelInfo: { index: number; total: number; isCanonicalDirection: boolean } | undefined,
  useVisualDirection: boolean
): { path: string; controlPoint: { x: number; y: number } | null } {
  const isCanonicalDirection = useVisualDirection
    ? isVisuallyCanonicalDirection(points.sx, points.sy, points.tx, points.ty)
    : (parallelInfo?.isCanonicalDirection ?? true);
  const controlPoint = calculateControlPoint(
    points.sx,
    points.sy,
    points.tx,
    points.ty,
    parallelInfo?.index ?? 0,
    parallelInfo?.total ?? 1,
    isCanonicalDirection,
    CONTROL_POINT_STEP_SIZE
  );
  const path = controlPoint
    ? `M ${points.sx} ${points.sy} Q ${controlPoint.x} ${controlPoint.y} ${points.tx} ${points.ty}`
    : `M ${points.sx} ${points.sy} L ${points.tx} ${points.ty}`;
  return { path, controlPoint };
}

/**
 * Render a regular edge (between two different nodes) to SVG
 */
function renderRegularEdge(
  ctx: EdgeRenderContext,
  sourceNode: Node,
  targetNode: Node,
  parallelInfo: { index: number; total: number; isCanonicalDirection: boolean } | undefined
): string {
  const sourceRect = getNodeRect(sourceNode, ctx.renderOptions.nodeIconSize);
  const targetRect = getNodeRect(targetNode, ctx.renderOptions.nodeIconSize);
  const { sourceAnchor, targetAnchor } = resolveRegularEdgeAnchors(ctx, sourceNode, targetNode);
  const points = resolveEdgePointsWithInterfaceAnchors(
    sourceRect,
    targetRect,
    sourceAnchor,
    targetAnchor
  );
  const { path, controlPoint } = buildRegularEdgePath(
    points,
    parallelInfo,
    ctx.renderOptions.telemetryStyleLabels &&
      sourceAnchor !== undefined &&
      targetAnchor !== undefined
  );

  let svg = `<g class="export-edge" data-id="${escapeXml(ctx.edgeId)}">`;
  svg += `<path d="${path}" fill="none" stroke="${ctx.strokeColor}" `;
  svg += `stroke-width="${EDGE_STYLE.strokeWidth}" opacity="${EDGE_STYLE.opacity}"/>`;
  const { sourceLabelPos, targetLabelPos } = getRegularEdgeLabelPositions(
    ctx,
    points,
    controlPoint,
    sourceAnchor,
    targetAnchor
  );
  svg += buildEdgeLabels(ctx, sourceLabelPos, targetLabelPos);
  svg += `</g>`;
  return svg;
}

/**
 * Render a single edge to SVG
 */
function edgeToSvg(
  edge: Edge,
  nodeMap: Map<string, Node>,
  edgeInfo: EdgeInfo,
  includeLabels: boolean,
  interfaceAnchors: NodeInterfaceAnchorMap | undefined,
  renderOptions: ResolvedEdgeRenderOptions
): string {
  const sourceNode = nodeMap.get(edge.source);
  if (!sourceNode) return "";

  const edgeData = edge.data as TopologyEdgeData | undefined;
  const ctx: EdgeRenderContext = {
    edgeId: edge.id,
    strokeColor: getEdgeColor(edgeData?.linkStatus),
    edgeData,
    includeLabels,
    renderOptions,
    interfaceAnchors
  };

  // Handle loop edges (self-referencing)
  if (edge.source === edge.target) {
    const loopData = edgeInfo.getLoopInfo(edge.id);
    return renderLoopEdge(ctx, sourceNode, loopData?.loopIndex ?? 0);
  }

  // Handle regular edges
  const targetNode = nodeMap.get(edge.target);
  if (!targetNode) return "";

  const parallelInfo = edgeInfo.getParallelInfo(edge.id) ?? undefined;
  return renderRegularEdge(ctx, sourceNode, targetNode, parallelInfo);
}

// ============================================================================
// Batch Renderer
// ============================================================================

/**
 * Render all edges to SVG
 * Filters out edges connected to annotation nodes
 */
export function renderEdgesToSvg(
  edges: Edge[],
  nodes: Node[],
  includeLabels: boolean,
  annotationNodeTypes?: Set<string>,
  renderOptions?: EdgeSvgRenderOptions
): string {
  const resolvedRenderOptions = resolveEdgeRenderOptions(renderOptions);
  const skipTypes =
    annotationNodeTypes ??
    new Set(["free-text-annotation", "free-shape-annotation", "group-annotation"]);

  // Build node map for position lookup
  const nodeMap = new Map<string, Node>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Filter edges - exclude those connected to annotation nodes
  const validEdges = edges.filter((edge) => {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode) return false;
    if (skipTypes.has(sourceNode.type ?? "")) return false;
    if (targetNode && skipTypes.has(targetNode.type ?? "")) return false;
    return true;
  });

  // Build edge info for parallel/loop detection (same grouping/ordering as the canvas)
  const edgeInfo = buildEdgeInfo(validEdges);
  const interfaceAnchors = resolvedRenderOptions.telemetryStyleLabels
    ? buildInterfaceAnchorMap(validEdges, nodeMap, resolvedRenderOptions)
    : undefined;

  let svg = "";
  for (const edge of validEdges) {
    svg += edgeToSvg(
      edge,
      nodeMap,
      edgeInfo,
      includeLabels,
      interfaceAnchors,
      resolvedRenderOptions
    );
  }

  return svg;
}
