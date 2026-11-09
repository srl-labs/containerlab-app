// Edge-to-SVG conversion for export.
import type { Node, Edge } from "@xyflow/react";

import {
  getEdgePoints,
  calculateControlPoint,
  getLabelPosition,
  getNodeIntersection,
  isVisuallyCanonicalDirection
} from "../../canvas/edgeGeometry";
import {
  DEFAULT_NODE_BOX_SPACING,
  DEFAULT_NODE_STYLE,
  getNodeConnectionRect,
  type NodeBoxSpacing,
  type NodeStyle
} from "../../canvas/nodeBox";
import {
  DEFAULT_LINK_CURVATURE,
  DEFAULT_LINK_STYLE,
  getElbowLoopPolyline,
  parseLinkCurvature,
  type ElbowRoute,
  type LinkStyle
} from "../../canvas/elbowRouting";
import {
  ELBOW_CORNER_RADIUS,
  buildElbowPath,
  computeLinkRoutes,
  estimateLabelLength,
  getBubbleLength,
  getLinkPortGap,
  getNodeNameClearance,
  placeRouteBubbles,
  placeRouteLabels,
  type ElbowLabelInput,
  type RouteLabelPlacements
} from "../../canvas/edges/elbowLinkLayout";
import type { EdgeInfo } from "../../../stores/canvasStore";
// Despite the hook-style name, useEdgeInfo is a plain cached function
// (no React state) and is safe to call outside of components.
import { useEdgeInfo as buildEdgeInfo } from "../../../stores/canvasStore";
import { DEFAULT_ENDPOINT_LABEL_OFFSET } from "../../../annotations/endpointLabelOffset";
import { mix, toOpaqueHex } from "../../../theme/themeColor";
import {
  INTERFACE_SELECT_AUTO,
  resolveTelemetryInterfaceLabel
} from "../../../utils/telemetryInterfaceLabels";

import {
  NODE_ICON_SIZE,
  EDGE_COLOR,
  EDGE_STYLE,
  EDGE_LABEL,
  ROUTED_EDGE_STYLE,
  TELEMETRY_EDGE_LABEL,
  CONTROL_POINT_STEP_SIZE,
  escapeXml,
  resolveCssColor
} from "./constants";
import { canvasFontFamily, measureTextWidth } from "./textMetrics";

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
  /** Boxed nodes attach links to the box outline instead of the icon. */
  nodeStyle?: NodeStyle;
  nodeBoxSpacing?: NodeBoxSpacing;
  /** Elbow and curved links follow the same routes as on the canvas. */
  linkStyle?: LinkStyle;
  linkCurvature?: number;
  /**
   * Color behind the links. Elbow and curved links blend into it and cut a gap
   * in it where they cross other links; without it they are see-through.
   */
  linkBackground?: string;
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

/** Where an endpoint label goes; labels on elbow and curved links turn to read along them. */
interface LabelPosition {
  x: number;
  y: number;
  /** Degrees */
  rotation?: number;
}

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
  nodeStyle: NodeStyle;
  nodeBoxSpacing: NodeBoxSpacing;
  linkStyle: LinkStyle;
  linkCurvature: number;
  /** `#rrggbb`, or null when the links sit on a transparent background */
  linkBackground: string | null;
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
    nodeStyle: renderOptions?.nodeStyle ?? DEFAULT_NODE_STYLE,
    nodeBoxSpacing: renderOptions?.nodeBoxSpacing ?? DEFAULT_NODE_BOX_SPACING,
    linkStyle: renderOptions?.linkStyle ?? DEFAULT_LINK_STYLE,
    linkCurvature: parseLinkCurvature(renderOptions?.linkCurvature) ?? DEFAULT_LINK_CURVATURE,
    linkBackground: toOpaqueHex(renderOptions?.linkBackground),
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

/** Rect links attach to: the icon, or the box around it in the boxed style. */
function getNodeLinkRect(node: Node, renderOptions: ResolvedEdgeRenderOptions): NodeRect {
  const { nodeIconSize, nodeStyle, nodeBoxSpacing } = renderOptions;
  return getNodeConnectionRect(
    getNodeRect(node, nodeIconSize),
    nodeStyle,
    nodeIconSize,
    nodeBoxSpacing
  );
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
  renderOptions: ResolvedEdgeRenderOptions,
  vectorsByNode: Map<string, Map<string, EndpointVector>>
): void {
  if (sourceEndpoint === null && targetEndpoint === null) return;
  if (edge.source === edge.target) return;

  const sourceNode = nodeMap.get(edge.source);
  const targetNode = nodeMap.get(edge.target);
  if (!sourceNode || !targetNode) return;

  const sourceCenter = getRectCenter(getNodeLinkRect(sourceNode, renderOptions));
  const targetCenter = getRectCenter(getNodeLinkRect(targetNode, renderOptions));
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
  renderOptions: ResolvedEdgeRenderOptions
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
      renderOptions,
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
    renderOptions
  );
  const anchorsByNode: NodeInterfaceAnchorMap = new Map();
  for (const [nodeId, endpoints] of endpointsByNode) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const rect = getNodeLinkRect(node, renderOptions);
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
  svg += `font-family='${escapeXml(canvasFontFamily(TELEMETRY_EDGE_LABEL.fontFamily))}' `;
  svg += `dominant-baseline="central" `;
  svg += `fill="${TELEMETRY_EDGE_LABEL.color}" text-anchor="middle" `;
  svg += `stroke="${TELEMETRY_EDGE_LABEL.textStrokeColor}" stroke-width="${metrics.textStrokeWidth}" `;
  svg += `paint-order="stroke" stroke-linejoin="round">`;
  svg += escapeXml(metrics.text);
  svg += `</text>`;

  svg += `</g>`;
  return svg;
}

/** Default-style pill metrics. Matches the canvas EndpointLabel default variant. */
function getDefaultLabelMetrics(
  text: string,
  renderOptions: ResolvedEdgeRenderOptions
): { fontSize: number; fontFamily: string; bgWidth: number; bgHeight: number } {
  const { interfaceScale } = renderOptions;
  const fontSize = Math.max(8, EDGE_LABEL.fontSize * interfaceScale);
  const paddingX = Math.max(2, EDGE_LABEL.paddingX * interfaceScale);
  const fontFamily = canvasFontFamily(EDGE_LABEL.fontFamily);
  const textWidth = measureTextWidth(text, {
    fontFamily,
    fontSizePx: fontSize,
    fontWeight: "400"
  });
  return {
    fontSize,
    fontFamily,
    bgWidth: textWidth + paddingX * 2,
    bgHeight: fontSize * EDGE_LABEL.lineHeight
  };
}

/**
 * Build SVG for a default-style endpoint label (rounded pill + full text).
 * Matches the canvas EndpointLabel default variant (TopologyEdge.tsx).
 */
function buildDefaultEndpointLabelSvg(
  text: string,
  x: number,
  y: number,
  renderOptions: ResolvedEdgeRenderOptions,
  rotation = 0
): string {
  if (!text) return "";

  const { fontSize, fontFamily, bgWidth, bgHeight } = getDefaultLabelMetrics(text, renderOptions);

  const transform = rotation !== 0 ? ` transform="rotate(${rotation} ${x} ${y})"` : "";
  let svg = `<g class="edge-label"${transform}>`;

  svg += `<rect x="${x - bgWidth / 2}" y="${y - bgHeight / 2}" width="${bgWidth}" height="${bgHeight}" `;
  svg += `fill="${renderOptions.defaultLabelBackground}" rx="${EDGE_LABEL.borderRadius}" ry="${EDGE_LABEL.borderRadius}"/>`;

  svg += `<text x="${x}" y="${y}" `;
  svg += `font-size="${fontSize}" `;
  svg += `font-family='${escapeXml(fontFamily)}' `;
  svg += `dominant-baseline="central" `;
  svg += `fill="${renderOptions.defaultLabelForeground}" text-anchor="middle">`;
  svg += escapeXml(text);
  svg += `</text>`;

  svg += `</g>`;
  return svg;
}

function buildEndpointLabelSvg(
  endpoint: string,
  position: LabelPosition,
  renderOptions: ResolvedEdgeRenderOptions
): string {
  const { x, y } = position;
  const text = resolveDisplayInterfaceLabel(endpoint, renderOptions);
  if (renderOptions.telemetryStyleLabels) {
    return buildTelemetryEndpointLabelSvg(text, x, y, renderOptions.interfaceScale);
  }
  return buildDefaultEndpointLabelSvg(text, x, y, renderOptions, position.rotation);
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
  start: { x: number; y: number };
  end: { x: number; y: number };
  controlPoints: [{ x: number; y: number }, { x: number; y: number }];
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
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
    controlPoints: [
      { x: cp1X, y: cp1Y },
      { x: cp2X, y: cp2Y }
    ],
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
  /** Elbow or curve routes of the links between two different nodes */
  routes?: Map<string, ElbowRoute>;
}

/**
 * Build the edge labels SVG if enabled
 */
function buildEdgeLabels(
  ctx: EdgeRenderContext,
  sourceLabelPos: LabelPosition,
  targetLabelPos: LabelPosition
): string {
  if (!ctx.includeLabels) return "";
  const sourceEndpoint = normalizeEndpoint(ctx.edgeData?.sourceEndpoint);
  const targetEndpoint = normalizeEndpoint(ctx.edgeData?.targetEndpoint);
  let svg = "";
  if (sourceEndpoint !== null) {
    svg += buildEndpointLabelSvg(sourceEndpoint, sourceLabelPos, ctx.renderOptions);
  }
  if (targetEndpoint !== null) {
    svg += buildEndpointLabelSvg(targetEndpoint, targetLabelPos, ctx.renderOptions);
  }
  return svg;
}

/** A loop, drawn as a rounded rectangle with elbow links and as a curve otherwise. */
function resolveLoopGeometry(ctx: EdgeRenderContext, sourceNode: Node, loopIndex: number) {
  const rect = getNodeLinkRect(sourceNode, ctx.renderOptions);
  const { loop: labelOffset } = resolveEdgeLabelOffsets(ctx.edgeData, ctx.renderOptions);
  if (ctx.renderOptions.linkStyle === "elbow") {
    const points = getElbowLoopPolyline(rect, loopIndex, LOOP_EDGE_SIZE);
    const labelX = points[1].x;
    const centerY = rect.y + rect.height / 2;
    return {
      path: buildElbowPath(points),
      start: points[0],
      end: points[points.length - 1],
      bends: points.slice(1, -1),
      shape: "elbow" as const,
      sourceLabelPos: { x: labelX, y: centerY - labelOffset },
      targetLabelPos: { x: labelX, y: centerY + labelOffset }
    };
  }
  const loop = buildLoopEdgePath(rect.x, rect.y, rect.width, rect.height, loopIndex, labelOffset);
  return {
    path: loop.path,
    start: loop.start,
    end: loop.end,
    bends: loop.controlPoints,
    shape: "plain" as const,
    sourceLabelPos: loop.sourceLabelPos,
    targetLabelPos: loop.targetLabelPos
  };
}

/**
 * Render a loop edge (self-referencing) to SVG
 */
function renderLoopEdge(ctx: EdgeRenderContext, sourceNode: Node, loopIndex: number): string {
  const { path, sourceLabelPos, targetLabelPos } = resolveLoopGeometry(ctx, sourceNode, loopIndex);
  let svg = `<g class="export-edge loop-edge" data-id="${escapeXml(ctx.edgeId)}">`;
  svg += buildEdgePathSvg(ctx, path);
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

/** Path and label positions of a regular edge, in flow coordinates. */
function resolveRegularEdgeGeometry(
  ctx: EdgeRenderContext,
  sourceNode: Node,
  targetNode: Node,
  parallelInfo: { index: number; total: number; isCanonicalDirection: boolean } | undefined
) {
  const sourceRect = getNodeLinkRect(sourceNode, ctx.renderOptions);
  const targetRect = getNodeLinkRect(targetNode, ctx.renderOptions);
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
  const { sourceLabelPos, targetLabelPos } = getRegularEdgeLabelPositions(
    ctx,
    points,
    controlPoint,
    sourceAnchor,
    targetAnchor
  );
  return { points, path, controlPoint, sourceAnchor, targetAnchor, sourceLabelPos, targetLabelPos };
}

// ============================================================================
// Elbow and Curved Links
// ============================================================================

/** Plain label metrics, as the canvas estimates how far a label reaches along its link. */
function getRouteLabelMetrics(renderOptions: ResolvedEdgeRenderOptions): {
  fontSize: number;
  horizontalPadding: number;
} {
  const { interfaceScale } = renderOptions;
  return {
    fontSize: Math.max(8, EDGE_LABEL.fontSize * interfaceScale),
    horizontalPadding: Math.max(2, EDGE_LABEL.paddingX * interfaceScale)
  };
}

function getRouteLabelInput(
  endpoint: unknown,
  renderOptions: ResolvedEdgeRenderOptions
): ElbowLabelInput {
  const normalized = normalizeEndpoint(endpoint);
  const text = normalized === null ? "" : resolveDisplayInterfaceLabel(normalized, renderOptions);
  return { text, ...getRouteLabelMetrics(renderOptions) };
}

/** How far an endpoint label reaches along its link. Matches TopologyEdge.tsx. */
function measureRouteLabel(endpoint: unknown, renderOptions: ResolvedEdgeRenderOptions): number {
  const label = getRouteLabelInput(endpoint, renderOptions);
  if (!label.text) return 0;
  if (renderOptions.telemetryStyleLabels) {
    return getBubbleLength(getTelemetryLabelMetrics(label.text, renderOptions.interfaceScale).radius);
  }
  return estimateLabelLength(label);
}

/** The canvas routes for elbow and curved links; none for straight links. */
function computeExportRoutes(
  edges: Edge[],
  nodes: Node[],
  renderOptions: ResolvedEdgeRenderOptions,
  includeLabels: boolean
): Map<string, ElbowRoute> | undefined {
  if (renderOptions.linkStyle === "straight") return undefined;
  const labelHeight = renderOptions.telemetryStyleLabels
    ? TELEMETRY_EDGE_LABEL.minRadius * 2 * renderOptions.interfaceScale
    : getRouteLabelMetrics(renderOptions).fontSize * EDGE_LABEL.lineHeight;
  return computeLinkRoutes(
    edges,
    nodes,
    (node) => getNodeLinkRect(node, renderOptions),
    (edge) => {
      if (!includeLabels) return { source: 0, target: 0 };
      const data = edge.data as TopologyEdgeData | undefined;
      return {
        source: measureRouteLabel(data?.sourceEndpoint, renderOptions),
        target: measureRouteLabel(data?.targetEndpoint, renderOptions)
      };
    },
    {
      portGap: getLinkPortGap(labelHeight),
      bottomClearance: getNodeNameClearance(renderOptions.nodeStyle === "boxed"),
      curvature: renderOptions.linkCurvature
    },
    renderOptions.linkStyle === "curve"
  );
}

/** Endpoint labels along a route, placed as the canvas places them. */
function placeRoutedLabels(ctx: EdgeRenderContext, route: ElbowRoute): RouteLabelPlacements {
  const { renderOptions, edgeData } = ctx;
  if (renderOptions.telemetryStyleLabels) {
    return placeRouteBubbles(route, resolveEdgeLabelOffsets(edgeData, renderOptions));
  }
  return placeRouteLabels(
    route,
    {
      source: getRouteLabelInput(edgeData?.sourceEndpoint, renderOptions),
      target: getRouteLabelInput(edgeData?.targetEndpoint, renderOptions)
    },
    getNodeNameClearance(renderOptions.nodeStyle === "boxed"),
    renderOptions.linkStyle === "curve"
  );
}

interface EdgeStroke {
  color: string;
  width: number;
  opacity: number;
  /** Background-colored outline drawn under the link */
  casing?: { color: string; width: number };
}

/**
 * Elbow and curved links are solid: the link color blended into the
 * background, outlined in it. On a transparent background they are
 * see-through instead, which looks the same where links do not cross.
 */
function getEdgeStroke(ctx: EdgeRenderContext): EdgeStroke {
  const { linkStyle, linkBackground } = ctx.renderOptions;
  if (linkStyle === "straight") {
    return { color: ctx.strokeColor, width: EDGE_STYLE.strokeWidth, opacity: EDGE_STYLE.opacity };
  }
  const width = ROUTED_EDGE_STYLE.strokeWidth;
  if (linkBackground === null) {
    return { color: ctx.strokeColor, width, opacity: ROUTED_EDGE_STYLE.colorShare };
  }
  return {
    color: mix(ctx.strokeColor, linkBackground, 1 - ROUTED_EDGE_STYLE.colorShare),
    width,
    opacity: 1,
    casing: { color: linkBackground, width: width + ROUTED_EDGE_STYLE.casingWidth * 2 }
  };
}

function buildEdgePathSvg(ctx: EdgeRenderContext, path: string): string {
  const stroke = getEdgeStroke(ctx);
  let svg = "";
  if (stroke.casing) {
    svg += `<path d="${path}" fill="none" stroke="${stroke.casing.color}" `;
    svg += `stroke-width="${stroke.casing.width}"/>`;
  }
  svg += `<path d="${path}" fill="none" stroke="${stroke.color}" `;
  svg += `stroke-width="${stroke.width}" opacity="${stroke.opacity}"/>`;
  return svg;
}

/** Path and label positions of an edge between two different nodes. */
function resolveEdgeGeometry(
  ctx: EdgeRenderContext,
  sourceNode: Node,
  targetNode: Node,
  parallelInfo: { index: number; total: number; isCanonicalDirection: boolean } | undefined
) {
  const route = ctx.routes?.get(ctx.edgeId);
  if (route) {
    const labels = placeRoutedLabels(ctx, route);
    return {
      path: buildElbowPath(route.points, route.cornerRadius),
      start: route.points[0],
      end: route.points[route.points.length - 1],
      points: route.points,
      shape: ctx.renderOptions.linkStyle === "curve" ? ("curve" as const) : ("elbow" as const),
      cornerRadius: route.cornerRadius,
      // Ends sit on the ports the routes spread along each side.
      startPinned: true,
      endPinned: true,
      sourceLabelPos: labels.source,
      targetLabelPos: labels.target
    };
  }
  const geometry = resolveRegularEdgeGeometry(ctx, sourceNode, targetNode, parallelInfo);
  return {
    path: geometry.path,
    start: { x: geometry.points.sx, y: geometry.points.sy },
    end: { x: geometry.points.tx, y: geometry.points.ty },
    points: geometry.controlPoint ? [geometry.controlPoint] : [],
    shape: "plain" as const,
    cornerRadius: 0,
    startPinned: geometry.sourceAnchor !== undefined,
    endPinned: geometry.targetAnchor !== undefined,
    sourceLabelPos: geometry.sourceLabelPos,
    targetLabelPos: geometry.targetLabelPos
  };
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
  const { path, sourceLabelPos, targetLabelPos } = resolveEdgeGeometry(
    ctx,
    sourceNode,
    targetNode,
    parallelInfo
  );

  let svg = `<g class="export-edge" data-id="${escapeXml(ctx.edgeId)}">`;
  svg += buildEdgePathSvg(ctx, path);
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
  routes: Map<string, ElbowRoute> | undefined,
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
    interfaceAnchors,
    routes
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

/** Edges to draw, with what their geometry needs. Edges of annotation nodes are left out. */
function prepareEdges(
  edges: Edge[],
  nodes: Node[],
  annotationNodeTypes: Set<string> | undefined,
  resolvedRenderOptions: ResolvedEdgeRenderOptions,
  includeLabels: boolean
) {
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
  // Elbow and curved links place telemetry bubbles on their own ports instead.
  const routes = computeExportRoutes(validEdges, nodes, resolvedRenderOptions, includeLabels);
  const interfaceAnchors =
    resolvedRenderOptions.telemetryStyleLabels && !routes
      ? buildInterfaceAnchorMap(validEdges, nodeMap, resolvedRenderOptions)
      : undefined;

  return { validEdges, nodeMap, edgeInfo, interfaceAnchors, routes };
}

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
  const { validEdges, nodeMap, edgeInfo, interfaceAnchors, routes } = prepareEdges(
    edges,
    nodes,
    annotationNodeTypes,
    resolvedRenderOptions,
    includeLabels
  );

  let svg = "";
  for (const edge of validEdges) {
    svg += edgeToSvg(
      edge,
      nodeMap,
      edgeInfo,
      includeLabels,
      interfaceAnchors,
      routes,
      resolvedRenderOptions
    );
  }

  return svg;
}

// ============================================================================
// Edge Layout
// ============================================================================

/** An endpoint label: where it sits and how it looks. */
export interface EndpointLabelLayout {
  text: string;
  /** Center, in flow coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** A rounded pill with the full name, or a telemetry-style bubble. */
  shape: "pill" | "bubble";
  fontSize: number;
  bold: boolean;
  color: string;
  background: string;
  outline?: string;
  outlineWidth?: number;
  /** Degrees; labels on elbow and curved links turn to read along them. */
  rotation: number;
}

/** An edge in flow coordinates, for exports that draw edges themselves. */
export interface EdgeLayout {
  id: string;
  source: string;
  target: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
  /**
   * How the path runs through `bends`. A plain link curves around its one
   * control point, if it has one. An elbow link runs straight from bend to
   * bend with rounded corners. A curved link passes smoothly near its bends.
   */
  shape: "plain" | "elbow" | "curve";
  /** Corner radius of an elbow link */
  cornerRadius: number;
  /** Points the path bends around: none for a straight link. */
  bends: { x: number; y: number }[];
  /** Whether an end sits at a fixed point, instead of wherever it meets the node outline. */
  startPinned: boolean;
  endPinned: boolean;
  labels: EndpointLabelLayout[];
}

function layoutEndpointLabel(
  endpoint: unknown,
  { rotation = 0, ...position }: LabelPosition,
  renderOptions: ResolvedEdgeRenderOptions
): EndpointLabelLayout | null {
  const normalized = normalizeEndpoint(endpoint);
  if (normalized === null) return null;
  const text = resolveDisplayInterfaceLabel(normalized, renderOptions);
  if (renderOptions.telemetryStyleLabels) {
    const metrics = getTelemetryLabelMetrics(text, renderOptions.interfaceScale);
    if (!metrics.text) return null;
    return {
      text: metrics.text,
      ...position,
      width: metrics.radius * 2,
      height: metrics.radius * 2,
      shape: "bubble",
      fontSize: metrics.fontSize,
      bold: true,
      // The canvas outlines white text. Without outlines, the outline color is what stays readable.
      color: TELEMETRY_EDGE_LABEL.textStrokeColor,
      background: TELEMETRY_EDGE_LABEL.backgroundColor,
      outline: TELEMETRY_EDGE_LABEL.outlineColor,
      outlineWidth: TELEMETRY_EDGE_LABEL.bubbleStrokeWidth,
      rotation: 0
    };
  }
  if (!text) return null;
  const { fontSize, bgWidth, bgHeight } = getDefaultLabelMetrics(text, renderOptions);
  return {
    text,
    ...position,
    width: bgWidth,
    height: bgHeight,
    shape: "pill",
    fontSize,
    bold: false,
    color: renderOptions.defaultLabelForeground,
    background: renderOptions.defaultLabelBackground,
    rotation
  };
}

// Room between the points kept from a curve, so the exported link stays easy to edit.
const CURVE_BEND_SPACING = 12;

/** Every few points of a traced curve: drawn smoothly, they still follow it closely. */
function thinCurve(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const kept: { x: number; y: number }[] = [];
  let last = points[0];
  for (const point of points.slice(1, -1)) {
    if (Math.hypot(point.x - last.x, point.y - last.y) < CURVE_BEND_SPACING) continue;
    kept.push(point);
    last = point;
  }
  return kept;
}

function layoutEdge(
  edge: Edge,
  sourceNode: Node,
  nodeMap: Map<string, Node>,
  edgeInfo: EdgeInfo,
  ctx: EdgeRenderContext
): Pick<
  EdgeLayout,
  "start" | "end" | "shape" | "cornerRadius" | "bends" | "startPinned" | "endPinned"
> & {
  sourceLabelPos: LabelPosition;
  targetLabelPos: LabelPosition;
} | null {
  if (edge.source === edge.target) {
    const loop = resolveLoopGeometry(ctx, sourceNode, edgeInfo.getLoopInfo(edge.id)?.loopIndex ?? 0);
    return {
      start: loop.start,
      end: loop.end,
      shape: loop.shape,
      cornerRadius: loop.shape === "elbow" ? ELBOW_CORNER_RADIUS : 0,
      bends: loop.bends,
      startPinned: true,
      endPinned: true,
      sourceLabelPos: loop.sourceLabelPos,
      targetLabelPos: loop.targetLabelPos
    };
  }

  const targetNode = nodeMap.get(edge.target);
  if (!targetNode) return null;
  const geometry = resolveEdgeGeometry(
    ctx,
    sourceNode,
    targetNode,
    edgeInfo.getParallelInfo(edge.id) ?? undefined
  );
  let bends = geometry.points;
  if (geometry.shape === "elbow") bends = geometry.points.slice(1, -1);
  if (geometry.shape === "curve") bends = thinCurve(geometry.points);
  return {
    start: geometry.start,
    end: geometry.end,
    shape: geometry.shape,
    cornerRadius: geometry.cornerRadius,
    bends,
    startPinned: geometry.startPinned,
    endPinned: geometry.endPinned,
    sourceLabelPos: geometry.sourceLabelPos,
    targetLabelPos: geometry.targetLabelPos
  };
}

/** The same paths and labels as renderEdgesToSvg, as data. */
export function layoutEdges(
  edges: Edge[],
  nodes: Node[],
  includeLabels: boolean,
  annotationNodeTypes?: Set<string>,
  renderOptions?: EdgeSvgRenderOptions
): EdgeLayout[] {
  const resolved = resolveEdgeRenderOptions(renderOptions);
  const { validEdges, nodeMap, edgeInfo, interfaceAnchors, routes } = prepareEdges(
    edges,
    nodes,
    annotationNodeTypes,
    resolved,
    includeLabels
  );

  const layouts: EdgeLayout[] = [];
  for (const edge of validEdges) {
    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode) continue;
    const edgeData = edge.data as TopologyEdgeData | undefined;
    const ctx: EdgeRenderContext = {
      edgeId: edge.id,
      strokeColor: getEdgeColor(edgeData?.linkStatus),
      edgeData,
      includeLabels,
      renderOptions: resolved,
      interfaceAnchors,
      routes
    };
    const geometry = layoutEdge(edge, sourceNode, nodeMap, edgeInfo, ctx);
    if (!geometry) continue;
    const { sourceLabelPos, targetLabelPos, ...path } = geometry;
    const labels = includeLabels
      ? [
          layoutEndpointLabel(edgeData?.sourceEndpoint, sourceLabelPos, resolved),
          layoutEndpointLabel(edgeData?.targetEndpoint, targetLabelPos, resolved)
        ].filter((label) => label !== null)
      : [];
    const stroke = getEdgeStroke(ctx);
    layouts.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      strokeColor: stroke.color,
      strokeWidth: stroke.width,
      opacity: stroke.opacity,
      labels,
      ...path
    });
  }
  return layouts;
}
