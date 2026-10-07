/**
 * Shared elbow routes for the canvas, and where elbow link labels go.
 */
import type { Edge, Node, XYPosition } from "@xyflow/react";

import type { NodeRect } from "../edgeGeometry";
import {
  buildRoundedPolylinePath,
  getElbowLoopPolyline,
  getPointAlongPolyline,
  getPolylineLength,
  routeElbowLinks,
  type ElbowRoute,
  type ElbowRouteOptions,
  type ElbowSide
} from "../elbowRouting";

const CORNER_RADIUS = 8;
// Room between the node, or the name under it, and the first label.
const LABEL_GAP = 3;
// Keep labels clear of the rounded bend at the end of their segment.
const BEND_MARGIN = CORNER_RADIUS;
const LABEL_CHAR_WIDTH_RATIO = 0.6;
// Room under an icon that the node name takes.
const NODE_NAME_HEIGHT = 16;

interface RouteCache {
  edgesRef: Edge[] | null;
  nodesRef: Node[] | null;
  key: string;
  routes: Map<string, ElbowRoute>;
}

let routeCache: RouteCache = { edgesRef: null, nodesRef: null, key: "", routes: new Map() };

/**
 * Routes depend on every link, so they are computed once per graph change and
 * shared by all links. `key` names everything else the routes depend on.
 */
export function getCachedElbowRoutes(
  edges: Edge[],
  nodes: Node[],
  getRect: (node: Node) => NodeRect,
  getLabelLengths: (edge: Edge) => { source: number; target: number },
  key: string,
  options: ElbowRouteOptions
): Map<string, ElbowRoute> {
  if (routeCache.edgesRef === edges && routeCache.nodesRef === nodes && routeCache.key === key) {
    return routeCache.routes;
  }
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const inputs = [];
  for (const edge of edges) {
    if (edge.hidden === true || edge.source === edge.target) continue;
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) continue;
    const labelLengths = getLabelLengths(edge);
    inputs.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceRect: getRect(sourceNode),
      targetRect: getRect(targetNode),
      sourceLabelLength: labelLengths.source,
      targetLabelLength: labelLengths.target
    });
  }
  const routes = routeElbowLinks(inputs, options);
  routeCache = { edgesRef: edges, nodesRef: nodes, key, routes };
  return routes;
}

/** Room kept under icons for the node name; boxed nodes hold the name inside. */
export function getNodeNameClearance(isBoxed: boolean): number {
  return isBoxed ? 0 : NODE_NAME_HEIGHT;
}

export function buildElbowPath(points: XYPosition[], cornerRadius = CORNER_RADIUS): string {
  return buildRoundedPolylinePath(points, cornerRadius);
}

export function buildElbowLoop(
  rect: NodeRect,
  loopIndex: number,
  size: number
): { path: string; labelX: number } {
  const points = getElbowLoopPolyline(rect, loopIndex, size);
  return { path: buildElbowPath(points), labelX: points[1].x };
}

export interface ElbowLabelPlacement {
  x: number;
  y: number;
  /** Degrees; labels on links that leave the top or bottom read along the link. */
  rotation: number;
}

export interface ElbowLabelInput {
  text: string;
  fontSize: number;
  horizontalPadding: number;
}

export function estimateLabelLength({ text, fontSize, horizontalPadding }: ElbowLabelInput): number {
  return text.length * fontSize * LABEL_CHAR_WIDTH_RATIO + horizontalPadding * 2;
}

/** How far a telemetry bubble reaches out from the node along its link. */
export function getBubbleLength(radius: number): number {
  return radius * 2 + 1;
}

/**
 * Put a plain label on the first run of the link, just past the node (and the
 * name under an icon), turned to read along the link. Labels on one side then
 * sit side by side at the port spacing instead of overlapping.
 */
export function placeElbowLabel(
  points: XYPosition[],
  side: ElbowSide,
  label: ElbowLabelInput,
  nameClearance: number
): ElbowLabelPlacement {
  const vertical = side === "top" || side === "bottom";
  const half = estimateLabelLength(label) / 2;
  const clearance = side === "bottom" ? nameClearance : 0;
  const wanted = clearance + LABEL_GAP + half;

  // Stay on the first run so the label does not wrap round a bend; a straight
  // link shares its length with the label at the other end.
  const firstRun = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const room = points.length > 2 ? firstRun - BEND_MARGIN : getPolylineLength(points) / 2;
  const distance = Math.max(Math.min(wanted, room - half), Math.min(half, room));
  const point = getPointAlongPolyline(points, distance);
  return { x: point.x, y: point.y, rotation: vertical ? -90 : 0 };
}

/** Telemetry bubbles sit right where the link leaves the node. */
export function placeElbowBubble(points: XYPosition[], offset: number): ElbowLabelPlacement {
  const point = getPointAlongPolyline(points, offset);
  return { x: point.x, y: point.y, rotation: 0 };
}
