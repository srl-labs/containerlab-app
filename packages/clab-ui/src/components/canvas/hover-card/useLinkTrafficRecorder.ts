/**
 * Records the traffic of every link while the lab is deployed, so a link's
 * hover card shows its recent traffic at once instead of starting empty.
 */
import { useEffect } from "react";
import type { Edge } from "@xyflow/react";

import type { InterfaceStatsPayload } from "../../../core/types/topology";
import { useGraphStore } from "../../../stores/graphStore";
import { linkTrafficKey, recordTrafficSample } from "../../../utils/trafficHistory";

function statsOf(extraData: unknown, key: string): InterfaceStatsPayload | undefined {
  if (typeof extraData !== "object" || extraData === null) return undefined;
  const stats: unknown = Reflect.get(extraData, key);
  return typeof stats === "object" && stats !== null ? (stats as InterfaceStatsPayload) : undefined;
}

function recordEdges(edges: readonly Edge[]): void {
  for (const edge of edges) {
    const data = edge.data ?? {};
    const source = statsOf(data.extraData, "clabSourceStats");
    const target = statsOf(data.extraData, "clabTargetStats");
    if (source) recordTrafficSample(linkTrafficKey("a", edge.source, String(data.sourceEndpoint ?? "")), source);
    if (target) recordTrafficSample(linkTrafficKey("b", edge.target, String(data.targetEndpoint ?? "")), target);
  }
}

export function useLinkTrafficRecorder(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;
    recordEdges(useGraphStore.getState().edges);
    // One update can pass through several states; record the one it settles on, as the canvas draws it.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useGraphStore.subscribe((state, previous) => {
      if (state.edges === previous.edges || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        recordEdges(useGraphStore.getState().edges);
      }, 0);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled]);
}
