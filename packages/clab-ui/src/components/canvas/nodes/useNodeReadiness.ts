import { useEffect } from "react";

import {
  classifyNodeReadiness,
  type NodeLifecycleDirection,
  type NodeReadiness
} from "../../../topology/runtime";
import {
  isNodeActionSettled,
  readNodeRuntimeFields,
  useNodeLifecycleStore
} from "../../../stores/nodeLifecycleStore";
import {
  useDeploymentState,
  useTopoViewerStore,
  type ProcessingMode
} from "../../../stores/topoViewerStore";

function labLifecycleDirection(mode: ProcessingMode): NodeLifecycleDirection | undefined {
  switch (mode) {
    case "deploy":
    case "apply":
    case "start":
    case "restart":
      return "up";
    case "destroy":
    case "stop":
      return "down";
    default:
      return undefined;
  }
}

/**
 * How close a topology node is to being usable, taking lab lifecycle commands
 * and node actions in progress into account. Undefined while the lab is not
 * deployed and nothing brings it up.
 */
export function useNodeReadiness(nodeId: string, data: unknown): NodeReadiness | undefined {
  const deploymentState = useDeploymentState();
  // A command limited to some nodes leaves the others as they are.
  const labLifecycle = useTopoViewerStore((state) =>
    state.isProcessing && (state.processingNodes === null || state.processingNodes.includes(nodeId))
      ? labLifecycleDirection(state.processingMode)
      : undefined
  );
  const pending = useNodeLifecycleStore((state) => state.pending[nodeId]);
  const settleNodeAction = useNodeLifecycleStore((state) => state.settleNodeAction);
  const runtime = readNodeRuntimeFields(data);
  const settled = pending !== undefined && isNodeActionSettled(pending, runtime);

  useEffect(() => {
    if (settled) settleNodeAction(nodeId);
  }, [settled, nodeId, settleNodeAction]);

  const lifecycle =
    labLifecycle ?? (pending !== undefined && !settled ? pending.direction : undefined);
  if (deploymentState !== "deployed" && lifecycle !== "up") return undefined;
  return classifyNodeReadiness({ ...runtime, lifecycle });
}

/** Whether the node is on its way up or down, and pulses on the canvas. */
export function isNodeBooting(readiness: NodeReadiness | undefined): boolean {
  return readiness === "starting" || readiness === "stopping";
}

/** Shown for runtime values, such as addresses, that a starting node has not reported yet. */
export function nodePendingPlaceholder(readiness: NodeReadiness | undefined): string | undefined {
  return readiness === "starting" ? "Pending" : undefined;
}

/** What the info panel shows for the node's state while it is not simply up or down. */
export function nodeReadinessLabel(readiness: NodeReadiness | undefined): string | undefined {
  switch (readiness) {
    case "starting":
      return "Starting";
    case "stopping":
      return "Stopping";
    case "unhealthy":
      return "Unhealthy";
    default:
      return undefined;
  }
}
