/**
 * Hierarchical radial (balloon) layout.
 *
 * For each connected component:
 *   - The highest-degree node becomes the center (depth 0).
 *   - BFS depth determines concentric ring radius.
 *   - Each node's angular wedge is proportional to its subtree leaf count,
 *     so wide stars spread their leaves evenly around the hub instead of
 *     collapsing into a single row like ELK layered does.
 *
 * Mesh components (ring/full-mesh/uniform-degree) are still handled by
 * forceLayoutComponent so rings stay circular and meshes stay symmetric.
 *
 * Returns the same {nodes, edges} shape as applyAutoLayout so callers
 * can use both interchangeably.
 */
import type { Node, Edge } from "@xyflow/react";
import { isLayoutableNode, applyPositionMap } from "./types";
import type { LayoutOptions } from "./types";
import {
  classifyComponent,
  buildAdjacency,
  findComponent,
  getMaxMappedValue
} from "./graphAnalysis";
import { forceLayoutComponent } from "./forceLayout";

export function applyRadialLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): { nodes: Node[]; edges: Edge[] } {
  const { padding = 80, nodeSpacing = 110 } = options;
  const ringSpacing = nodeSpacing * 1.4; // radial distance between depth rings

  const layoutNodes = nodes.filter(isLayoutableNode);
  if (layoutNodes.length === 0) return { nodes, edges };

  const nodeIds = new Set(layoutNodes.map((n) => n.id));
  const { adj, topoEdges } = buildAdjacency(nodeIds, edges);

  const degree = new Map<string, number>();
  for (const [id, nb] of adj) degree.set(id, nb.length);

  const positions = new Map<string, { x: number; y: number }>();
  const layerMap = new Map<string, number>();
  const meshNodeIds = new Set<string>();

  // We'll stack components horizontally with a running cursor.
  let cursorX = padding;

  // --- Connected component discovery ---
  const visited = new Set<string>();
  for (const startId of nodeIds) {
    if (visited.has(startId)) continue;

    const component = findComponent(startId, adj);
    for (const id of component) visited.add(id);

    const compSet = new Set(component);
    const compEdges = topoEdges.filter(e => compSet.has(e.source) && compSet.has(e.target));
    const edgeCount = compEdges.length;
    const n = component.length;

    // --- Classify: mesh or hierarchical? ---
    const topology = classifyComponent(component, adj, edgeCount);

    if (topology === "mesh" || topology === "ring") {
      // Mesh → force layout on a circle, same as ELK path
      for (const id of component) meshNodeIds.add(id);
      const isRing = topology === "ring";
      const radius = Math.max(nodeSpacing * n / (2 * Math.PI), nodeSpacing * 1.5);
      const cx = cursorX + radius + padding;
      const cy = padding + radius;
      const compPositions = forceLayoutComponent(
        component, compEdges, adj, isRing, cx, cy, nodeSpacing
      );
      for (const [id, pos] of compPositions) {
        positions.set(id, pos);
        layerMap.set(id, -1);
      }
      cursorX += radius * 2 + nodeSpacing * 2;
      continue;
    }

    // --- Hierarchical radial layout ---
    // 1. Pick root: highest-degree node; ties broken by first in component order.
    const root = component.reduce((best, id) =>
      (degree.get(id) ?? 0) > (degree.get(best) ?? 0) ? id : best
    );

    // 2. BFS to build parent map and depth map.
    const depth = new Map<string, number>();
    const parent = new Map<string, string | null>();
    const children = new Map<string, string[]>();
    for (const id of component) children.set(id, []);
    depth.set(root, 0);
    parent.set(root, null);
    const bfsQ = [root];
    const bfsOrder: string[] = [];
    const bfsVisited = new Set([root]);
    while (bfsQ.length > 0) {
      const cur = bfsQ.shift()!;
      bfsOrder.push(cur);
      for (const nb of adj.get(cur) ?? []) {
        if (!bfsVisited.has(nb)) {
          bfsVisited.add(nb);
          depth.set(nb, (depth.get(cur) ?? 0) + 1);
          parent.set(nb, cur);
          children.get(cur)!.push(nb);
          bfsQ.push(nb);
        }
      }
    }

    // Record depth in shared layerMap
    for (const id of component) layerMap.set(id, depth.get(id) ?? 0);

    // 3. Compute subtree leaf count (bottom-up) — determines wedge size.
    const leafCount = new Map<string, number>();
    for (const id of [...bfsOrder].reverse()) {
      const ch = children.get(id) ?? [];
      if (ch.length === 0) {
        leafCount.set(id, 1); // leaf counts as 1
      } else {
        leafCount.set(id, ch.reduce((s, c) => s + (leafCount.get(c) ?? 1), 0));
      }
    }

    // 4. Assign angular wedge recursively (top-down).
    // Root gets full 2π. Each child gets a slice proportional to its leaf count.
    const wedgeStart = new Map<string, number>();
    const wedgeEnd = new Map<string, number>();
    const angle = new Map<string, number>();
    wedgeStart.set(root, 0);
    wedgeEnd.set(root, 2 * Math.PI);
    angle.set(root, 0); // root sits at center, angle irrelevant

    // Estimate component bounding radius for cursor advance
    const maxDepth = getMaxMappedValue(component, depth);
    const compRadius = maxDepth * ringSpacing + nodeSpacing;

    const cx = cursorX + compRadius + padding;
    const cy = padding + compRadius;

    for (const id of bfsOrder) {
      const ch = children.get(id) ?? [];
      if (ch.length === 0) continue;
      const start = wedgeStart.get(id) ?? 0;
      const end = wedgeEnd.get(id) ?? 2 * Math.PI;
      const span = end - start;
      const total = leafCount.get(id) ?? 1;
      let cursor = start;
      for (const child of ch) {
        const childLeaves = leafCount.get(child) ?? 1;
        const childSpan = span * (childLeaves / total);
        wedgeStart.set(child, cursor);
        wedgeEnd.set(child, cursor + childSpan);
        // Place child at the midpoint of its wedge
        angle.set(child, cursor + childSpan / 2);
        cursor += childSpan;
      }
    }

    // 5. Convert (depth, angle) → Cartesian coordinates.
    for (const id of component) {
      if (id === root) {
        positions.set(id, { x: cx, y: cy });
      } else {
        const d = depth.get(id) ?? 1;
        const a = angle.get(id) ?? 0;
        const r = d * ringSpacing;
        positions.set(id, {
          x: cx + r * Math.cos(a - Math.PI / 2), // -π/2 so depth-1 starts at top
          y: cy + r * Math.sin(a - Math.PI / 2)
        });
      }
    }

    cursorX += compRadius * 2 + nodeSpacing * 2;
  }

  // Stamp layer metadata and topology type on nodes/edges
  const laidNodes = applyPositionMap(nodes, positions).map((node) => {
    if (!isLayoutableNode(node)) return node;
    const l = layerMap.get(node.id) ?? 0;
    return { ...node, data: { ...node.data, layer: l } };
  });

  const laidEdges = edges.map((edge) => {
    const isMeshEdge = meshNodeIds.has(edge.source) || meshNodeIds.has(edge.target);
    return { ...edge, data: { ...edge.data, topologyType: isMeshEdge ? "mesh" : "hierarchical" } };
  });

  return { nodes: laidNodes, edges: laidEdges };
}
