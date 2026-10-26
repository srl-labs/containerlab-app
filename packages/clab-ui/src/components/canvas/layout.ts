/**
 * Layout algorithms for React Flow topology viewer
 */
export type { LayoutName, LayoutOptions } from "./layout/types";
export { normalizeLayoutableNodePositions } from "./layout/types";

import type { Node, Edge } from "@xyflow/react";
import type { LayoutName, LayoutOptions } from "./layout/types";
import { applyForceLayout } from "./layout/forceLayout";
import { applyRadialLayout } from "./layout/radialLayout";

/**
 * Unified layout dispatcher — always returns Promise<{ nodes, edges }>.
 * Callers never need to branch on layout name or unwrap different return shapes.
 */
export async function applyLayout(
  name: LayoutName,
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  switch (name) {
    case "auto": {
      // ELK is most of the TopoViewer's code; load it only for the auto layout.
      const { applyAutoLayout } = await import("./layout/autoLayout");
      return applyAutoLayout(nodes, edges, options);
    }
    case "radial":
      return applyRadialLayout(nodes, edges, options);
    case "force":
      return { nodes: applyForceLayout(nodes, edges, options), edges };
    case "preset":
    case "geo":
    default:
      // These layouts return nodes immediately or are unknown (treated as preset)
      return { nodes, edges };
  }
}
