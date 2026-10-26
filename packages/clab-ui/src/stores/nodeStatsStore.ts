/**
 * Recent CPU and memory usage of the open lab's nodes, from the host's
 * `node-stats-update` messages.
 */
import { create } from "zustand";

import type { HostNodeStats, HostNodeStatsSample } from "../host/contracts";

/** Samples kept per node: two minutes at the default 2 s interval. */
const NODE_STATS_HISTORY = 60;

interface NodeStatsPoint {
  time: number;
  cpuPercent?: number;
  memoryBytes: number;
}

export interface NodeStatsSeries {
  name: string;
  nodeName: string;
  latest: HostNodeStats;
  points: NodeStatsPoint[];
}

interface NodeStatsState {
  /** `false` when the lab host cannot report usage; undefined until the first message. */
  available?: boolean;
  unavailableReason?: string;
  intervalSeconds: number;
  /** By container name. */
  series: Record<string, NodeStatsSeries>;
  /** Container names by topology node name. */
  containersByNode: Record<string, string>;
  applySample: (sample: HostNodeStatsSample) => void;
  setUnavailable: (reason: string) => void;
  clear: () => void;
}

export const useNodeStatsStore = create<NodeStatsState>((set) => ({
  intervalSeconds: 2,
  series: {},
  containersByNode: {},
  applySample: (sample) =>
    set((state) => {
      const time = Date.parse(sample.time) || Date.now();
      const series: Record<string, NodeStatsSeries> = {};
      const containersByNode: Record<string, string> = {};
      // Nodes missing from a sample stopped; their history goes with them.
      for (const node of sample.nodes) {
        const previous = state.series[node.name]?.points ?? [];
        const point: NodeStatsPoint = { time, memoryBytes: node.memoryBytes };
        if (node.cpuPercent !== undefined) point.cpuPercent = node.cpuPercent;
        const points = [...previous, point];
        if (points.length > NODE_STATS_HISTORY) points.splice(0, points.length - NODE_STATS_HISTORY);
        series[node.name] = { name: node.name, nodeName: node.nodeName, latest: node, points };
        if (node.nodeName) containersByNode[node.nodeName] = node.name;
      }
      return {
        available: true,
        unavailableReason: undefined,
        intervalSeconds: sample.intervalSeconds,
        series,
        containersByNode
      };
    }),
  setUnavailable: (reason) =>
    set({ available: false, unavailableReason: reason, series: {}, containersByNode: {} }),
  clear: () =>
    set({ available: undefined, unavailableReason: undefined, series: {}, containersByNode: {} })
}));

/** The usage series of a node, by container name first, then by topology node name. */
export function findNodeStatsSeries(
  state: Pick<NodeStatsState, "series" | "containersByNode">,
  containerName: string | undefined,
  nodeName: string | undefined
): NodeStatsSeries | undefined {
  const byContainer = containerName === undefined ? undefined : state.series[containerName];
  if (byContainer !== undefined) return byContainer;
  const container = nodeName === undefined ? undefined : state.containersByNode[nodeName];
  return container === undefined ? undefined : state.series[container];
}
