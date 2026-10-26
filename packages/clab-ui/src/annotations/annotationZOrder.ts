/**
 * Stacking order of annotations (groups, text, shapes, traffic rates), kept
 * in their `zIndex`, which the annotations file stores.
 */
import type { Node } from "@xyflow/react";

import {
  FREE_SHAPE_NODE_TYPE,
  GROUP_NODE_TYPE,
  isAnnotationNodeType
} from "./annotationNodeConverters";

export type ZOrderAction = "front" | "forward" | "backward" | "back";

/** Groups stay behind topology nodes (zIndex 0), so the nodes in them stay clickable. */
const GROUP_MAX_Z_INDEX = -1;

interface StackEntry {
  node: Node;
  index: number;
  z: number;
}

/** The zIndex an annotation renders with: groups and shapes default behind topology nodes. */
function annotationZIndex(node: Node): number {
  if (typeof node.zIndex === "number") return node.zIndex;
  const data = node.data as { zIndex?: unknown } | undefined;
  if (typeof data?.zIndex === "number") return data.zIndex;
  return node.type === GROUP_NODE_TYPE || node.type === FREE_SHAPE_NODE_TYPE ? -1 : 0;
}

function bounds(node: Node): { left: number; top: number; right: number; bottom: number } {
  const width = node.measured?.width ?? node.width ?? 0;
  const height = node.measured?.height ?? node.height ?? 0;
  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + width,
    bottom: node.position.y + height
  };
}

function overlaps(left: Node, right: Node): boolean {
  const a = bounds(left);
  const b = bounds(right);
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Annotations from bottom to top: by zIndex, then by their order in the graph. */
function stackOf(nodes: readonly Node[]): StackEntry[] {
  return nodes
    .map((node, index) => ({ node, index, z: annotationZIndex(node) }))
    .filter((entry) => isAnnotationNodeType(entry.node.type))
    .sort((left, right) => left.z - right.z || left.index - right.index);
}

/**
 * New zIndex values for the annotations `ids` after a stacking change, by id.
 * Front and back move them above or below every other annotation; forward
 * and backward past the next annotation they overlap. Empty when nothing
 * changes.
 */
export function computeAnnotationZOrder(
  nodes: readonly Node[],
  ids: ReadonlySet<string>,
  action: ZOrderAction
): Map<string, number> {
  const stack = stackOf(nodes);
  const moving = stack.filter((entry) => ids.has(entry.node.id));
  const others = stack.filter((entry) => !ids.has(entry.node.id));
  const next = new Map<string, number>();
  if (moving.length === 0 || others.length === 0) return next;

  if (action === "front") {
    const top = Math.max(...others.map((entry) => entry.z));
    moving.forEach((entry, offset) => next.set(entry.node.id, top + 1 + offset));
  } else if (action === "back") {
    const bottom = Math.min(...others.map((entry) => entry.z));
    moving.forEach((entry, offset) => next.set(entry.node.id, bottom - moving.length + offset));
  } else {
    const position = (entry: StackEntry) => stack.indexOf(entry);
    for (const entry of moving) {
      const candidates = others.filter((other) =>
        action === "forward" ? position(other) > position(entry) : position(other) < position(entry)
      );
      const past =
        action === "forward"
          ? candidates.find((other) => overlaps(other.node, entry.node))
          : candidates.reverse().find((other) => overlaps(other.node, entry.node));
      if (past) next.set(entry.node.id, past.z + (action === "forward" ? 1 : -1));
    }
  }

  for (const entry of moving) {
    const z = next.get(entry.node.id);
    if (z === undefined) continue;
    const clamped = entry.node.type === GROUP_NODE_TYPE ? Math.min(z, GROUP_MAX_Z_INDEX) : z;
    if (clamped === entry.z) next.delete(entry.node.id);
    else next.set(entry.node.id, clamped);
  }
  return next;
}

/** The nodes with new zIndex values applied to both the node and its data. */
export function applyAnnotationZOrder(nodes: Node[], zIndexes: ReadonlyMap<string, number>): Node[] {
  if (zIndexes.size === 0) return nodes;
  return nodes.map((node) => {
    const zIndex = zIndexes.get(node.id);
    return zIndex === undefined ? node : { ...node, zIndex, data: { ...node.data, zIndex } };
  });
}
