import type { Edge, Node, XYPosition } from "@xyflow/react";

import { nodesToAnnotations } from "../../../annotations";
import {
  TRAFFIC_RATE_NODE_TYPE,
  trafficRateToNode
} from "../../../annotations/annotationNodeConverters";
import { AUTO_CREATED_TRAFFIC_RATE_LABEL } from "../../../annotations/constants";
import type { TrafficRateAnnotation } from "../../../core/types/topology";

const TRAFFIC_RATE_WIDTH = 50;
const TRAFFIC_RATE_HEIGHT = 30;
const DEFAULT_NODE_SIZE = 40;

interface AutoCreateEndpoint {
  nodeId: string;
  interfaceName: string;
  position: XYPosition;
}

export interface TrafficRateAnnotationAutoCreateResult {
  nodes: Node[];
  createdCount: number;
  removedCount: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asFinitePositiveNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function getNodeDimension(node: Node, key: "width" | "height"): number {
  const direct = asFinitePositiveNumber(node[key]);
  if (direct !== null) return direct;
  const fromData = asFinitePositiveNumber(asRecord(node.data)[key]);
  return fromData ?? DEFAULT_NODE_SIZE;
}

function getNodeCenter(node: Node | undefined): XYPosition | null {
  if (!node) return null;
  return {
    x: node.position.x + getNodeDimension(node, "width") / 2,
    y: node.position.y + getNodeDimension(node, "height") / 2
  };
}

function interpolatePoint(source: XYPosition, target: XYPosition, ratio: number): XYPosition {
  return {
    x: source.x + (target.x - source.x) * ratio,
    y: source.y + (target.y - source.y) * ratio
  };
}

function endpointKey(nodeId: string, interfaceName: string): string {
  return `${nodeId}\u0000${interfaceName}`;
}

function slug(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "endpoint";
}

function createUniqueTrafficRateId(
  nodeId: string,
  interfaceName: string,
  usedIds: Set<string>
): string {
  const baseId = `traffic-rate-${slug(nodeId)}-${slug(interfaceName)}`;
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }

  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const candidate = `${baseId}-${suffix}`;
    if (usedIds.has(candidate)) continue;
    usedIds.add(candidate);
    return candidate;
  }

  const fallback = `${baseId}-${Date.now()}`;
  usedIds.add(fallback);
  return fallback;
}

function createTrafficRateAnnotation(endpoint: AutoCreateEndpoint, usedIds: Set<string>) {
  const id = createUniqueTrafficRateId(endpoint.nodeId, endpoint.interfaceName, usedIds);
  const annotation: TrafficRateAnnotation = {
    id,
    label: AUTO_CREATED_TRAFFIC_RATE_LABEL,
    nodeId: endpoint.nodeId,
    interfaceName: endpoint.interfaceName,
    mode: "text",
    textMetric: "tx",
    position: {
      x: endpoint.position.x - TRAFFIC_RATE_WIDTH / 2,
      y: endpoint.position.y - TRAFFIC_RATE_HEIGHT / 2
    },
    width: TRAFFIC_RATE_WIDTH,
    height: TRAFFIC_RATE_HEIGHT,
    backgroundOpacity: 20,
    borderWidth: 0,
    borderRadius: 4
  };
  return trafficRateToNode(annotation);
}

function collectMissingEndpoints(nodes: Node[], edges: Edge[]): AutoCreateEndpoint[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const existingEndpoints = new Set(
    nodesToAnnotations(nodes).trafficRateAnnotations.flatMap((annotation) => {
      const nodeId = asNonEmptyString(annotation.nodeId);
      const interfaceName = asNonEmptyString(annotation.interfaceName);
      return nodeId !== null && interfaceName !== null ? [endpointKey(nodeId, interfaceName)] : [];
    })
  );
  const queuedEndpoints = new Set<string>();
  const missingEndpoints: AutoCreateEndpoint[] = [];

  for (const edge of edges) {
    const data = asRecord(edge.data);
    const sourceEndpoint = asNonEmptyString(data.sourceEndpoint);
    const targetEndpoint = asNonEmptyString(data.targetEndpoint);
    if (sourceEndpoint === null || targetEndpoint === null) continue;

    const sourceCenter = getNodeCenter(nodeById.get(edge.source));
    const targetCenter = getNodeCenter(nodeById.get(edge.target));
    if (sourceCenter === null || targetCenter === null) continue;

    const endpoints = [
      {
        nodeId: edge.source,
        interfaceName: sourceEndpoint,
        position: interpolatePoint(sourceCenter, targetCenter, 0.35)
      },
      {
        nodeId: edge.target,
        interfaceName: targetEndpoint,
        position: interpolatePoint(sourceCenter, targetCenter, 0.65)
      }
    ];

    for (const endpoint of endpoints) {
      const key = endpointKey(endpoint.nodeId, endpoint.interfaceName);
      if (existingEndpoints.has(key) || queuedEndpoints.has(key)) continue;
      queuedEndpoints.add(key);
      missingEndpoints.push(endpoint);
    }
  }

  return missingEndpoints;
}

export function ensureTrafficRateAnnotationsForLinks(
  nodes: Node[],
  edges: Edge[]
): TrafficRateAnnotationAutoCreateResult {
  const missingEndpoints = collectMissingEndpoints(nodes, edges);
  if (missingEndpoints.length === 0) {
    return { nodes, createdCount: 0, removedCount: 0 };
  }

  const usedIds = new Set(nodes.map((node) => node.id));
  const createdNodes = missingEndpoints.map((endpoint) =>
    createTrafficRateAnnotation(endpoint, usedIds)
  );

  return {
    nodes: [...nodes, ...createdNodes],
    createdCount: createdNodes.length,
    removedCount: 0
  };
}

function isAutoCreatedTrafficRateNode(node: Node): boolean {
  return (
    node.type === TRAFFIC_RATE_NODE_TYPE &&
    asRecord(node.data).label === AUTO_CREATED_TRAFFIC_RATE_LABEL
  );
}

function removeAutoCreatedTrafficRateAnnotations(
  nodes: Node[]
): TrafficRateAnnotationAutoCreateResult {
  const filteredNodes = nodes.filter((node) => !isAutoCreatedTrafficRateNode(node));
  const removedCount = nodes.length - filteredNodes.length;
  return {
    nodes: removedCount > 0 ? filteredNodes : nodes,
    createdCount: 0,
    removedCount
  };
}

export function syncRateLabelAnnotationsForLinks(
  nodes: Node[],
  edges: Edge[],
  showRateLabels: boolean
): TrafficRateAnnotationAutoCreateResult {
  return showRateLabels
    ? ensureTrafficRateAnnotationsForLinks(nodes, edges)
    : removeAutoCreatedTrafficRateAnnotations(nodes);
}
