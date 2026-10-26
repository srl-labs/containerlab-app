/**
 * nodeLifecycleStore - start, stop and restart actions sent for single nodes.
 *
 * Hosts run node actions without reporting back, so a node counts as on its
 * way up or down until the canvas shows the outcome, or the action times out.
 */
import { create } from "zustand";
import type { Node } from "@xyflow/react";

import { getRecordUnknown, getStringOrEmpty } from "../core/utilities/typeHelpers";
import type { TopoViewerNodeAction, TopoViewerNodesAction } from "../host/contracts";
import type { NodeLifecycleDirection } from "../topology/runtime";

import { useGraphStore } from "./graphStore";

/** How long a node action counts as running when its outcome never shows. */
const NODE_ACTION_TIMEOUT_MS = 60_000;

/** The runtime fields of a node that tell whether an action went through. */
interface NodeRuntimeFields {
  state: string;
  status: string;
}

interface PendingNodeAction {
  direction: NodeLifecycleDirection;
  /** The node's state and status when the action was sent. */
  baseline: string;
}

interface NodeLifecycleState {
  /** Node actions in progress, by node id. */
  pending: Partial<Record<string, PendingNodeAction>>;
  trackNodeAction: (nodeId: string, pending: PendingNodeAction) => void;
  settleNodeAction: (nodeId: string) => void;
}

const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

function clearActionTimeout(nodeId: string): void {
  const timeout = timeouts.get(nodeId);
  if (timeout !== undefined) clearTimeout(timeout);
  timeouts.delete(nodeId);
}

export const useNodeLifecycleStore = create<NodeLifecycleState>((set, get) => ({
  pending: {},
  trackNodeAction: (nodeId, pending) => {
    clearActionTimeout(nodeId);
    timeouts.set(
      nodeId,
      setTimeout(() => get().settleNodeAction(nodeId), NODE_ACTION_TIMEOUT_MS)
    );
    set((state) => ({ pending: { ...state.pending, [nodeId]: pending } }));
  },
  settleNodeAction: (nodeId) => {
    clearActionTimeout(nodeId);
    if (!(nodeId in get().pending)) return;
    set((state) => {
      const { [nodeId]: _settled, ...rest } = state.pending;
      return { pending: rest };
    });
  }
}));

function isRunningState(state: string): boolean {
  return state.trim().toLowerCase().includes("run");
}

function runtimeBaseline(runtime: NodeRuntimeFields): string {
  return `${runtime.state}\n${runtime.status}`;
}

/** The state and status a node shows, from its data or its extraData. */
export function readNodeRuntimeFields(data: unknown): NodeRuntimeFields {
  const record = getRecordUnknown(data);
  const extraData = getRecordUnknown(record?.extraData);
  return {
    state: getStringOrEmpty(record?.state) || getStringOrEmpty(extraData?.state),
    status: getStringOrEmpty(extraData?.status)
  };
}

/**
 * What a node action is waiting for, or undefined when there is nothing to
 * wait for: starting a running node or stopping one that does not run.
 */
export function pendingNodeAction(
  action: TopoViewerNodesAction,
  runtime: NodeRuntimeFields
): PendingNodeAction | undefined {
  const running = isRunningState(runtime.state);
  if ((action === "start" && running) || (action === "stop" && !running)) return undefined;
  return { direction: action === "stop" ? "down" : "up", baseline: runtimeBaseline(runtime) };
}

/**
 * Whether the node shows the outcome: down once it no longer runs, up once it
 * runs with a state or status other than when the action was sent.
 */
export function isNodeActionSettled(
  pending: PendingNodeAction,
  runtime: NodeRuntimeFields
): boolean {
  const running = isRunningState(runtime.state);
  if (pending.direction === "down") return !running;
  return running && runtimeBaseline(runtime) !== pending.baseline;
}

/** Remember start, stop or restart of these nodes until their outcome shows. */
export function trackNodeActions(action: TopoViewerNodeAction, nodeIds: string[]): void {
  if (action !== "start" && action !== "stop" && action !== "restart") return;
  const nodes = new Map<string, Node>(
    useGraphStore.getState().nodes.map((node) => [node.id, node])
  );
  const { trackNodeAction } = useNodeLifecycleStore.getState();
  for (const nodeId of nodeIds) {
    const node = nodes.get(nodeId);
    if (node?.type !== "topology-node") continue;
    const pending = pendingNodeAction(action, readNodeRuntimeFields(node.data));
    if (pending) trackNodeAction(nodeId, pending);
  }
}
