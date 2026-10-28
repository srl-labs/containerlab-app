import React, { useMemo, type RefObject } from "react";
import type { Edge, Node } from "@xyflow/react";

import type { useCanvasHandlers } from "../../hooks/canvas";
import {
  useClabUiHost,
  type ClabUiTopoViewerHost,
  type TopoViewerNodeAction,
  type TopoViewerNodesAction
} from "../../host";
import { kubectlExecCommand } from "../../host/kubernetes";
import type { ClabUiLabOperationsHost } from "../../host/labOperations";
import type { LabHostProfile } from "../../host/labHostSupport";
import { copyToClipboard } from "../../utils/clipboard";
import { hostCanCapture, hostLabOperationSupport, hostSupports, useLabHostStore } from "../../stores/labHostStore";
import { useLabOperationsStore } from "../../stores/labOperationsStore";
import { trackNodeActions } from "../../stores/nodeLifecycleStore";
import { useLabFileOpener, useLabFileScope } from "../../hooks/editor/useLabFiles";
import type { LabFileRequest, LabFileScope } from "../../host/labFiles";
import { collectNodeLabFiles } from "../../utils/nodeLabFiles";
import { useDeploymentState, type DeploymentState } from "../../stores/topoViewerStore";
import { CanvasCapturePanel } from "../panels/capture/CanvasCapturePanel";
import {
  CanvasLinkCapturePanel,
  type CanvasLinkCapturePanelProps
} from "../panels/capture/CanvasLinkCapturePanel";
import type { ContextMenuItem } from "../context-menu/ContextMenu";

import {
  buildEdgeContextMenu,
  buildNodeContextMenu,
  buildPaneContextMenu
} from "./contextMenuBuilders";
import {
  getNodeRuntimeBadgeState,
  type NodeRuntimeBadgeState
} from "./nodes/nodeStyles";
import type { AnnotationHandlers } from "./types";

/** Parameters for useContextMenuItems hook */

function renderCapturePanel(nodeId: string, close: () => void): React.ReactNode {
  return React.createElement(CanvasCapturePanel, { nodeId, onDone: close });
}

function renderLinkCapturePanel(
  link: Omit<CanvasLinkCapturePanelProps, "onDone">,
  close: () => void
): React.ReactNode {
  return React.createElement(CanvasLinkCapturePanel, { ...link, onDone: close });
}

interface ContextMenuItemsParams {
  handlers: ReturnType<typeof useCanvasHandlers>;
  state: { mode: "view" | "edit"; isLocked: boolean };
  editNode: (id: string | null) => void;
  editNetwork: (id: string | null) => void;
  editEdge: (id: string | null) => void;
  handleDeleteNode: (nodeId: string) => void;
  handleDeleteEdge: (edgeId: string) => void;
  showNodeInfo: (nodeId: string) => void;
  showLinkInfo: (edgeId: string) => void;
  showLinkImpairment: (edgeId: string) => void;
  nodesRef: RefObject<Node[]>;
  edgesRef: RefObject<Edge[]>;
  linkSourceNode: string | null;
  startLinkCreation: (nodeId: string) => void;
  cancelLinkCreation: () => void;
  annotationHandlers?: AnnotationHandlers;
  onOpenNodePalette?: () => void;
  onAddDefaultNode?: (position: { x: number; y: number }) => void;
  onAddGroup?: () => void;
  onAddText?: () => void;
  onAddTextAtPosition?: (position: { x: number; y: number }) => void;
  onAddShapes?: (shapeType?: string) => void;
  onAddShapeAtPosition?: (position: { x: number; y: number }, shapeType?: string) => void;
  onAddTrafficRateAtPosition?: (position: { x: number; y: number }) => void;
}

interface ResolveContextMenuItemsParams extends ContextMenuItemsParams {
  onNodeAction: (action: TopoViewerNodeAction, nodeName: string) => void;
  onNodesAction?: (action: TopoViewerNodesAction, nodeNames: string[]) => void;
  labOperations?: Parameters<typeof buildNodeContextMenu>[0]["labOperations"];
  /** Absent when the lab host cannot capture packets. */
  renderCapturePanel?: typeof renderCapturePanel;
  /** Whether the lab host has link impairments (netem). */
  canImpairLinks: boolean;
  /** c9s: copies the kubectl exec command of a node. */
  copyKubectlExec?: (nodeId: string) => void;
  type: "node" | "edge" | "pane" | null;
  targetId: string | null;
  menuPosition: { x: number; y: number };
  nodes: Node[];
  edges: Edge[];
  isEditMode: boolean;
  isLocked: boolean;
  deploymentState: DeploymentState;
  labFileScope: LabFileScope;
  openLabFile?: (request: LabFileRequest) => void;
}

function getStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function resolveNodeRuntimeState(
  node: Node | undefined,
  deploymentState: DeploymentState
): NodeRuntimeBadgeState | undefined {
  if (node?.type !== "topology-node") {
    return undefined;
  }

  const nodeData = toRecord(node.data);
  const extraData = toRecord(nodeData.extraData);
  const rawState = getStringField(nodeData, "state") ?? getStringField(extraData, "state");
  if (deploymentState === "deployed" && rawState === undefined) {
    return undefined;
  }
  return getNodeRuntimeBadgeState(deploymentState, rawState);
}

/** The startup config, license and bind files of a topology node, with what it inherits. */
function resolveNodeLabFiles(
  node: Node | undefined,
  params: ResolveContextMenuItemsParams
): Parameters<typeof buildNodeContextMenu>[0]["labFiles"] {
  const { openLabFile } = params;
  if (!openLabFile || node?.type !== "topology-node") return undefined;
  const extraData = toRecord(toRecord(node.data).extraData);
  const nodeName = getStringField(extraData, "name") ?? node.id;
  return {
    files: collectNodeLabFiles(extraData, { ...params.labFileScope, nodeName }),
    open: openLabFile
  };
}

function buildNodeItems(
  params: ResolveContextMenuItemsParams & { targetId: string }
): ContextMenuItem[] {
  const targetNode = params.nodes.find((node) => node.id === params.targetId);
  const targetNodeType = targetNode?.type;
  const targetRuntimeState = resolveNodeRuntimeState(targetNode, params.deploymentState);

  return buildNodeContextMenu({
    targetId: params.targetId,
    targetNodeType,
    targetRuntimeState,
    isEditMode: params.isEditMode,
    isDeployed: params.deploymentState === "deployed",
    isLocked: params.isLocked,
    onNodeAction: params.onNodeAction,
    selectedNodeIds: params.nodes
      .filter((node) => node.selected === true && node.type === "topology-node")
      .map((node) => node.id),
    onNodesAction: params.onNodesAction,
    labOperations: params.labOperations,
    renderCapturePanel: params.renderCapturePanel,
    ...(params.copyKubectlExec ? { copyKubectlExec: params.copyKubectlExec } : {}),
    closeContextMenu: params.handlers.closeContextMenu,
    editNode: params.editNode,
    editNetwork: params.editNetwork,
    handleDeleteNode: params.handleDeleteNode,
    showNodeInfo: params.showNodeInfo,
    linkSourceNode: params.linkSourceNode,
    startLinkCreation: params.startLinkCreation,
    cancelLinkCreation: params.cancelLinkCreation,
    editFreeText: params.annotationHandlers?.onEditFreeText,
    editFreeTextWithInline: params.annotationHandlers?.onEditFreeTextWithInline,
    duplicateFreeText: params.annotationHandlers?.onDuplicateFreeText,
    editFreeShape: params.annotationHandlers?.onEditFreeShape,
    deleteFreeText: params.annotationHandlers?.onDeleteFreeText,
    deleteFreeShape: params.annotationHandlers?.onDeleteFreeShape,
    editGroup: params.annotationHandlers?.onEditGroup,
    deleteGroup: params.annotationHandlers?.onDeleteGroup,
    editTrafficRate: params.annotationHandlers?.onEditTrafficRate,
    deleteTrafficRate: params.annotationHandlers?.onDeleteTrafficRate,
    changeZOrder: params.annotationHandlers?.onChangeZOrder,
    labFiles: resolveNodeLabFiles(targetNode, params)
  });
}

function buildEdgeItems(
  params: ResolveContextMenuItemsParams & { targetId: string }
): ContextMenuItem[] {
  const targetEdge = params.edges.find((edge) => edge.id === params.targetId);
  const edgeData = targetEdge?.data as
    | { sourceEndpoint?: string; targetEndpoint?: string; extraData?: Record<string, unknown> }
    | undefined;

  return buildEdgeContextMenu({
    targetId: params.targetId,
    sourceNode: targetEdge?.source,
    targetNode: targetEdge?.target,
    sourceEndpoint: edgeData?.sourceEndpoint,
    targetEndpoint: edgeData?.targetEndpoint,
    extraData: edgeData?.extraData,
    isEditMode: params.isEditMode,
    isDeployed: params.deploymentState === "deployed",
    isLocked: params.isLocked,
    renderLinkCapturePanel: params.renderCapturePanel ? renderLinkCapturePanel : undefined,
    canImpairLinks: params.canImpairLinks,
    closeContextMenu: params.handlers.closeContextMenu,
    editEdge: params.editEdge,
    handleDeleteEdge: params.handleDeleteEdge,
    showLinkInfo: params.showLinkInfo,
    showLinkImpairment: params.showLinkImpairment
  });
}

function buildPaneItems(params: ResolveContextMenuItemsParams): ContextMenuItem[] {
  return buildPaneContextMenu({
    isEditMode: params.isEditMode,
    isLocked: params.isLocked,
    closeContextMenu: params.handlers.closeContextMenu,
    reactFlowInstance: params.handlers.reactFlowInstance,
    onOpenNodePalette: params.onOpenNodePalette,
    onAddDefaultNode: params.onAddDefaultNode,
    menuPosition: params.menuPosition,
    onAddGroup: params.onAddGroup,
    onAddText: params.onAddText,
    onAddTextAtPosition: params.onAddTextAtPosition,
    onAddShapes: params.onAddShapes,
    onAddShapeAtPosition: params.onAddShapeAtPosition,
    onAddTrafficRateAtPosition: params.onAddTrafficRateAtPosition
  });
}

function resolveContextMenuItems(params: ResolveContextMenuItemsParams): ContextMenuItem[] {
  if (params.type === "node" && params.targetId !== null && params.targetId.length > 0) {
    return buildNodeItems({ ...params, targetId: params.targetId });
  }

  if (params.type === "edge" && params.targetId !== null && params.targetId.length > 0) {
    return buildEdgeItems({ ...params, targetId: params.targetId });
  }

  if (params.type === "pane") {
    return buildPaneItems(params);
  }

  return [];
}

/**
 * Hook for building context menu items.
 */
function nodesActionHandler(
  topoViewer: ClabUiTopoViewerHost
): ResolveContextMenuItemsParams["onNodesAction"] {
  const { runNodesAction } = topoViewer;
  return runNodesAction
    ? (action, nodeNames) => {
        trackNodeActions(action, nodeNames);
        runNodesAction.call(topoViewer, action, nodeNames);
      }
    : undefined;
}

function runNodeAction(
  topoViewer: ClabUiTopoViewerHost,
  action: TopoViewerNodeAction,
  nodeName: string
): void {
  trackNodeActions(action, [nodeName]);
  topoViewer.runNodeAction(action, nodeName);
}

/** Looks the node up in `containerlab inspect` and copies the kubectl command for its device container. */
function copyKubectlExecHandler(
  operations: ClabUiLabOperationsHost,
  profile: Pick<LabHostProfile, "kubeContext" | "kubeconfig">
): (nodeId: string) => void {
  return (nodeId) => {
    void operations.nodeLocations().then(async (locations) => {
      const location = locations.find((entry) => entry.node === nodeId);
      if (!location) return;
      await copyToClipboard(
        kubectlExecCommand(location, {
          ...(profile.kubeContext ? { kubeContext: profile.kubeContext } : {}),
          ...(profile.kubeconfig ? { kubeconfig: profile.kubeconfig } : {})
        })
      );
    });
  };
}

export function useContextMenuItems(params: ContextMenuItemsParams): ContextMenuItem[] {
  const { topoViewer } = useClabUiHost();
  const deploymentState = useDeploymentState();
  const labHostInfo = useLabHostStore((state) => state.info);
  const operationSupport = useLabOperationsStore((state) => state.support);
  const labOperationSupport = useMemo(
    () => hostLabOperationSupport(operationSupport, labHostInfo),
    [operationSupport, labHostInfo]
  );
  const openLabOperation = useLabOperationsStore((state) => state.openDialog);
  const hasLabOperations = topoViewer.labOperations !== undefined;
  const labFileScope = useLabFileScope();
  const openLabFile = useLabFileOpener();
  const {
    handlers,
    state,
    editNode,
    editNetwork,
    editEdge,
    handleDeleteNode,
    handleDeleteEdge,
    showNodeInfo,
    showLinkInfo,
    showLinkImpairment,
    nodesRef,
    edgesRef,
    linkSourceNode,
    startLinkCreation,
    cancelLinkCreation,
    annotationHandlers,
    onOpenNodePalette,
    onAddDefaultNode,
    onAddGroup,
    onAddText,
    onAddTextAtPosition,
    onAddShapes,
    onAddShapeAtPosition,
    onAddTrafficRateAtPosition
  } = params;
  const { type, targetId, position: menuPosition } = handlers.contextMenu;

  return useMemo(() => {
    return resolveContextMenuItems({
      ...params,
      onNodeAction: (action, nodeName) => runNodeAction(topoViewer, action, nodeName),
      onNodesAction: nodesActionHandler(topoViewer),
      labOperations: hasLabOperations
        ? { support: labOperationSupport, open: openLabOperation }
        : undefined,
      renderCapturePanel: hostCanCapture(labHostInfo) ? renderCapturePanel : undefined,
      canImpairLinks: hostSupports(labHostInfo, "netem"),
      ...(labHostInfo?.profile.runtime === "c9s" && topoViewer.labOperations
        ? { copyKubectlExec: copyKubectlExecHandler(topoViewer.labOperations, labHostInfo.profile) }
        : {}),
      type,
      targetId,
      menuPosition,
      nodes: nodesRef.current,
      edges: edgesRef.current,
      isEditMode: state.mode === "edit",
      isLocked: state.isLocked,
      deploymentState,
      labFileScope,
      openLabFile
    });
  }, [
    type,
    targetId,
    menuPosition,
    state.mode,
    state.isLocked,
    deploymentState,
    handlers.closeContextMenu,
    handlers.reactFlowInstance,
    editNode,
    editNetwork,
    editEdge,
    handleDeleteNode,
    handleDeleteEdge,
    showNodeInfo,
    showLinkInfo,
    showLinkImpairment,
    nodesRef,
    edgesRef,
    linkSourceNode,
    startLinkCreation,
    cancelLinkCreation,
    topoViewer,
    hasLabOperations,
    labOperationSupport,
    labHostInfo,
    openLabOperation,
    annotationHandlers,
    onOpenNodePalette,
    onAddDefaultNode,
    onAddGroup,
    onAddText,
    onAddTextAtPosition,
    onAddShapes,
    onAddShapeAtPosition,
    onAddTrafficRateAtPosition,
    labFileScope,
    openLabFile
  ]);
}
