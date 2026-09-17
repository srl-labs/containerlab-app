import type { Edge } from "@xyflow/react";

import type { ClabTopology } from "../core/types/topology";
import type { TopoEdge, TopologyEdgeData } from "../core/types/graph";
import { getRecordUnknown, isRecord } from "../core/utilities/typeHelpers";
import type { HostRuntimeContainer } from "../host";
import {
  buildRuntimeEdgeStatsUpdates,
  type TopologyRuntimeEdgeUpdate
} from "../topology/runtime";
import { useGraphStore } from "../stores/graphStore";
import {
  PENDING_NETEM_KEY,
  mergeExtraDataWithPending,
  toPendingNetemOverride
} from "../utils/netemOverrides";

export interface ApplyRuntimeEdgeStatsOptions {
  currentLabName: string;
  topology?: ClabTopology["topology"];
}

function isTopologyEdge(edge: Edge): edge is TopoEdge {
  const data = getRecordUnknown(edge.data);
  return typeof data?.sourceEndpoint === "string" && typeof data.targetEndpoint === "string";
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => valuesEqual(item, right[index]))
    );
  }

  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) =>
      Object.hasOwn(right, key) && valuesEqual(left[key], right[key])
    )
  );
}

function mergeRuntimeExtraData(
  currentExtraData: Record<string, unknown>,
  updateExtraData: Record<string, unknown>
): Record<string, unknown> {
  const pending = toPendingNetemOverride(currentExtraData[PENDING_NETEM_KEY]);
  if (pending) {
    return mergeExtraDataWithPending(currentExtraData, updateExtraData, pending);
  }

  const hasChanges = Object.entries(updateExtraData).some(
    ([key, value]) => !valuesEqual(currentExtraData[key], value)
  );

  return hasChanges ? { ...currentExtraData, ...updateExtraData } : currentExtraData;
}

function applyRuntimeUpdateToEdge(
  edge: TopoEdge,
  update: TopologyRuntimeEdgeUpdate
): TopoEdge {
  const data = edge.data as TopologyEdgeData;
  const currentExtraData = getRecordUnknown(data.extraData) ?? {};
  const nextExtraData = mergeRuntimeExtraData(currentExtraData, update.extraData);
  const nextClassName = update.classes ?? edge.className;

  if (nextExtraData === currentExtraData && nextClassName === edge.className) {
    return edge;
  }

  return {
    ...edge,
    ...(update.classes === undefined ? {} : { className: nextClassName }),
    data: {
      ...data,
      extraData: nextExtraData
    }
  };
}

function applyRuntimeUpdates(
  edges: Edge[],
  updates: TopologyRuntimeEdgeUpdate[]
): { edges: Edge[]; changed: boolean } {
  const updatesById = new Map(updates.map((update) => [update.id, update]));
  let changed = false;

  const nextEdges = edges.map((edge) => {
    const update = updatesById.get(edge.id);
    if (!update || !isTopologyEdge(edge)) {
      return edge;
    }

    const nextEdge = applyRuntimeUpdateToEdge(edge, update);
    changed ||= nextEdge !== edge;
    return nextEdge;
  });

  return { edges: changed ? nextEdges : edges, changed };
}

export function applyRuntimeEdgeStatsToGraph(
  containers: HostRuntimeContainer[],
  options: ApplyRuntimeEdgeStatsOptions
): boolean {
  if (containers.length === 0) {
    return false;
  }

  const graphStore = useGraphStore.getState();
  const currentEdges = graphStore.edges;
  const topologyEdges = currentEdges.filter(isTopologyEdge);
  if (topologyEdges.length === 0) {
    return false;
  }

  const updates = buildRuntimeEdgeStatsUpdates(topologyEdges, containers, {
    currentLabName: options.currentLabName,
    topology: options.topology
  });
  if (updates.length === 0) {
    return false;
  }

  const result = applyRuntimeUpdates(currentEdges, updates);
  if (result.changed) {
    graphStore.setEdges(result.edges);
  }
  return result.changed;
}

export function clearTopologyGraph(): void {
  useGraphStore.getState().setGraph([], []);
}
