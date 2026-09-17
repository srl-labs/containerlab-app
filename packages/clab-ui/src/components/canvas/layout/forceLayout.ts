/**
 * Force-directed layout using d3-force.
 * Handles: full-graph force layout, mesh component force layout, and
 * pure-star analytic placement.
 */
import type { Node, Edge } from "@xyflow/react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceRadial
} from "d3-force";
import { isLayoutableNode, applyPositionMap } from "./types";
import type { SimNode, SimLink, LayoutOptions } from "./types";
import { orderRing } from "./graphAnalysis";

/**
 * Run a mini force simulation on a subset of nodes and return their positions.
 * Used for mesh components that don't suit hierarchical layout.
 */
export function forceLayoutComponent(
  componentIds: string[],
  componentEdges: Edge[],
  adj: Map<string, string[]>,
  isRing: boolean,
  centerX: number,
  centerY: number,
  nodeSpacing: number
): Map<string, { x: number; y: number }> {
  const n = componentIds.length;

  // For rings, walk traversal order so initial circular placement has no crossings.
  // For other mesh types crossings are unavoidable (non-planar), so order doesn't matter.
  const orderedIds = isRing ? orderRing(componentIds, adj) : componentIds;

  // Place nodes on a circle as initial positions for stable, symmetric results
  const radius = Math.max(nodeSpacing * n / (2 * Math.PI), nodeSpacing);
  const simNodes: SimNode[] = orderedIds.map((id, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2; // start at top
    return {
      id,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
      width: 50,
      height: 50
    };
  });

  const idSet = new Set(componentIds);
  const simLinks: SimLink[] = componentEdges
    .filter(e => idSet.has(e.source) && idSet.has(e.target))
    .map(e => ({ source: e.source, target: e.target }));

  const simulation = forceSimulation<SimNode>(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance(nodeSpacing * 1.2)
        .strength(0.8)
    )
    .force("charge", forceManyBody<SimNode>().strength(-400).distanceMax(nodeSpacing * 6))
    .force("center", forceCenter<SimNode>(centerX, centerY))
    .force("collision", forceCollide<SimNode>().radius(nodeSpacing / 2).strength(0.9))
    .force("radial", isRing ? forceRadial<SimNode>(radius, centerX, centerY).strength(0.6) : null)
    .stop();

  for (let i = 0; i < 400; i++) simulation.tick();

  const positions = new Map<string, { x: number; y: number }>();
  for (const sn of simNodes) positions.set(sn.id, { x: sn.x, y: sn.y });
  return positions;
}

/**
 * Place a pure star component analytically: hub at center, leaves evenly on a ring.
 * No simulation — O(n), deterministic, hub is always perfectly centered.
 */
export function starPlaceComponent(
  component: string[],
  adj: Map<string, string[]>,
  centerX: number,
  centerY: number,
  nodeSpacing: number
): Map<string, { x: number; y: number }> {
  // Hub = node with the highest degree (= n-1 for a pure star)
  const hub = component.reduce((best, id) =>
    (adj.get(id)?.length ?? 0) > (adj.get(best)?.length ?? 0) ? id : best
  );
  const leaves = component.filter(id => id !== hub);

  // Radius: spread leaves so each gets ~nodeSpacing of arc, minimum 1.5×spacing
  const leafCount = leaves.length;
  const radius = Math.max(nodeSpacing * leafCount / (2 * Math.PI), nodeSpacing * 1.5);

  const positions = new Map<string, { x: number; y: number }>();
  positions.set(hub, { x: centerX, y: centerY });

  leaves.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / leafCount - Math.PI / 2; // start at top
    positions.set(id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    });
  });

  return positions;
}

/**
 * Apply force-directed layout using d3-force to all layoutable nodes.
 */
export function applyForceLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): Node[] {
  const { padding = 50, nodeSpacing = 100 } = options;

  if (nodes.length === 0) return nodes;

  // Filter out annotation nodes (groups, free text, free shapes)
  const layoutNodes = nodes.filter(isLayoutableNode);
  if (layoutNodes.length === 0) return nodes;

  // Create simulation nodes with deterministic initial positions
  const simNodes: SimNode[] = layoutNodes.map((node, index) => ({
    id: node.id,
    x: node.position.x || (index * 50) % 500,
    y: node.position.y || Math.floor(index / 10) * 50,
    width: 50,
    height: 50
  }));

  // Create simulation links
  const nodeIds = new Set(simNodes.map((n) => n.id));
  const simLinks: SimLink[] = edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      source: edge.source,
      target: edge.target
    }));

  // Calculate center
  const centerX = 400;
  const centerY = 300;

  // Create force simulation
  const simulation = forceSimulation<SimNode>(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance(nodeSpacing * 1.5)
        .strength(0.5)
    )
    .force(
      "charge",
      forceManyBody<SimNode>()
        .strength(-300)
        .distanceMax(nodeSpacing * 5)
    )
    .force("center", forceCenter<SimNode>(centerX, centerY))
    .force(
      "collision",
      forceCollide<SimNode>()
        .radius(nodeSpacing / 2)
        .strength(0.7)
    )
    .stop();

  // Run simulation synchronously
  for (let i = 0; i < 300; i++) simulation.tick();

  // Create node map for position updates
  const nodePositions = new Map<string, { x: number; y: number }>();
  for (const simNode of simNodes) {
    nodePositions.set(simNode.id, {
      x: simNode.x + padding,
      y: simNode.y + padding
    });
  }

  return applyPositionMap(nodes, nodePositions);
}
