/**
 * Shared types and utilities for layout algorithms
 */
import type { Node } from "@xyflow/react";
import type { SimulationNodeDatum, SimulationLinkDatum } from "d3-force";

/**
 * Available layout types
 */
export type LayoutName = "preset" | "force" | "auto" | "geo" | "radial";

/**
 * Layout options
 */
export interface LayoutOptions {
  animate?: boolean;
  padding?: number;
  nodeSpacing?: number;
}

export interface LayoutPositionEntry {
  id: string;
  position: { x: number; y: number };
}

/**
 * D3 simulation node extending SimulationNodeDatum
 */
export interface SimNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/**
 * D3 simulation link
 */
export interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
}

/**
 * Node types that participate in layout algorithms
 */
const LAYOUTABLE_NODE_TYPES = ["topology-node", "network-node"];

/**
 * Check if a node should be included in layout
 */
export function isLayoutableNode(node: Node): boolean {
  return LAYOUTABLE_NODE_TYPES.includes(node.type ?? "");
}

/**
 * Apply a position map to nodes, returning updated nodes.
 */
export function applyPositionMap(
  nodes: Node[],
  positions: Map<string, { x: number; y: number }>
): Node[] {
  if (positions.size === 0) return nodes;
  return nodes.map((node) => {
    const newPos = positions.get(node.id);
    if (!newPos) return node;
    return { ...node, position: newPos };
  });
}

/**
 * Normalize generated layout positions for all layoutable nodes.
 *
 * The returned nodes and positions intentionally use the same coordinates so
 * host snapshots do not snap the graph back to a slightly different layout.
 */
export function normalizeLayoutableNodePositions(
  nodes: Node[],
  normalizePosition: (position: { x: number; y: number }) => { x: number; y: number }
): { nodes: Node[]; positions: LayoutPositionEntry[] } {
  const positions: LayoutPositionEntry[] = [];
  const normalizedNodes = nodes.map((node) => {
    if (!isLayoutableNode(node)) return node;
    const normalizedPosition = normalizePosition(node.position);
    const position = { x: normalizedPosition.x, y: normalizedPosition.y };
    positions.push({ id: node.id, position });
    if (position.x === node.position.x && position.y === node.position.y) return node;
    return { ...node, position };
  });

  return { nodes: normalizedNodes, positions };
}

/**
 * Check if layoutable nodes have preset positions (non-zero coordinates)
 */
export function hasPresetPositions(nodes: Node[]): boolean {
  const layoutNodes = nodes.filter(isLayoutableNode);
  if (layoutNodes.length === 0) return false;
  return layoutNodes.some((node) => node.position.x !== 0 || node.position.y !== 0);
}
