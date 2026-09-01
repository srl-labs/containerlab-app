/**
 * ELK-based hierarchical (layered) layout — the "auto" layout.
 *
 * Layer assignment is purely structural:
 *   - Highest-degree node per connected component becomes the root (layer 0)
 *   - BFS shortest-path distance from root determines each node's layer
 *   - Pure leaves (all neighbors at shallower layers) are pushed one layer deeper
 * ELK then handles x-positioning within each layer to minimize edge crossings.
 * Disconnected components are placed separately.
 *
 * Mesh/ring/uniform-degree components are detected and routed to force-directed
 * layout instead, so they render as natural symmetric shapes rather than
 * collapsing into a single row or arbitrary hierarchy.
 */
import type { Node, Edge } from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import { isLayoutableNode, applyPositionMap } from "./types";
import type { LayoutOptions } from "./types";
import {
  classifyComponent,
  buildAdjacency,
  findComponent,
  getMaxMappedValue
} from "./graphAnalysis";
import { forceLayoutComponent, starPlaceComponent } from "./forceLayout";

const elk = new ELK();

export async function applyAutoLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const { padding = 80, nodeSpacing = 100 } = options;

  const layoutNodes = nodes.filter(isLayoutableNode);
  if (layoutNodes.length === 0) return { nodes, edges };

  const nodeIds = new Set(layoutNodes.map((n) => n.id));
  const nodeMap = new Map(layoutNodes.map(n => [n.id, n]));

  const elkNodes = layoutNodes.map((node) => ({
    id: node.id,
    width: node.measured?.width ?? 60,
    height: node.measured?.height ?? 60
  }));

  const { adj, topoEdges } = buildAdjacency(nodeIds, edges);

  const degree = new Map<string, number>();
  for (const [id, neighbors] of adj) degree.set(id, neighbors.length);

  // Find connected components and classify each as hierarchical or mesh.
  // Mesh components are collected for later force-layout placement.
  // Hierarchical components get BFS layer assignments for ELK.
  const layer = new Map<string, number>();
  const componentOf = new Map<string, number>();
  const meshNodeIds = new Set<string>();

  // Store mesh components to position after ELK runs (so we know ELK's bounds)
  const pendingMeshComponents: Array<{
    component: string[];
    compEdges: Edge[];
    isRing: boolean;
    isStar: boolean;
  }> = [];

  let compId = 0;

  for (const startId of nodeIds) {
    if (componentOf.has(startId)) continue;

    const component = findComponent(startId, adj);
    for (const id of component) componentOf.set(id, compId);
    compId++;

    // Count edges within this component (each undirected edge counted once)
    const compSet = new Set(component);
    const compEdges = topoEdges.filter(e => compSet.has(e.source) && compSet.has(e.target));
    const componentEdgeCount = compEdges.length;

    const topology = classifyComponent(component, adj, componentEdgeCount);

    if (topology === "star") {
      // Pure star → hub at center, leaves on ring (deterministic, no simulation)
      for (const id of component) meshNodeIds.add(id);
      pendingMeshComponents.push({ component, compEdges, isRing: false, isStar: true });
    } else if (topology === "mesh" || topology === "ring") {
      const isRing = topology === "ring";
      for (const id of component) meshNodeIds.add(id);
      pendingMeshComponents.push({ component, compEdges, isRing, isStar: false });
    } else {
      // Hierarchical: assign layers via BFS, will go through ELK

      // Determine roots for this component using a connectivity-aware heuristic:
      // 1. Find "core" nodes (those with the maximum degree).
      // 2. Identify "upstream" roots: network-nodes connected to a core but with lower degree.
      //    (e.g., a macvlan cloud connected to a spine).
      // 3. If upstream nodes exist, they become the roots. Otherwise, the cores themselves are roots.
      const maxDeg = getMaxMappedValue(component, degree);
      const cores = new Set(component.filter(id => (degree.get(id) ?? 0) === maxDeg));

      const upstreamRoots = component.filter(id => {
        const node = nodeMap.get(id);
        if (node?.type !== "network-node") return false;

        const deg = degree.get(id) ?? 0;
        // A hub/bridge with max degree is a core, not an upstream tap.
        if (deg >= maxDeg && maxDeg > 0) return false;

        // Must be connected to at least one core node to be considered "upstream" of it.
        return (adj.get(id) ?? []).some(nbId => cores.has(nbId));
      });

      const roots = upstreamRoots.length > 0 ? upstreamRoots : Array.from(cores);

      // BFS from multiple roots — shortest-path distance becomes the layer.
      // This allows peer nodes (like multiple spines) to stay on the same layer.
      for (const id of component) layer.set(id, -1);
      for (const rId of roots) layer.set(rId, 0);
      const bfsQ = [...roots];
      let bfsHead = 0;
      while (bfsHead < bfsQ.length) {
        const cur = bfsQ[bfsHead++];
        const curLayer = layer.get(cur)!;
        for (const nb of adj.get(cur) ?? []) {
          if (layer.get(nb) === -1) {
            layer.set(nb, curLayer + 1);
            bfsQ.push(nb);
          }
        }
      }

      // Post-pass: push a node one layer deeper if ALL its neighbors are at
      // shallower layers — it's a pure leaf with no downstream connections.
      for (const id of component) {
        const l = layer.get(id)!;
        const neighbors = adj.get(id) ?? [];
        if (neighbors.length > 0 && neighbors.every((nb) => (layer.get(nb) ?? 0) < l)) {
          layer.set(id, l + 1);
        }
      }
    }
  }

  // Build ELK graph from hierarchical nodes only (mesh nodes are positioned after)
  const elkHierarchicalNodes = elkNodes.filter(n => !meshNodeIds.has(n.id));

  // Only pass cross-layer edges to ELK — same-layer edges are excluded entirely
  // so ELK cannot use them to pull nodes into different layers. Cross-layer
  // edges are oriented shallow → deep so NETWORK_SIMPLEX layering agrees with
  // our pre-computed layer assignments.
  const elkEdges = topoEdges
    .filter((e) => {
      if (meshNodeIds.has(e.source) || meshNodeIds.has(e.target)) return false;
      const sL = layer.get(e.source) ?? 0;
      const tL = layer.get(e.target) ?? 0;
      return sL !== tL; // drop same-layer edges
    })
    .map((e) => {
      const sL = layer.get(e.source) ?? 0;
      const tL = layer.get(e.target) ?? 0;
      const [from, to] = sL < tL ? [e.source, e.target] : [e.target, e.source];
      return { id: e.id, sources: [from], targets: [to] };
    });

  // Pin each hierarchical node to its computed layer via layerChoiceConstraint (INTERACTIVE)
  const elkNodesWithLayers = elkHierarchicalNodes.map((n) => ({
    ...n,
    layoutOptions: {
      "elk.layered.layering.layerChoiceConstraint": String(layer.get(n.id) ?? 0)
    }
  }));

  const positions = new Map<string, { x: number; y: number }>();

  // Run ELK first so we know its bounding box before placing mesh components
  if (elkNodesWithLayers.length > 0) {
    const graph = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.layered.spacing.nodeNodeBetweenLayers": "80",
        "elk.spacing.nodeNode": "50",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.layering.strategy": "INTERACTIVE",
        "elk.separateConnectedComponents": "true",
        "elk.spacing.componentComponent": "80",
        "elk.padding": `[top=${padding}, left=${padding}, bottom=${padding}, right=${padding}]`
      },
      children: elkNodesWithLayers,
      edges: elkEdges
    };

    const laid = await elk.layout(graph);
    for (const n of laid.children ?? []) {
      if (n.x !== undefined && n.y !== undefined) {
        positions.set(n.id, { x: n.x, y: n.y });
      }
    }
  }

  // Place mesh components to the left of the ELK output, stacked vertically
  const meshStartX = padding;
  const meshStartY = padding;
  // If ELK produced output, shift it right to make room for mesh components on the left.
  // We don't know mesh width yet, so compute it first.
  let totalMeshWidth = 0;
  const meshRadii: number[] = pendingMeshComponents.map(({ component, isStar }) => {
    const n = component.length;
    // Stars use a ring of leaves; the others use full-circle mesh estimate
    if (isStar) {
      const leafCount = n - 1;
      return Math.max(nodeSpacing * leafCount / (2 * Math.PI), nodeSpacing * 1.5);
    }
    return Math.max(nodeSpacing * n / (2 * Math.PI), nodeSpacing * 1.5);
  });
  for (const r of meshRadii) totalMeshWidth = Math.max(totalMeshWidth, r * 2 + nodeSpacing * 2);

  // Shift ELK positions right if mesh components need space on the left
  if (pendingMeshComponents.length > 0 && positions.size > 0) {
    const shift = totalMeshWidth + nodeSpacing * 2;
    for (const [id, pos] of positions) {
      positions.set(id, { x: pos.x + shift, y: pos.y });
    }
  }

  // Now place each mesh component stacked vertically on the left
  let meshCursorY = meshStartY;
  for (let i = 0; i < pendingMeshComponents.length; i++) {
    const { component, compEdges, isRing, isStar } = pendingMeshComponents[i];
    const radius = meshRadii[i];
    const centerX = meshStartX + radius + padding;
    const centerY = meshCursorY + radius + padding;

    const compPositions = isStar
      ? starPlaceComponent(component, adj, centerX, centerY, nodeSpacing)
      : forceLayoutComponent(component, compEdges, adj, isRing, centerX, centerY, nodeSpacing);
    for (const [id, pos] of compPositions) {
      positions.set(id, pos);
    }

    meshCursorY += radius * 2 + nodeSpacing * 3;
  }

  // Stamp node.data.layer for hierarchical nodes (mesh nodes get layer -1 as sentinel)
  const laidNodes = applyPositionMap(nodes, positions).map((node) => {
    if (!isLayoutableNode(node)) return node;
    const l = meshNodeIds.has(node.id) ? -1 : (layer.get(node.id) ?? 0);
    return { ...node, data: { ...node.data, layer: l } };
  });

  // Stamp edge.data.topologyType based on whether both endpoints are in mesh components
  const laidEdges = edges.map((edge) => {
    const isMeshEdge = meshNodeIds.has(edge.source) || meshNodeIds.has(edge.target);
    return { ...edge, data: { ...edge.data, topologyType: isMeshEdge ? "mesh" : "hierarchical" } };
  });

  return { nodes: laidNodes, edges: laidEdges };
}
