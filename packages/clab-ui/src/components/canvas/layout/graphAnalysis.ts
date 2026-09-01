/**
 * Graph analysis utilities: component discovery, topology classification,
 * and ring ordering. These are shared between AutoLayout and RadialLayout.
 */
import type { Edge } from "@xyflow/react";

/**
 * Classify a connected component's topology.
 *
 * Returns "hierarchical" for topologies that have a clear top-down structure
 * (star, spine-leaf, tree, chain) — these go through BFS layering + ELK.
 *
 * Returns "mesh" for symmetric topologies where all nodes have equal degree
 * and the graph has cycles (full mesh, ring, grid, torus, etc.) — these are
 * routed to force-directed layout instead.
 *
 * Detection rules:
 *   - Single node or two nodes: always hierarchical (trivial).
 *   - Ring: every node degree == 2, edgeCount == nodeCount.
 *   - Full mesh (clique): edgeCount == n*(n-1)/2.
 *   - Uniform-degree mesh: all degrees equal AND degree >= 2 AND has at least
 *     one cycle (edgeCount > nodeCount - 1). Covers grids, partial meshes, etc.
 *   - Everything else: hierarchical.
 */
export function classifyComponent(
  component: string[],
  adj: Map<string, string[]>,
  componentEdgeCount: number
): "hierarchical" | "mesh" | "star" | "ring" {
  const n = component.length;
  if (n <= 2) return "hierarchical";

  const { minDeg, maxDeg } = getDegreeRange(component, adj);
  const allSameDegree = minDeg === maxDeg;

  // Ring: every node has degree 2, exactly n edges
  if (allSameDegree && minDeg === 2 && componentEdgeCount === n) return "ring";

  // Full mesh (clique): n*(n-1)/2 edges
  if (componentEdgeCount === (n * (n - 1)) / 2) return "mesh";

  // Uniform-degree mesh with cycles (grids, partial meshes, etc.)
  // A tree has exactly n-1 edges — anything more means cycles exist.
  if (allSameDegree && minDeg >= 2 && componentEdgeCount > n - 1) return "mesh";

  // Pure star: exactly one hub (degree n-1), all others are leaves (degree 1).
  // ELK squashes these into a single wide horizontal row.
  // Radial placement (hub at center, leaves on ring) is the canonical solution.
  if (minDeg === 1 && maxDeg === n - 1 && componentEdgeCount === n - 1) return "star";

  return "hierarchical";
}

/** Min/max node degree across a component in a single pass. */
function getDegreeRange(
  component: string[],
  adj: Map<string, string[]>
): { minDeg: number; maxDeg: number } {
  let minDeg = Infinity;
  let maxDeg = -Infinity;
  for (const id of component) {
    const degree = (adj.get(id) ?? []).length;
    if (degree < minDeg) minDeg = degree;
    if (degree > maxDeg) maxDeg = degree;
  }
  return { minDeg, maxDeg };
}

/**
 * Largest value mapped to any of the given ids (missing ids count as 0).
 * Single pass — avoids `Math.max(...array)` spread limits on large components.
 */
export function getMaxMappedValue(ids: string[], values: Map<string, number>): number {
  let max = 0;
  for (const id of ids) {
    const value = values.get(id) ?? 0;
    if (value > max) max = value;
  }
  return max;
}

/**
 * Walk a ring in traversal order starting from componentIds[0].
 * Returns the same IDs reordered so adjacent entries are connected,
 * which ensures the circular initial placement has no crossing edges.
 */
export function orderRing(componentIds: string[], adj: Map<string, string[]>): string[] {
  const ordered: string[] = [componentIds[0]];
  const visited = new Set([componentIds[0]]);
  while (ordered.length < componentIds.length) {
    const cur = ordered[ordered.length - 1];
    const next = (adj.get(cur) ?? []).find(nb => !visited.has(nb));
    if (!next) break;
    ordered.push(next);
    visited.add(next);
  }
  return ordered;
}

/**
 * Build an undirected adjacency list from a set of nodes and edges.
 */
export function buildAdjacency(
  nodeIds: Set<string>,
  edges: Edge[]
): { adj: Map<string, string[]>; topoEdges: Edge[] } {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  const topoEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  for (const e of topoEdges) {
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
  }
  return { adj, topoEdges };
}

/**
 * Flood-fill BFS to find all nodes in the same connected component as startId.
 */
export function findComponent(startId: string, adj: Map<string, string[]>): string[] {
  const component: string[] = [];
  const queue = [startId];
  let head = 0;
  const seen = new Set([startId]);
  while (head < queue.length) {
    const cur = queue[head++];
    component.push(cur);
    for (const nb of adj.get(cur) ?? []) {
      if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
    }
  }
  return component;
}
