// Bring annotations forward or send them back, saved to the annotations file with an undo entry.
import { useCallback } from "react";

import {
  applyAnnotationZOrder,
  computeAnnotationZOrder,
  type ZOrderAction
} from "../../annotations/annotationZOrder";
import { isAnnotationNodeType } from "../../annotations/annotationNodeConverters";
import { useTopologySessionClient } from "../../host";
import { saveAnnotationNodesFromGraph } from "../../services";
import { useGraphStore } from "../../stores/graphStore";

/** The annotations a stacking change applies to: the selection when it holds the target. */
export function zOrderTargets(targetId: string | undefined, selectedIds: Iterable<string>): string[] {
  const selected = new Set(selectedIds);
  for (const node of useGraphStore.getState().nodes) {
    if (node.selected === true && isAnnotationNodeType(node.type)) selected.add(node.id);
  }
  if (targetId === undefined) return [...selected];
  return selected.has(targetId) ? [...selected] : [targetId];
}

export function useAnnotationZOrder(
  isLocked: boolean,
  onLockedAction: () => void
): (ids: readonly string[], action: ZOrderAction) => void {
  const sessionClient = useTopologySessionClient();
  return useCallback(
    (ids, action) => {
      if (ids.length === 0) return;
      if (isLocked) {
        onLockedAction();
        return;
      }
      const { nodes, setNodes } = useGraphStore.getState();
      const zIndexes = computeAnnotationZOrder(nodes, new Set(ids), action);
      if (zIndexes.size === 0) return;
      const nextNodes = applyAnnotationZOrder(nodes, zIndexes);
      setNodes(nextNodes);
      // The graph already shows the new order; re-applying the snapshot would drop the selection.
      void saveAnnotationNodesFromGraph(sessionClient, nextNodes, { applySnapshot: false });
    },
    [isLocked, onLockedAction, sessionClient]
  );
}
