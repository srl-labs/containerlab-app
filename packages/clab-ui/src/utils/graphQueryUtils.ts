/**
 * Graph Query Utilities
 * Helper functions to query nodes and edges in React Flow graphs.
 */
import type { TopoNode, TopoEdge } from "../core/types/graph";

/**
 * Runtime guard for TopoNode-like objects.
 */
export function isTopoNodeLike(value: unknown): value is TopoNode {
  if (typeof value !== "object" || value === null) return false;
  const id: unknown = Reflect.get(value, "id");
  const position: unknown = Reflect.get(value, "position");
  if (typeof id !== "string" || typeof position !== "object" || position === null) return false;
  const x: unknown = Reflect.get(position, "x");
  const y: unknown = Reflect.get(position, "y");
  return typeof x === "number" && typeof y === "number";
}

/**
 * Runtime guard for TopoEdge-like objects.
 */
export function isTopoEdgeLike(value: unknown): value is TopoEdge {
  if (typeof value !== "object" || value === null) return false;
  const id: unknown = Reflect.get(value, "id");
  const source: unknown = Reflect.get(value, "source");
  const target: unknown = Reflect.get(value, "target");
  return typeof id === "string" && typeof source === "string" && typeof target === "string";
}

/**
 * Identifies dummy endpoint nodes.
 *
 * Dummy endpoints are emitted as network nodes by the parser, either from a literal
 * `dummy*` endpoint or from a synthesized `dummyN` id for `type: dummy` links. Matching
 * on `nodeType` rather than the id prefix avoids catching topology nodes merely named
 * something like `dummy-router`.
 */
export function isDummyNode(node: { type?: string; data?: unknown }): boolean {
  if (node.type !== "network-node") return false;
  if (typeof node.data !== "object" || node.data === null) return false;
  return Reflect.get(node.data, "nodeType") === "dummy";
}

/** Collect the ids of every dummy endpoint node in the graph. */
export function collectDummyNodeIds(
  nodes: Array<{ id: string; type?: string; data?: unknown }>
): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (isDummyNode(node)) ids.add(node.id);
  }
  return ids;
}

/**
 * Stamp `hidden` on the dummy nodes themselves.
 *
 * Elements are flagged rather than removed: layout writes the rendered node array back to
 * the graph store, and annotation/group-membership payloads are rebuilt by walking that
 * store, so dropping nodes would delete them along with their annotations.
 */
export function markDummyNodesHidden<T extends { id: string }>(
  nodes: T[],
  dummyNodeIds: Set<string>,
  showDummyLinks: boolean
): T[] {
  if (dummyNodeIds.size === 0) return nodes;
  return nodes.map((node) =>
    dummyNodeIds.has(node.id) ? { ...node, hidden: !showDummyLinks } : node
  );
}

/**
 * Stamp `hidden` on every link with a dummy endpoint.
 *
 * React Flow does not cascade `hidden` from a node to its edges, so edges are stamped too.
 */
export function markDummyEdgesHidden<T extends { source: string; target: string }>(
  edges: T[],
  dummyNodeIds: Set<string>,
  showDummyLinks: boolean
): T[] {
  if (dummyNodeIds.size === 0) return edges;
  return edges.map((edge) =>
    dummyNodeIds.has(edge.source) || dummyNodeIds.has(edge.target)
      ? { ...edge, hidden: !showDummyLinks }
      : edge
  );
}

/**
 * Search nodes by a query string (matches id, label, kind, or role)
 * Case-insensitive substring matching
 */
export function searchNodes(nodes: TopoNode[], query: string): TopoNode[] {
  if (!query.trim()) return [];
  const lowerQuery = query.toLowerCase();

  return nodes.filter((node) => {
    // Check node ID
    if (node.id.toLowerCase().includes(lowerQuery)) return true;

    // Check node data properties based on node type
    const data = node.data as Record<string, unknown>;

    // Check label (common to all node types)
    const label = data.label;
    if (typeof label === "string" && label.toLowerCase().includes(lowerQuery)) return true;

    // Check topology-specific fields
    const role = data.role;
    if (typeof role === "string" && role.toLowerCase().includes(lowerQuery)) return true;

    const kind = data.kind;
    if (typeof kind === "string" && kind.toLowerCase().includes(lowerQuery)) return true;

    // Check network node type
    const nodeType = data.nodeType;
    if (typeof nodeType === "string" && nodeType.toLowerCase().includes(lowerQuery)) return true;

    return false;
  });
}

/**
 * Get the bounding box of selected nodes
 */
export function getNodesBoundingBox(
  nodes: TopoNode[]
): { x: number; y: number; width: number; height: number } | null {
  if (nodes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const { x, y } = node.position;
    const width = node.measured?.width ?? 100;
    const height = node.measured?.height ?? 100;

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}
