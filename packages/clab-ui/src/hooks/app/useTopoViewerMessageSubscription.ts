/**
 * useTopoViewerMessageSubscription - TopoViewer host event subscription hook
 */
import { useEffect } from "react";

import type { CustomNodeTemplate } from "../../core/types/editors";
import type { CustomIconInfo } from "../../core/types/icons";
import { type ClabUiTopoViewerEvent, useClabUiHost } from "../../host";
import { useCanvasStore } from "../../stores/canvasStore";
import { useTopoViewerStore, type DeploymentState } from "../../stores/topoViewerStore";
import { isRecord } from "../../core/utilities/typeHelpers";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isDeploymentState(value: unknown): value is DeploymentState {
  return value === "deployed" || value === "undeployed" || value === "unknown";
}

function isCustomNodeTemplate(value: unknown): value is CustomNodeTemplate {
  return isRecord(value) && isNonEmptyString(value.name) && isNonEmptyString(value.kind);
}

function isCustomIconInfo(value: unknown): value is CustomIconInfo {
  return (
    isRecord(value) &&
    isNonEmptyString(value.name) &&
    (value.source === "workspace" || value.source === "global") &&
    isNonEmptyString(value.dataUri) &&
    (value.format === "svg" || value.format === "png")
  );
}

function handleTopoModeChanged(
  event: Extract<ClabUiTopoViewerEvent, { type: "modeChanged" }>
): void {
  const { setMode, setDeploymentState, setDirty } = useTopoViewerStore.getState();
  setMode(event.mode === "viewer" ? "view" : "edit");
  if (isDeploymentState(event.deploymentState)) {
    setDeploymentState(event.deploymentState);
  }
  if (typeof event.dirty === "boolean") {
    setDirty(event.dirty);
  }
}

function handlePanelAction(
  event: Extract<ClabUiTopoViewerEvent, { type: "panelAction" }>
): void {
  const { selectNode, selectEdge, editNode, editEdge, isProcessing } =
    useTopoViewerStore.getState();
  if (isProcessing) return;

  const action = isNonEmptyString(event.action) ? event.action : undefined;
  const nodeId = isNonEmptyString(event.nodeId) ? event.nodeId : undefined;
  const edgeId = isNonEmptyString(event.edgeId) ? event.edgeId : undefined;
  if (action === undefined) return;

  switch (action) {
    case "edit-node":
      if (nodeId !== undefined) editNode(nodeId);
      break;
    case "edit-link":
      if (edgeId !== undefined) editEdge(edgeId);
      break;
    case "node-info":
      if (nodeId !== undefined) selectNode(nodeId);
      break;
    case "link-info":
      if (edgeId !== undefined) selectEdge(edgeId);
      break;
    default:
      break;
  }
}

function handleCustomNodesUpdated(
  event: Extract<ClabUiTopoViewerEvent, { type: "customNodesUpdated" }>
): void {
  const { setCustomNodes } = useTopoViewerStore.getState();
  setCustomNodes(event.customNodes.filter(isCustomNodeTemplate), event.defaultNode);
}

function handleCustomNodeError(
  event: Extract<ClabUiTopoViewerEvent, { type: "customNodeError" }>
): void {
  const { setCustomNodeError } = useTopoViewerStore.getState();
  if (isNonEmptyString(event.error)) {
    setCustomNodeError(event.error);
  }
}

function handleIconList(
  event: Extract<ClabUiTopoViewerEvent, { type: "iconList" }>
): void {
  const { setCustomIcons } = useTopoViewerStore.getState();
  setCustomIcons(event.icons.filter(isCustomIconInfo));
}

function handleLifecycleLog(
  event: Extract<ClabUiTopoViewerEvent, { type: "lifecycleLog" }>
): void {
  const { appendLifecycleLog, isProcessing } = useTopoViewerStore.getState();
  if (!isProcessing || !isNonEmptyString(event.line)) {
    return;
  }
  appendLifecycleLog(event.line, event.stream === "stderr" ? "stderr" : "stdout");
}

function handleLifecycleStatus(
  event: Extract<ClabUiTopoViewerEvent, { type: "lifecycleStatus" }>
): void {
  const { appendLifecycleLog, setLifecycleStatus, setProcessing, setDirty, processingMode } =
    useTopoViewerStore.getState();
  if (event.status === "error" && isNonEmptyString(event.errorMessage)) {
    appendLifecycleLog(`[error] ${event.errorMessage}`, "stderr");
    setLifecycleStatus("error", event.errorMessage);
  } else if (event.status === "error") {
    setLifecycleStatus("error", "Lifecycle command failed.");
  }
  if (event.status === "success") {
    appendLifecycleLog("Command completed successfully.", "stdout");
    setLifecycleStatus("success");
    // Deploying or applying the topology brings the runtime in sync with the
    // on-disk YAML; hosts may still refine the flag afterwards.
    if (processingMode === "deploy" || processingMode === "apply") {
      setDirty(false);
    }
  }
  setProcessing(false);
}

function handleFitViewport(): void {
  const { requestFitView } = useCanvasStore.getState();
  requestFitView();
}

export function useTopoViewerMessageSubscription(): void {
  const host = useClabUiHost();

  useEffect(() => {
    return host.topoViewer.subscribe((event) => {
      switch (event.type) {
        case "modeChanged":
          handleTopoModeChanged(event);
          break;
        case "panelAction":
          handlePanelAction(event);
          break;
        case "customNodesUpdated":
          handleCustomNodesUpdated(event);
          break;
        case "customNodeError":
          handleCustomNodeError(event);
          break;
        case "iconList":
          handleIconList(event);
          break;
        case "lifecycleLog":
          handleLifecycleLog(event);
          break;
        case "lifecycleStatus":
          handleLifecycleStatus(event);
          break;
        case "fitViewport":
          handleFitViewport();
          break;
        case "svgExportResult":
          break;
      }
    });
  }, [host]);
}
