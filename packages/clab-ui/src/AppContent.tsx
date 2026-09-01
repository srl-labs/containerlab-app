// App content — UI composition for the React TopoViewer.
/* eslint-disable import-x/max-dependencies */
import React from "react";
import type { Edge, Node, ReactFlowInstance } from "@xyflow/react";
import { Box } from "@mantine/core";
import { shallow } from "zustand/shallow";

import type { TopoEdge, TopoNode } from "./core/types";
import { NETWORK_TYPES } from "./core/types/editors";
import type { SettingsSection } from "./components/panels/lab-settings";

import { AppThemeProvider } from "./theme";
import {
  FREE_TEXT_NODE_TYPE,
  FREE_SHAPE_NODE_TYPE,
  TRAFFIC_RATE_NODE_TYPE,
  GROUP_NODE_TYPE,
  findEdgeAnnotationInLookup,
  parseEndpointLabelOffset
} from "./annotations";
import {
  buildEdgeAnnotationLookup,
  type EdgeAnnotationLookup
} from "./annotations/edgeAnnotations";
import type { ReactFlowCanvasRef } from "./components/canvas";
import { ReactFlowCanvas, CanvasZoomControls } from "./components/canvas";
import { Navbar } from "./components/navbar/Navbar";
import type { LinkImpairmentData } from "./components/panels";
import { ContextPanel } from "./components/panels/context-panel";
import { SidebarRail } from "./components/panels/sidebar/SidebarRail";
import type { SvgExportModalProps } from "./components/panels/SvgExportModal";
import { ShortcutDisplay, ToastContainer } from "./components/ui";
import { EasterEggRenderer, useEasterEgg } from "./easter-eggs";
import {
  useAppEditorBindings,
  useAppE2EExposure,
  useAppGraphHandlers,
  useAppKeyboardShortcuts,
  useAppToasts,
  useClipboardHandlers,
  useCustomNodeCommands,
  useDevMockTrafficStats,
  useGraphCreation,
  useIconReconciliation,
  useUndoRedoControls
} from "./hooks/app";
import { useFilteredGraphElements, useSelectionData } from "./hooks/app/useAppContentHelpers";
import { isDevExplorerDisabledByUrl, useDevExplorerPane } from "./hooks/app/useDevExplorerPane";
import {
  applyGraphDeletions,
  buildAnnotationSaveCommand,
  buildDeleteCommands,
  collectSelectedIds,
  splitNodeIdsByType
} from "./services/deleteSelectionCommands";
import { useAnnotations, useDerivedAnnotations, type AnnotationContextValue } from "./hooks/canvas";
import {
  useAppHandlers,
  useContextMenuHandlers,
  usePanelVisibility,
  useShakeAnimation,
  useShortcutDisplay,
  type SidebarView,
  type useLayoutControls
} from "./hooks/ui";
import {
  useAnnotationUIActions,
  useAnnotationUIState,
  useCanvasStore,
  useGraphActions,
  useGraphState,
  useGraphStore,
  useTopoViewerActions,
  useTopoViewerStore
} from "./stores";
import type { TopoViewerState } from "./stores";
import {
  executeTopologyCommand,
  getCustomIconMap,
  saveViewerSettings
} from "./services";
import { useClabUiHost, useTopologySessionClient, useClabUiRuntime } from "./host";
import {
  PENDING_NETEM_KEY,
  areNetemEquivalent,
  createPendingNetemOverride,
  toNetemState
} from "./utils/netemOverrides";
import { isRecord } from "./core/utilities/typeHelpers";
import type { ExplorerSectionId } from "./explorer/shared/explorer/types";

type LayoutControls = ReturnType<typeof useLayoutControls>;
const DEV_EXPLORER_DEFER_MS = 300;

// The rail splits the explorer into two panes: labs (running + undeployed) and files.
const LAB_EXPLORER_SECTIONS: readonly ExplorerSectionId[] = ["runningLabs", "localLabs"];
const FILE_EXPLORER_SECTIONS: readonly ExplorerSectionId[] = ["fileExplorer"];

const LazyContainerlabExplorerView = React.lazy(async () => {
  const module = await import("./explorer/containerlabExplorerView.webview");
  return { default: module.ContainerlabExplorerView };
});

const LazyLifecycleProgressModal = React.lazy(async () => {
  const module = await import("./components/panels/LifecycleProgressModal");
  return { default: module.LifecycleProgressModal };
});

const LazySettingsModal = React.lazy(async () => {
  const module = await import("./components/panels/settings/SettingsModal");
  return { default: module.SettingsModal };
});


const LazySvgExportModal = React.lazy(async () => {
  const module = await import("./components/panels/SvgExportModal");
  return { default: module.SvgExportModal };
});

const LazyBulkLinkModal = React.lazy(async () => {
  const module = await import("./components/panels/BulkLinkModal");
  return { default: module.BulkLinkModal };
});

const LazyAboutModal = React.lazy(async () => {
  const module = await import("./components/panels/AboutModal");
  return { default: module.AboutModal };
});

const LazyHelpModal = React.lazy(async () => {
  const module = await import("./components/panels/HelpModal");
  return { default: module.HelpModal };
});


const TOPO_NODE_TYPES = new Set<string>([
  "topology-node",
  "network-node",
  GROUP_NODE_TYPE,
  FREE_TEXT_NODE_TYPE,
  FREE_SHAPE_NODE_TYPE,
  TRAFFIC_RATE_NODE_TYPE
]);
const NETWORK_TYPE_VALUES = new Set<string>(NETWORK_TYPES);

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isTopoNode(node: Node): node is TopoNode {
  return TOPO_NODE_TYPES.has(node.type ?? "");
}

function isTopoEdge(edge: Edge): edge is TopoEdge {
  const data = edge.data;
  return (
    isRecord(data) &&
    typeof data.sourceEndpoint === "string" &&
    typeof data.targetEndpoint === "string"
  );
}

function isNetworkTypeValue(
  value: string
): value is Parameters<ReturnType<typeof useGraphCreation>["createNetworkAtPosition"]>[1] {
  return NETWORK_TYPE_VALUES.has(value);
}

function getInteractionMode(mode: "view" | "edit", isProcessing: boolean): "view" | "edit" {
  if (isProcessing) return "view";
  return mode;
}

function getInteractionLockState(isLocked: boolean, isProcessing: boolean): boolean {
  return isLocked || isProcessing;
}

function isDevMockWebview(host: { meta?: { isDevMock?: boolean } } | null): boolean {
  return host?.meta?.isDevMock === true;
}

function shouldDumpCssVars(): boolean {
  const params = new URLSearchParams(window.location.search);
  const rawValue = params.get("dumpCssVars");
  if (rawValue == null || rawValue.length === 0) return false;
  const normalized = rawValue.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
}

function shouldCollectDevMockTrafficStats(
  host: { meta?: { disableDevMockTraffic?: boolean } } | null,
  isDevMock: boolean,
  interactionMode: "view" | "edit"
): boolean {
  if (!isDevMock || interactionMode !== "view") {
    return false;
  }
  if (host?.meta?.disableDevMockTraffic === true) {
    return false;
  }
  return true;
}

function shouldShowBulkLinkModal(
  hasActiveTopology: boolean,
  isRequested: boolean,
  isProcessing: boolean
): boolean {
  return hasActiveTopology && isRequested && !isProcessing;
}

function hasActiveTopologySession(
  sessionClient: ReturnType<typeof useTopologySessionClient>,
  labName: string
): boolean {
  const context = sessionClient.getContext();
  if (context.topologyRef !== undefined) {
    return true;
  }
  if (typeof context.path === "string" && context.path.trim().length > 0) {
    return true;
  }
  return labName.trim().length > 0;
}

function resolveTopologyViewportKey(
  sessionClient: ReturnType<typeof useTopologySessionClient>,
  labName: string
): string | null {
  const context = sessionClient.getContext();
  const topologyId = context.topologyRef?.topologyId?.trim();
  if (topologyId && topologyId.length > 0) {
    return topologyId;
  }
  const path = context.path?.trim();
  if (path && path.length > 0) {
    return `path:${path}`;
  }
  const normalizedLabName = labName.trim();
  if (normalizedLabName.length > 0) {
    return `lab:${normalizedLabName}`;
  }
  return null;
}

interface ContextSelectionState {
  selectedNode: unknown;
  selectedEdge: unknown;
  editingNode: unknown;
  editingEdge: unknown;
  editingNetwork: unknown;
  editingImpairment: unknown;
}

interface ContextAnnotationState {
  editingTextAnnotation: unknown;
  editingShapeAnnotation: unknown;
  editingTrafficRateAnnotation: unknown;
  editingGroup: unknown;
}

function hasContextContentState(
  state: ContextSelectionState,
  annotations: ContextAnnotationState
): boolean {
  const candidates = [
    state.selectedNode,
    state.selectedEdge,
    state.editingNode,
    state.editingEdge,
    state.editingNetwork,
    state.editingImpairment,
    annotations.editingTextAnnotation,
    annotations.editingShapeAnnotation,
    annotations.editingTrafficRateAnnotation,
    annotations.editingGroup
  ];
  return candidates.some((value) => value !== null && value !== undefined);
}

type AnnotationMethodKey = {
  [K in keyof AnnotationContextValue]: AnnotationContextValue[K] extends (
    ...args: never[]
  ) => unknown
    ? K
    : never;
}[keyof AnnotationContextValue];

// The annotation runtime lives behind a ref (see AnnotationRuntimeBridge) so its
// re-renders don't cascade into AppContent. forward() hands out stable wrappers
// that call through the ref, one cached instance per method name.
function createRuntimeForwarder(ref: React.RefObject<AnnotationContextValue | null>) {
  const cache = new Map<AnnotationMethodKey, (...args: unknown[]) => unknown>();
  return function forward<K extends AnnotationMethodKey>(method: K): AnnotationContextValue[K] {
    let fn = cache.get(method);
    if (!fn) {
      fn = (...args: unknown[]) =>
        (ref.current?.[method] as ((...callArgs: unknown[]) => unknown) | undefined)?.(...args);
      cache.set(method, fn);
    }
    return fn as AnnotationContextValue[K];
  };
}

export interface AppContentProps {
  reactFlowRef: React.RefObject<ReactFlowCanvasRef | null>;
  rfInstance: ReactFlowInstance | null;
  layoutControls: LayoutControls;
  onInit: (instance: ReactFlowInstance) => void;
  /** "full" (default) shows the editor navbar + side panel; "viewer" renders only the canvas. */
  chrome?: "full" | "viewer";
}

interface StoreSelectionState {
  selectedNode: string | null;
  selectedEdge: string | null;
  editingImpairment: string | null;
  editingNode: string | null;
  editingEdge: string | null;
  editingNetwork: string | null;
  endpointLabelOffset: number;
}

type CanvasPropsWithoutGraph = Omit<
  React.ComponentPropsWithoutRef<typeof ReactFlowCanvas>,
  "nodes" | "edges"
>;

interface GraphCanvasMainProps {
  canvasRef: React.RefObject<ReactFlowCanvasRef | null>;
  canvasProps: CanvasPropsWithoutGraph;
  showDummyLinks: boolean;
  edgeAnnotationLookup: EdgeAnnotationLookup;
  endpointLabelOffsetEnabled: boolean;
  endpointLabelOffset: number;
}

function areSelectedNodesEqual(left: TopoNode | null, right: TopoNode | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.id === right.id && left.data === right.data;
}

function areSelectedEdgesEqual(left: TopoEdge | null, right: TopoEdge | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.id === right.id &&
    left.source === right.source &&
    left.target === right.target &&
    left.data === right.data
  );
}

function useGraphNodeById(nodeId: string | null): TopoNode | null {
  return useGraphStore(
    React.useCallback(
      (graphState) =>
        nodeId != null && nodeId.length > 0
          ? (graphState.nodes.find(
            (node): node is TopoNode => node.id === nodeId && isTopoNode(node)
          ) ?? null)
          : null,
      [nodeId]
    ),
    areSelectedNodesEqual
  );
}

function useGraphEdgeById(edgeId: string | null): TopoEdge | null {
  return useGraphStore(
    React.useCallback(
      (graphState) =>
        edgeId != null && edgeId.length > 0
          ? (graphState.edges.find(
            (edge): edge is TopoEdge => edge.id === edgeId && isTopoEdge(edge)
          ) ?? null)
          : null,
      [edgeId]
    ),
    areSelectedEdgesEqual
  );
}

function useStoreBackedSelectionData(
  state: StoreSelectionState,
  edgeAnnotationLookup: EdgeAnnotationLookup
) {
  const selectedNode = useGraphNodeById(state.selectedNode);
  const editingNode = useGraphNodeById(state.editingNode);
  const editingNetwork = useGraphNodeById(state.editingNetwork);
  const selectedEdge = useGraphEdgeById(state.selectedEdge);
  const editingImpairment = useGraphEdgeById(state.editingImpairment);
  const editingEdge = useGraphEdgeById(state.editingEdge);

  const selectionNodes = React.useMemo(() => {
    const deduped = new Map<string, TopoNode>();
    for (const node of [selectedNode, editingNode, editingNetwork]) {
      if (!node) continue;
      deduped.set(node.id, node);
    }
    return Array.from(deduped.values());
  }, [selectedNode, editingNode, editingNetwork]);

  const selectionEdges = React.useMemo(() => {
    const deduped = new Map<string, TopoEdge>();
    for (const edge of [selectedEdge, editingImpairment, editingEdge]) {
      if (!edge) continue;
      deduped.set(edge.id, edge);
    }
    return Array.from(deduped.values());
  }, [selectedEdge, editingImpairment, editingEdge]);

  return useSelectionData(state, selectionNodes, selectionEdges, edgeAnnotationLookup);
}

const GraphCanvasMain: React.FC<GraphCanvasMainProps> = React.memo(
  ({
    canvasRef,
    canvasProps,
    showDummyLinks,
    edgeAnnotationLookup,
    endpointLabelOffsetEnabled,
    endpointLabelOffset
  }) => {
    const { nodes, edges } = useGraphState();
    const graphNodes = React.useMemo(() => nodes.filter(isTopoNode), [nodes]);
    const graphEdges = React.useMemo(() => edges.filter(isTopoEdge), [edges]);
    useIconReconciliation();

    const { filteredNodes, filteredEdges } = useFilteredGraphElements(
      graphNodes,
      graphEdges,
      showDummyLinks
    );

    const renderedEdges = React.useMemo(() => {
      if (filteredEdges.length === 0) return filteredEdges;
      return filteredEdges.map((edge) => {
        const data = edge.data;
        if (data == null) return edge;
        const sourceEndpoint = data.sourceEndpoint;
        const targetEndpoint = data.targetEndpoint;
        const annotation = findEdgeAnnotationInLookup(edgeAnnotationLookup, {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceEndpoint,
          targetEndpoint
        });
        const annotationOffset = parseEndpointLabelOffset(annotation?.endpointLabelOffset);
        const annotationEnabled =
          annotation?.endpointLabelOffsetEnabled ??
          (annotation?.endpointLabelOffset !== undefined ? true : undefined);
        const enabled = annotationEnabled ?? endpointLabelOffsetEnabled;
        const resolvedOffset = enabled ? (annotationOffset ?? endpointLabelOffset) : 0;

        if (
          data.endpointLabelOffsetEnabled === enabled &&
          data.endpointLabelOffset === resolvedOffset
        ) {
          return edge;
        }

        return {
          ...edge,
          data: {
            ...data,
            endpointLabelOffsetEnabled: enabled,
            endpointLabelOffset: resolvedOffset
          }
        };
      });
    }, [filteredEdges, edgeAnnotationLookup, endpointLabelOffset, endpointLabelOffsetEnabled]);

    return (
      <ReactFlowCanvas
        ref={canvasRef}
        {...canvasProps}
        nodes={filteredNodes}
        edges={renderedEdges}
      />
    );
  }
);
GraphCanvasMain.displayName = "GraphCanvasMain";

interface AnnotationRuntimeBridgeProps {
  rfInstance: ReactFlowInstance | null;
  onLockedAction: () => void;
  runtimeRef: { current: AnnotationContextValue | null };
}

const AnnotationRuntimeBridge: React.FC<AnnotationRuntimeBridgeProps> = ({
  rfInstance,
  onLockedAction,
  runtimeRef
}) => {
  const annotations = useAnnotations({ rfInstance, onLockedAction });

  React.useEffect(() => {
    runtimeRef.current = annotations;
  }, [annotations, runtimeRef]);

  React.useEffect(
    () => () => {
      runtimeRef.current = null;
    },
    [runtimeRef]
  );

  return null;
};

type SvgExportModalContainerProps = Pick<
  SvgExportModalProps,
  "onClose" | "rfInstance" | "customIcons" | "labName"
>;

const SvgExportModalContainer: React.FC<SvgExportModalContainerProps> = React.memo(
  ({ onClose, rfInstance, customIcons, labName }) => {
    const { textAnnotations, shapeAnnotations, groups } = useDerivedAnnotations();

    return (
      <React.Suspense fallback={null}>
        <LazySvgExportModal
          isOpen
          onClose={onClose}
          labName={labName}
          textAnnotations={textAnnotations}
          shapeAnnotations={shapeAnnotations}
          groups={groups}
          rfInstance={rfInstance}
          customIcons={customIcons}
        />
      </React.Suspense>
    );
  }
);
SvgExportModalContainer.displayName = "SvgExportModalContainer";

function DeferredDevExplorerView({
  visibleSections
}: {
  visibleSections?: readonly ExplorerSectionId[];
}) {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let timerId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      timerId = window.setTimeout(() => {
        timerId = null;
        setReady(true);
      }, DEV_EXPLORER_DEFER_MS);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  if (!ready) {
    return null;
  }

  return (
    <React.Suspense fallback={null}>
      <LazyContainerlabExplorerView visibleSections={visibleSections} />
    </React.Suspense>
  );
}

type AppContentStateSlice = Pick<
  TopoViewerState,
  | "labName"
  | "mode"
  | "labSettings"
  | "canUndo"
  | "canRedo"
  | "selectedNode"
  | "selectedEdge"
  | "editingImpairment"
  | "editingNode"
  | "editingEdge"
  | "editingNetwork"
  | "isLocked"
  | "linkLabelMode"
  | "showDummyLinks"
  | "endpointLabelOffsetEnabled"
  | "endpointLabelOffset"
  | "edgeAnnotations"
  | "customNodes"
  | "defaultNode"
  | "customIcons"
  | "isProcessing"
  | "customNodeError"
>;

// Subscribe only to the fields AppContent reads during render so unrelated store
// updates (lifecycle logs, telemetry sizing, source-editor content, ...) don't
// re-run the whole composition root. Callback-only reads (e.g.
// lastNonTelemetryLinkLabelMode) go through useTopoViewerStore.getState() instead.
function selectAppContentState(state: TopoViewerState): AppContentStateSlice {
  return {
    labName: state.labName,
    mode: state.mode,
    labSettings: state.labSettings,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    selectedNode: state.selectedNode,
    selectedEdge: state.selectedEdge,
    editingImpairment: state.editingImpairment,
    editingNode: state.editingNode,
    editingEdge: state.editingEdge,
    editingNetwork: state.editingNetwork,
    isLocked: state.isLocked,
    linkLabelMode: state.linkLabelMode,
    showDummyLinks: state.showDummyLinks,
    endpointLabelOffsetEnabled: state.endpointLabelOffsetEnabled,
    endpointLabelOffset: state.endpointLabelOffset,
    edgeAnnotations: state.edgeAnnotations,
    customNodes: state.customNodes,
    defaultNode: state.defaultNode,
    customIcons: state.customIcons,
    isProcessing: state.isProcessing,
    customNodeError: state.customNodeError
  };
}

type LifecycleModalStateSlice = Pick<
  TopoViewerState,
  | "lifecycleModalOpen"
  | "isProcessing"
  | "processingMode"
  | "lifecycleStatus"
  | "lifecycleStatusMessage"
  | "labName"
  | "lifecycleLogs"
>;

function selectLifecycleModalState(state: TopoViewerState): LifecycleModalStateSlice {
  return {
    lifecycleModalOpen: state.lifecycleModalOpen,
    isProcessing: state.isProcessing,
    processingMode: state.processingMode,
    lifecycleStatus: state.lifecycleStatus,
    lifecycleStatusMessage: state.lifecycleStatusMessage,
    labName: state.labName,
    lifecycleLogs: state.lifecycleLogs
  };
}

interface LifecycleModalHostProps {
  onClose: () => void;
  onCancel: () => void;
}

// Hosts the lifecycle-modal store subscription so high-frequency lifecycle
// updates (log appends, status messages) re-render only this component
// instead of the whole AppContent tree.
const LifecycleModalHost: React.FC<LifecycleModalHostProps> = React.memo(
  ({ onClose, onCancel }) => {
    const state = useTopoViewerStore(selectLifecycleModalState, shallow);

    if (!state.lifecycleModalOpen && !state.isProcessing) {
      return null;
    }

    return (
      <React.Suspense fallback={null}>
        <LazyLifecycleProgressModal
          isOpen={state.lifecycleModalOpen}
          isProcessing={state.isProcessing}
          mode={state.processingMode}
          status={state.lifecycleStatus}
          statusMessage={state.lifecycleStatusMessage}
          labName={state.labName}
          logs={state.lifecycleLogs}
          onClose={onClose}
          onCancel={onCancel}
        />
      </React.Suspense>
    );
  }
);
LifecycleModalHost.displayName = "LifecycleModalHost";

// Top-level UI composition; many conditional branches for panels, modals, and chrome.
/* eslint-disable complexity */
export const AppContent: React.FC<AppContentProps> = ({
  reactFlowRef,
  rfInstance,
  layoutControls,
  onInit,
  chrome = "full"
}) => {
  const viewerOnly = chrome === "viewer";
  const [helpOpen, setHelpOpen] = React.useState(false);
  const host = useClabUiHost();
  const sessionClient = useTopologySessionClient();
  const { renderAboutModal, renderDeployMenuItems, customSettingsSections, colorScheme } =
    useClabUiRuntime();
  const state = useTopoViewerStore(selectAppContentState, shallow);
  const topoActions = useTopoViewerActions();
  const graphActions = useGraphActions();
  const annotationUiActions = useAnnotationUIActions();
  const isProcessing = state.isProcessing;
  const hasActiveTopology = hasActiveTopologySession(sessionClient, state.labName);
  const topologyViewportKey = resolveTopologyViewportKey(sessionClient, state.labName);
  const isInteractionLocked = getInteractionLockState(state.isLocked, isProcessing);
  const interactionMode = getInteractionMode(state.mode, isProcessing);
  const isDevMock = isDevMockWebview(host);
  const showDevExplorer = React.useMemo(
    () => isDevMock && !isDevExplorerDisabledByUrl(),
    [isDevMock]
  );
  useDevMockTrafficStats(shouldCollectDevMockTrafficStats(host, isDevMock, interactionMode));
  const { layoutRef } = useDevExplorerPane(showDevExplorer);
  const renderExplorerContent = React.useCallback(
    (view: SidebarView) => (
      <DeferredDevExplorerView
        visibleSections={view === "files" ? FILE_EXPLORER_SECTIONS : LAB_EXPLORER_SECTIONS}
      />
    ),
    []
  );
  // The rail/context panel show whenever a topology is active. When the host
  // exposes an explorer they also show without one, so a fresh user (e.g. an
  // empty pages sandbox) can browse and create their first lab.
  const showSidebarChrome = !viewerOnly && (hasActiveTopology || showDevExplorer);

  React.useEffect(() => {
    if (!shouldDumpCssVars()) return;
    const htmlStyle = document.querySelector("html")?.getAttribute("style");
    if (htmlStyle == null || htmlStyle.length === 0) return;
    const vars: Record<string, string> = {};
    for (const part of htmlStyle.split(";")) {
      const trimmed = part.trim();
      if (!trimmed.startsWith("--vscode-")) continue;
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;
      vars[trimmed.slice(0, colonIdx).trim()] = trimmed.slice(colonIdx + 1).trim();
    }
    if (Object.keys(vars).length === 0) return;
    const sorted = Object.fromEntries(Object.entries(vars).sort(([a], [b]) => a.localeCompare(b)));
    host.topoViewer.dumpCssVars(sorted);
  }, [host]);

  const undoRedo = useUndoRedoControls(state.canUndo, state.canRedo);
  const { trigger: triggerLockShake } = useShakeAnimation();

  const { toasts, dismissToast, addToast } = useAppToasts({
    customNodeError: state.customNodeError,
    clearCustomNodeError: topoActions.clearCustomNodeError
  });

  const handleLockedAction = React.useCallback(() => {
    triggerLockShake();
    addToast("Lab is locked (read-only)", "error", 2000);
  }, [triggerLockShake, addToast]);

  const annotationRuntimeRef = React.useRef<AnnotationContextValue | null>(null);
  const annotationUiState = useAnnotationUIState();

  const annotationMode = React.useMemo(
    () => ({
      isAddTextMode: annotationUiState.isAddTextMode,
      isAddShapeMode: annotationUiState.isAddShapeMode,
      pendingShapeType: annotationUiState.isAddShapeMode
        ? annotationUiState.pendingShapeType
        : undefined
    }),
    [
      annotationUiState.isAddTextMode,
      annotationUiState.isAddShapeMode,
      annotationUiState.pendingShapeType
    ]
  );

  const forward = React.useMemo(() => createRuntimeForwarder(annotationRuntimeRef), []);

  const annotationActions = React.useMemo(
    () => ({
      handleAddGroup: forward("handleAddGroup"),
      handleAddText: forward("handleAddText"),
      handleAddShapes: forward("handleAddShapes"),
      createTextAtPosition: forward("createTextAtPosition"),
      createGroupAtPosition: forward("createGroupAtPosition"),
      createShapeAtPosition: forward("createShapeAtPosition"),
      createTrafficRateAtPosition: forward("createTrafficRateAtPosition"),
      getNodeMembership: (nodeId: string) =>
        annotationRuntimeRef.current?.getNodeMembership(nodeId) ?? null,
      addNodeToGroup: forward("addNodeToGroup"),
      deleteAllSelected: forward("deleteAllSelected"),
      deleteSelectedForBatch: (
        options?: Parameters<AnnotationContextValue["deleteSelectedForBatch"]>[0]
      ) =>
        annotationRuntimeRef.current?.deleteSelectedForBatch(options) ?? {
          didDelete: false,
          membersCleared: false
        },
      saveTextAnnotation: forward("saveTextAnnotation"),
      applyTextAnnotationEdit: forward("applyTextAnnotationEdit"),
      updateTextAnnotation: forward("updateTextAnnotation"),
      deleteTextAnnotation: forward("deleteTextAnnotation"),
      saveShapeAnnotation: forward("saveShapeAnnotation"),
      applyShapeAnnotationEdit: forward("applyShapeAnnotationEdit"),
      updateShapeAnnotation: forward("updateShapeAnnotation"),
      deleteShapeAnnotation: forward("deleteShapeAnnotation"),
      saveTrafficRateAnnotation: forward("saveTrafficRateAnnotation"),
      applyTrafficRateAnnotationEdit: forward("applyTrafficRateAnnotationEdit"),
      updateTrafficRateAnnotation: forward("updateTrafficRateAnnotation"),
      deleteTrafficRateAnnotation: forward("deleteTrafficRateAnnotation"),
      saveGroup: forward("saveGroup"),
      applyGroupEdit: forward("applyGroupEdit"),
      deleteGroup: forward("deleteGroup"),
      updateGroup: forward("updateGroup")
    }),
    [forward]
  );

  const canvasAnnotationHandlers = React.useMemo<
    NonNullable<CanvasPropsWithoutGraph["annotationHandlers"]>
  >(
    () => ({
      onAddTextClick: forward("handleTextCanvasClick"),
      onAddShapeClick: forward("handleShapeCanvasClick"),
      disableAddTextMode: forward("disableAddTextMode"),
      disableAddShapeMode: forward("disableAddShapeMode"),
      onEditFreeText: forward("editTextAnnotation"),
      onEditFreeTextWithInline: forward("editTextWithInline"),
      onStartInlineFreeTextEdit: forward("startInlineTextEdit"),
      onCommitInlineFreeTextEdit: forward("commitInlineTextEdit"),
      onUpdateFreeTextStyle: forward("updateTextStyle"),
      onOpenFreeTextStyleEditor: forward("openInlineTextStyleEditor"),
      onDuplicateFreeText: forward("duplicateTextAnnotation"),
      onEditFreeShape: forward("editShapeAnnotation"),
      onEditTrafficRate: forward("editTrafficRateAnnotation"),
      onDeleteFreeText: forward("deleteTextAnnotation"),
      onDeleteFreeShape: forward("deleteShapeAnnotation"),
      onDeleteTrafficRate: forward("deleteTrafficRateAnnotation"),
      onUpdateFreeTextSize: forward("updateTextSize"),
      onUpdateFreeShapeSize: forward("updateShapeSize"),
      onUpdateTrafficRateSize: forward("updateTrafficRateSize"),
      onUpdateFreeTextRotation: forward("updateTextRotation"),
      onUpdateFreeShapeRotation: forward("updateShapeRotation"),
      onFreeTextRotationStart: forward("onTextRotationStart"),
      onFreeTextRotationEnd: forward("onTextRotationEnd"),
      onFreeShapeRotationStart: forward("onShapeRotationStart"),
      onFreeShapeRotationEnd: forward("onShapeRotationEnd"),
      onUpdateFreeShapeStartPosition: forward("updateShapeStartPosition"),
      onUpdateFreeShapeEndPosition: forward("updateShapeEndPosition"),
      onPersistAnnotations: forward("persistAnnotations"),
      onNodeDropped: forward("onNodeDropped"),
      onUpdateGroupSize: forward("updateGroupSize"),
      onEditGroup: forward("editGroup"),
      onDeleteGroup: forward("deleteGroup"),
      getGroupMembers: (groupId, options) =>
        annotationRuntimeRef.current?.getGroupMembers(groupId, options) ?? []
    }),
    [forward]
  );

  const getAnnotationGroups = React.useCallback(
    () => annotationRuntimeRef.current?.groups ?? [],
    []
  );

  const edgeAnnotationLookup = React.useMemo(
    () => buildEdgeAnnotationLookup(state.edgeAnnotations),
    [state.edgeAnnotations]
  );
  const selectionData = useStoreBackedSelectionData(
    {
      selectedNode: state.selectedNode,
      selectedEdge: state.selectedEdge,
      editingImpairment: state.editingImpairment,
      editingNode: state.editingNode,
      editingEdge: state.editingEdge,
      editingNetwork: state.editingNetwork,
      endpointLabelOffset: state.endpointLabelOffset
    },
    edgeAnnotationLookup
  );
  // Edit tab on a selected node (deployed labs select on click): open the full
  // node editor, exactly like double-click or the context menu Edit action.
  const handleOpenSelectedNodeEditor = React.useCallback(() => {
    const { selectedNode } = useTopoViewerStore.getState();
    if (selectedNode == null || selectedNode.length === 0) return;
    const node = useGraphStore.getState().nodes.find((entry) => entry.id === selectedNode);
    if (!node) return;
    if (node.type === "network-node") {
      topoActions.editNetwork(selectedNode);
    } else {
      topoActions.editNode(selectedNode);
    }
  }, [topoActions]);

  const customNodeCommands = useCustomNodeCommands(
    state.customNodes,
    topoActions.editCustomTemplate
  );

  const menuHandlers = useContextMenuHandlers({
    selectNode: topoActions.selectNode,
    selectEdge: topoActions.selectEdge,
    editNode: topoActions.editNode,
    editEdge: topoActions.editEdge,
    editNetwork: topoActions.editNetwork,
    onDeleteNode: topoActions.clearSelectionForDeletedNode,
    onDeleteEdge: topoActions.clearSelectionForDeletedEdge
  });

  const graphHandlers = useAppGraphHandlers({
    rfInstance,
    menuHandlers,
    actions: {
      addNode: graphActions.addNode,
      addEdge: graphActions.addEdge,
      removeNodeAndEdges: graphActions.removeNodeAndEdges,
      removeEdge: graphActions.removeEdge,
      updateNodeData: graphActions.updateNodeData,
      updateEdge: graphActions.updateEdge,
      renameNode: graphActions.renameNode
    }
  });

  const updateEdgeNetemData = React.useCallback(
    (data: LinkImpairmentData) => {
      const { edges } = useGraphStore.getState();
      const edge = edges.find((item) => item.id === data.id);
      if (!edge) return;
      const edgeData = edge.data;
      const extraData = toRecord(edgeData?.extraData);
      const currentSourceNetem = toNetemState(extraData.clabSourceNetem);
      const currentTargetNetem = toNetemState(extraData.clabTargetNetem);
      const hasNetemChanges =
        !areNetemEquivalent(currentSourceNetem, data.sourceNetem) ||
        !areNetemEquivalent(currentTargetNetem, data.targetNetem);
      const nextExtraData: Record<string, unknown> = {
        ...extraData,
        clabSourceNetem: data.sourceNetem,
        clabTargetNetem: data.targetNetem
      };
      if (hasNetemChanges) {
        nextExtraData[PENDING_NETEM_KEY] = createPendingNetemOverride(
          data.sourceNetem,
          data.targetNetem
        );
      }
      graphActions.updateEdgeData(data.id, {
        extraData: nextExtraData
      });
    },
    [graphActions]
  );

  const handleLinkImpairmentSave = React.useCallback(
    (data: LinkImpairmentData) => {
      updateEdgeNetemData(data);
      topoActions.editImpairment(null);
    },
    [topoActions, updateEdgeNetemData]
  );

  const handleLinkImpairmentApply = React.useCallback(
    (data: LinkImpairmentData) => {
      updateEdgeNetemData(data);
    },
    [updateEdgeNetemData]
  );

  const handleLinkImpairmentError = React.useCallback(
    (error: string) => {
      addToast(error, "error");
    },
    [addToast]
  );

  const { nodeEditorHandlers, linkEditorHandlers, networkEditorHandlers } = useAppEditorBindings({
    selectionData,
    state: {
      edgeAnnotations: state.edgeAnnotations
    },
    actions: {
      editNode: topoActions.editNode,
      editEdge: topoActions.editEdge,
      editNetwork: topoActions.editNetwork,
      setEdgeAnnotations: topoActions.setEdgeAnnotations,
      refreshEditorData: topoActions.refreshEditorData
    },
    renameNodeInGraph: graphHandlers.renameNodeInGraph,
    handleUpdateNodeData: graphHandlers.handleUpdateNodeData,
    handleUpdateEdgeData: graphHandlers.handleUpdateEdgeData
  });

  const getGraphNodes = React.useCallback(
    () => useGraphStore.getState().nodes.filter(isTopoNode),
    []
  );

  const graphCreation = useGraphCreation({
    rfInstance,
    onLockedAction: handleLockedAction,
    state: {
      mode: interactionMode,
      isLocked: isInteractionLocked,
      customNodes: state.customNodes,
      defaultNode: state.defaultNode,
      getNodes: getGraphNodes
    },
    onEdgeCreated: graphHandlers.handleEdgeCreated,
    onNodeCreated: graphHandlers.handleNodeCreatedCallback,
    addNode: graphHandlers.addNodeDirect,
    onNewCustomNode: customNodeCommands.onNewCustomNode
  });

  // Drag-drop handlers for node palette
  const handleDropCreateNode = React.useCallback(
    (position: { x: number; y: number }, templateName: string) => {
      if (isInteractionLocked) {
        handleLockedAction();
        return;
      }
      // Find the template by name
      const template = state.customNodes.find((t) => t.name === templateName);
      if (template) {
        graphCreation.createNodeAtPosition(position, template);
      }
    },
    [isInteractionLocked, state.customNodes, graphCreation, handleLockedAction]
  );

  const handleDropCreateNetwork = React.useCallback(
    (position: { x: number; y: number }, networkType: string) => {
      if (isInteractionLocked) {
        handleLockedAction();
        return;
      }
      if (!isNetworkTypeValue(networkType)) return;
      graphCreation.createNetworkAtPosition(position, networkType);
    },
    [isInteractionLocked, graphCreation, handleLockedAction]
  );

  useAppE2EExposure({
    state: {
      isLocked: isInteractionLocked,
      mode: interactionMode,
      selectedNode: state.selectedNode,
      selectedEdge: state.selectedEdge
    },
    actions: {
      toggleLock: topoActions.toggleLock,
      setMode: topoActions.setMode,
      editNode: topoActions.editNode,
      editNetwork: topoActions.editNetwork,
      selectNode: topoActions.selectNode,
      selectEdge: topoActions.selectEdge
    },
    undoRedo,
    graphHandlers,
    annotations: {
      handleAddGroup: annotationActions.handleAddGroup,
      getGroups: getAnnotationGroups
    },
    graphCreation,
    layoutControls,
    rfInstance
  });

  const { handleDeselectAll } = useAppHandlers({
    selectionCallbacks: {
      selectNode: topoActions.selectNode,
      selectEdge: topoActions.selectEdge,
      editNode: topoActions.editNode,
      editEdge: topoActions.editEdge
    },
    rfInstance
  });

  const shortcutDisplay = useShortcutDisplay();
  const panelVisibility = usePanelVisibility();

  const clearAllEditingState = React.useCallback(() => {
    topoActions.editNode(null);
    topoActions.editEdge(null);
    topoActions.editImpairment(null);
    topoActions.editNetwork(null);
    topoActions.selectNode(null);
    topoActions.selectEdge(null);
    annotationUiActions.closeTextEditor();
    annotationUiActions.closeShapeEditor();
    annotationUiActions.closeTrafficRateEditor();
    annotationUiActions.closeGroupEditor();
  }, [topoActions, annotationUiActions]);

  const hasContextContent = hasContextContentState(state, annotationUiState);

  const handleEmptyCanvasClick = React.useCallback(() => {
    // When dismissing any context (editors/info) via empty canvas click, close the context panel
    // instead of falling back to the Nodes/Annotations palette view.
    // Exception: if the user opened the panel manually, keep it open until they close it.
    const shouldClosePanel =
      panelVisibility.isContextPanelOpen &&
      panelVisibility.contextPanelOpenReason !== "manual" &&
      hasContextContent;

    clearAllEditingState();

    if (shouldClosePanel) {
      panelVisibility.handleCloseContextPanel();
    }
  }, [clearAllEditingState, hasContextContent, panelVisibility]);

  const processingRef = React.useRef(false);
  React.useEffect(() => {
    if (isProcessing) {
      if (processingRef.current) return;
      processingRef.current = true;
      clearAllEditingState();
      annotationUiActions.disableAddTextMode();
      annotationUiActions.disableAddShapeMode();
      annotationUiActions.clearAllSelections();
      panelVisibility.handleCloseBulkLink();
      panelVisibility.handleCloseLabSettings();
      return;
    }
    processingRef.current = false;
  }, [annotationUiActions, clearAllEditingState, isProcessing, panelVisibility]);

  const clipboardHandlers = useClipboardHandlers({
    annotations: {
      getNodeMembership: annotationActions.getNodeMembership,
      addNodeToGroup: annotationActions.addNodeToGroup,
      deleteAllSelected: annotationActions.deleteAllSelected
    },
    rfInstance,
    handleNodeCreatedCallback: graphHandlers.handleNodeCreatedCallback,
    handleEdgeCreated: graphHandlers.handleEdgeCreated,
    handleBatchPaste: graphHandlers.handleBatchPaste
  });

  const handleDeleteSelection = React.useCallback(() => {
    const { nodes: currentNodes, edges: currentEdges } = useGraphStore.getState();
    const { nodeIds, edgeIds } = collectSelectedIds(
      currentNodes,
      currentEdges,
      state.selectedNode,
      state.selectedEdge
    );
    if (nodeIds.size === 0 && edgeIds.size === 0) return;

    const nodesById = new Map(currentNodes.map((node) => [node.id, node]));
    const edgesById = new Map(currentEdges.filter(isTopoEdge).map((edge) => [edge.id, edge]));

    const { graphNodeIds, groupIds, textIds, shapeIds, trafficRateIds } = splitNodeIdsByType(
      nodeIds,
      nodesById
    );

    applyGraphDeletions(graphActions, menuHandlers, graphNodeIds, edgeIds);

    const annotationResult = annotationActions.deleteSelectedForBatch({
      groupIds,
      textIds,
      shapeIds,
      trafficRateIds
    });

    const commands = buildDeleteCommands(graphNodeIds, edgeIds, edgesById);

    if (annotationResult.didDelete || annotationResult.membersCleared) {
      const graphNodesForSave = useGraphStore.getState().nodes.filter(isTopoNode);
      commands.push(buildAnnotationSaveCommand(graphNodesForSave));
    }

    if (commands.length === 0) return;

    executeTopologyCommand(
      { command: "batch", payload: { commands } },
      { applySnapshot: false },
      sessionClient
    ).catch((err) => {
      console.error("[TopoViewer] Failed to batch delete", err);
    });
  }, [
    annotationActions,
    graphActions,
    menuHandlers,
    sessionClient,
    state.selectedEdge,
    state.selectedNode
  ]);

  useAppKeyboardShortcuts({
    disabled: viewerOnly,
    state: {
      mode: interactionMode,
      isLocked: isInteractionLocked,
      selectedNode: state.selectedNode,
      selectedEdge: state.selectedEdge
    },
    undoRedo,
    annotations: {
      selectedTextIds: annotationUiState.selectedTextIds,
      selectedShapeIds: annotationUiState.selectedShapeIds,
      selectedTrafficRateIds: annotationUiState.selectedTrafficRateIds,
      selectedGroupIds: annotationUiState.selectedGroupIds,
      clearAllSelections: annotationUiActions.clearAllSelections,
      handleAddGroup: annotationActions.handleAddGroup
    },
    clipboardHandlers,
    deleteHandlers: {
      handleDeleteNode: graphHandlers.handleDeleteNode,
      handleDeleteLink: graphHandlers.handleDeleteLink,
      handleDeleteSelection
    },
    handleDeselectAll
  });

  const easterEgg = useEasterEgg({});

  // On a new selection/edit, route the sidebar to the palette (so the editor is
  // visible) and auto-open it. Rising-edge only, so switching to the Explorer
  // view with a lingering selection isn't immediately overridden.
  const hadContextContentRef = React.useRef(false);
  React.useEffect(() => {
    const isNewSelection = hasContextContent && !hadContextContentRef.current;
    hadContextContentRef.current = hasContextContent;
    if (!isNewSelection || !hasActiveTopology || viewerOnly || isProcessing) {
      return;
    }
    panelVisibility.setActiveSidebarView("palette");
    if (panelVisibility.autoOpenOnInteraction && !panelVisibility.isContextPanelOpen) {
      panelVisibility.handleOpenContextPanel("auto");
    }
  }, [hasActiveTopology, viewerOnly, hasContextContent, isProcessing, panelVisibility]);

  const handleSelectSidebarView = React.useCallback(
    (view: SidebarView) => {
      panelVisibility.setActiveSidebarView(view);
      panelVisibility.handleOpenContextPanel("manual");
    },
    [panelVisibility]
  );

  // close if palette wasn't open, else go back to palette
  const handleContextPanelBack = React.useCallback(() => {
    const shouldClose = panelVisibility.contextPanelOpenReason === "auto";
    clearAllEditingState();
    if (shouldClose) {
      panelVisibility.handleCloseContextPanel();
    }
  }, [clearAllEditingState, panelVisibility]);

  const handleZoomToFit = React.useCallback(() => {
    if (reactFlowRef.current) {
      reactFlowRef.current.fit();
      return;
    }
    rfInstance?.fitView({ padding: 0.1 }).catch(() => {
      /* ignore */
    });
  }, [reactFlowRef, rfInstance]);

  const handleOpenNodePalette = React.useCallback(() => {
    if (!hasActiveTopology || viewerOnly) {
      return;
    }
    handleContextPanelBack();
    panelVisibility.handleOpenContextPanel();
  }, [handleContextPanelBack, hasActiveTopology, panelVisibility, viewerOnly]);

  const canvasProps = React.useMemo<CanvasPropsWithoutGraph>(
    () => ({
      topologyViewportKey,
      isContextPanelOpen: !viewerOnly && hasActiveTopology && panelVisibility.isContextPanelOpen,
      readOnlyViewer: viewerOnly,
      onPaneClick: handleEmptyCanvasClick,
      layout: layoutControls.layout,
      isGeoLayout: layoutControls.isGeoLayout,
      gridLineWidth: layoutControls.gridLineWidth,
      gridStyle: layoutControls.gridStyle,
      gridColor: layoutControls.gridColor,
      gridBgColor: layoutControls.gridBgColor,
      annotationMode,
      annotationHandlers: canvasAnnotationHandlers,
      linkLabelMode: state.linkLabelMode,
      onInit,
      onEdgeCreated: graphHandlers.handleEdgeCreated,
      onShiftClickCreate: graphCreation.createNodeAtPosition,
      onNodeDelete: graphHandlers.handleDeleteNode,
      onEdgeDelete: graphHandlers.handleDeleteLink,
      onOpenNodePalette: handleOpenNodePalette,
      onAddGroup: annotationActions.handleAddGroup,
      onAddText: annotationActions.handleAddText,
      onAddShapes: annotationActions.handleAddShapes,
      onAddTextAtPosition: annotationActions.createTextAtPosition,
      onAddGroupAtPosition: annotationActions.createGroupAtPosition,
      onAddShapeAtPosition: annotationActions.createShapeAtPosition,
      onAddTrafficRateAtPosition: annotationActions.createTrafficRateAtPosition,
      onDropCreateNode: handleDropCreateNode,
      onDropCreateNetwork: handleDropCreateNetwork,
      onTopologyNodePositionCommit: layoutControls.markLayoutPreset,
      onLockedAction: handleLockedAction
    }),
    [
      topologyViewportKey,
      viewerOnly,
      hasActiveTopology,
      panelVisibility.isContextPanelOpen,
      handleEmptyCanvasClick,
      layoutControls.layout,
      layoutControls.isGeoLayout,
      layoutControls.gridLineWidth,
      layoutControls.gridStyle,
      layoutControls.gridColor,
      layoutControls.gridBgColor,
      annotationMode,
      canvasAnnotationHandlers,
      state.linkLabelMode,
      onInit,
      graphHandlers.handleEdgeCreated,
      graphCreation.createNodeAtPosition,
      graphHandlers.handleDeleteNode,
      graphHandlers.handleDeleteLink,
      handleOpenNodePalette,
      annotationActions,
      handleDropCreateNode,
      handleDropCreateNetwork,
      layoutControls.markLayoutPreset,
      handleLockedAction
    ]
  );

  const handleNetworkSave = React.useCallback(
    (data: Parameters<typeof networkEditorHandlers.handleSave>[0]) => {
      networkEditorHandlers.handleSave(data).catch((err) => {
        console.error("[TopoViewer] Network editor save failed", err);
      });
    },
    [networkEditorHandlers]
  );

  const handleNetworkApply = React.useCallback(
    (data: Parameters<typeof networkEditorHandlers.handleApply>[0]) => {
      networkEditorHandlers.handleApply(data).catch((err) => {
        console.error("[TopoViewer] Network editor apply failed", err);
      });
    },
    [networkEditorHandlers]
  );

  const handleCloseLifecycleModal = React.useCallback(() => {
    topoActions.closeLifecycleModal();
  }, [topoActions]);

  const handleCancelLifecycle = React.useCallback(() => {
    host.topoViewer.cancelLifecycle();
  }, [host]);

  const isBulkLinkModalOpen = shouldShowBulkLinkModal(
    hasActiveTopology,
    panelVisibility.showBulkLinkModal,
    isProcessing
  );

  const autoOpenedEmptyExplorerRef = React.useRef(false);
  React.useEffect(() => {
    if (hasActiveTopology) {
      autoOpenedEmptyExplorerRef.current = false;
      return;
    }
    // Without a topology the palette/editor views have nothing to show, so point
    // the sidebar at the Explorer. Auto-open it once per empty session so the
    // user can still collapse it with the rail button afterwards.
    if (showDevExplorer) {
      // Only the palette view needs a topology; leave Explorer/Files selected.
      if (panelVisibility.activeSidebarView === "palette") {
        panelVisibility.setActiveSidebarView("explorer");
      }
      if (!autoOpenedEmptyExplorerRef.current) {
        autoOpenedEmptyExplorerRef.current = true;
        if (!panelVisibility.isContextPanelOpen) {
          panelVisibility.handleOpenContextPanel("manual");
        }
      }
    }
    // The settings modal stays available without a lab (it hides the Lab
    // section itself); only the topology-specific modals get dismissed.
    if (panelVisibility.showSvgExportModal) {
      panelVisibility.handleCloseSvgExport();
    }
    if (panelVisibility.showBulkLinkModal) {
      panelVisibility.handleCloseBulkLink();
    }
  }, [hasActiveTopology, showDevExplorer, panelVisibility]);

  const previousHasActiveTopology = React.useRef(hasActiveTopology);
  React.useEffect(() => {
    const becameActive = !previousHasActiveTopology.current && hasActiveTopology;
    previousHasActiveTopology.current = hasActiveTopology;

    if (!becameActive || !panelVisibility.isContextPanelOpen) {
      return;
    }

    const timer = window.setTimeout(() => {
      useCanvasStore.getState().requestFitView();
    }, 280);

    return () => {
      window.clearTimeout(timer);
    };
  }, [hasActiveTopology, panelVisibility.isContextPanelOpen]);

  const handleLinkLabelModeChange = React.useCallback(
    (mode: Parameters<typeof topoActions.setLinkLabelMode>[0]) => {
      // Callback-only read: fetch the latest value on demand instead of
      // subscribing AppContent to lastNonTelemetryLinkLabelMode changes.
      const { lastNonTelemetryLinkLabelMode } = useTopoViewerStore.getState();
      topoActions.setLinkLabelMode(mode);
      const nextLastNonTelemetryMode =
        mode === "telemetry-style" ? lastNonTelemetryLinkLabelMode : mode;
      const style = mode === "telemetry-style" ? "telemetry-style" : "default";
      void saveViewerSettings(sessionClient, {
        style,
        linkLabelMode: mode,
        lastNonTelemetryLinkLabelMode: nextLastNonTelemetryMode
      });
    },
    [sessionClient, topoActions]
  );

  // A host-supplied About dialog replaces the modal's Info section when present.
  const handleOpenSettings = (section?: SettingsSection) => {
    if (section === "info" && renderAboutModal) {
      panelVisibility.handleShowAbout();
      return;
    }
    panelVisibility.handleShowLabSettings(section);
  };

  const helpModal = helpOpen ? (
    <React.Suspense fallback={null}>
      <LazyHelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </React.Suspense>
  ) : null;

  let aboutModal: React.ReactNode = null;
  if (panelVisibility.showAboutPanel) {
    if (renderAboutModal) {
      aboutModal = renderAboutModal({
        isOpen: panelVisibility.showAboutPanel,
        onClose: panelVisibility.handleCloseAbout
      });
    } else {
      aboutModal = (
        <React.Suspense fallback={null}>
          <LazyAboutModal
            isOpen={panelVisibility.showAboutPanel}
            onClose={panelVisibility.handleCloseAbout}
          />
        </React.Suspense>
      );
    }
  }

  // The floating navbar and zoom controls sit opposite the rail/sidebar.
  const chromeSide = panelVisibility.sidebarSide === "left" ? "right" : "left";

  return (
    <AppThemeProvider>
      <Box
        data-testid="topoviewer-app"
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          width: "100%",
          overflow: "hidden",
          position: "relative"
        }}
      >
        <AnnotationRuntimeBridge
          rfInstance={rfInstance}
          onLockedAction={handleLockedAction}
          runtimeRef={annotationRuntimeRef}
        />
        {!viewerOnly && hasActiveTopology && (
          <Navbar
            hasActiveTopology={hasActiveTopology}
            layout={layoutControls.layout}
            onLayoutChange={layoutControls.setLayout}
            onOpenSettings={handleOpenSettings}
            barSide={chromeSide}
            rfInstance={rfInstance}
            onCaptureViewport={panelVisibility.handleShowSvgExport}
            onShowBulkLink={panelVisibility.handleShowBulkLink}
            linkLabelMode={state.linkLabelMode}
            onLinkLabelModeChange={handleLinkLabelModeChange}
            shortcutDisplayEnabled={shortcutDisplay.isEnabled}
            onToggleShortcutDisplay={shortcutDisplay.toggle}
            canUndo={undoRedo.canUndo}
            canRedo={undoRedo.canRedo}
            onUndo={undoRedo.undo}
            onRedo={undoRedo.redo}
            renderDeployMenuItems={renderDeployMenuItems}
          />
        )}
        <Box
          ref={layoutRef}
          style={{
            display: "flex",
            flexDirection: panelVisibility.sidebarSide === "right" ? "row-reverse" : "row",
            flexGrow: 1,
            overflow: "hidden",
            position: "relative"
          }}
        >
          {showSidebarChrome && (
            <SidebarRail
              activeView={panelVisibility.activeSidebarView}
              isOpen={panelVisibility.isContextPanelOpen}
              side={panelVisibility.sidebarSide}
              showExplorer={showDevExplorer}
              showFiles={showDevExplorer}
              showPalette={hasActiveTopology}
              onSelectView={handleSelectSidebarView}
              onClose={panelVisibility.handleCloseContextPanel}
              onToggleSide={panelVisibility.handleToggleSidebarSide}
              onOpenSettings={() => handleOpenSettings("general")}
              onOpenHelp={() => setHelpOpen(true)}
              colorScheme={colorScheme}
            />
          )}
          <Box style={{ display: "flex", flexGrow: 1, overflow: "hidden", position: "relative" }}>
          {showSidebarChrome && (
            <ContextPanel
              isOpen={panelVisibility.isContextPanelOpen}
              side={panelVisibility.sidebarSide}
              activeView={panelVisibility.activeSidebarView}
              renderExplorer={renderExplorerContent}
              rfInstance={rfInstance}
              palette={{
                mode: state.mode,
                requestedTab: undefined,

                onEditCustomNode: customNodeCommands.onEditCustomNode,
                onDeleteCustomNode: customNodeCommands.onDeleteCustomNode,
                onSetDefaultCustomNode: customNodeCommands.onSetDefaultCustomNode
              }}
              view={{
                selectedNodeData: selectionData.selectedNodeData,
                selectedLinkData: selectionData.selectedLinkData
              }}
              editor={{
                editingNodeData: selectionData.editingNodeData,
                editingNodeInheritedProps: selectionData.editingNodeInheritedProps,
                onOpenSelectedNodeEditor: handleOpenSelectedNodeEditor,
                nodeEditorHandlers: {
                  handleClose: nodeEditorHandlers.handleClose,
                  handleSave: nodeEditorHandlers.handleSave,
                  handleApply: nodeEditorHandlers.handleApply,
                  previewVisuals: nodeEditorHandlers.previewVisuals,
                  handleDelete: selectionData.editingNodeData
                    ? () => graphHandlers.handleDeleteNode(selectionData.editingNodeData!.id)
                    : undefined
                },
                editingLinkData: selectionData.editingLinkData,
                linkEditorHandlers: {
                  handleClose: linkEditorHandlers.handleClose,
                  handleSave: linkEditorHandlers.handleSave,
                  handleApply: linkEditorHandlers.handleApply,
                  previewOffset: linkEditorHandlers.previewOffset,
                  revertOffset: linkEditorHandlers.revertOffset,
                  handleDelete: selectionData.editingLinkData
                    ? () => graphHandlers.handleDeleteLink(selectionData.editingLinkData!.id)
                    : undefined
                },
                editingNetworkData: selectionData.editingNetworkData,
                networkEditorHandlers: {
                  handleClose: networkEditorHandlers.handleClose,
                  handleSave: handleNetworkSave,
                  handleApply: handleNetworkApply
                },
                linkImpairmentData: selectionData.selectedLinkImpairmentData,
                linkImpairmentHandlers: {
                  onError: handleLinkImpairmentError,
                  onApply: handleLinkImpairmentApply,
                  onSave: handleLinkImpairmentSave,
                  onClose: () => topoActions.editImpairment(null)
                },
                editingTextAnnotation: annotationUiState.editingTextAnnotation,
                textAnnotationHandlers: {
                  onApply: annotationActions.applyTextAnnotationEdit,
                  onClose: annotationUiActions.closeTextEditor,
                  onDelete: annotationActions.deleteTextAnnotation
                },
                editingShapeAnnotation: annotationUiState.editingShapeAnnotation,
                shapeAnnotationHandlers: {
                  onApply: annotationActions.applyShapeAnnotationEdit,
                  onClose: annotationUiActions.closeShapeEditor,
                  onDelete: annotationActions.deleteShapeAnnotation
                },
                editingTrafficRateAnnotation: annotationUiState.editingTrafficRateAnnotation,
                trafficRateAnnotationHandlers: {
                  onApply: annotationActions.applyTrafficRateAnnotationEdit,
                  onClose: annotationUiActions.closeTrafficRateEditor,
                  onDelete: annotationActions.deleteTrafficRateAnnotation
                },
                editingGroup: annotationUiState.editingGroup,
                groupHandlers: {
                  onApply: annotationActions.applyGroupEdit,
                  onClose: annotationUiActions.closeGroupEditor,
                  onDelete: annotationActions.deleteGroup
                }
              }}
            />
          )}
          <Box
            component="main"
            style={{
              flexGrow: 1,
              overflow: "hidden",
              position: "relative"
            }}
          >
            <GraphCanvasMain
              canvasRef={reactFlowRef}
              canvasProps={canvasProps}
              showDummyLinks={state.showDummyLinks}
              edgeAnnotationLookup={edgeAnnotationLookup}
              endpointLabelOffset={state.endpointLabelOffset}
              endpointLabelOffsetEnabled={state.endpointLabelOffsetEnabled}
            />
            <ShortcutDisplay shortcuts={shortcutDisplay.shortcuts} />
            <EasterEggRenderer easterEgg={easterEgg} />
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />
            {hasActiveTopology && (
              <CanvasZoomControls
                rfInstance={rfInstance}
                onFitView={handleZoomToFit}
                side={chromeSide}
              />
            )}
          </Box>
          </Box>
        </Box>

        {/* Modals */}
        <LifecycleModalHost onClose={handleCloseLifecycleModal} onCancel={handleCancelLifecycle} />
        {panelVisibility.showLabSettingsModal ? (
          <React.Suspense fallback={null}>
            <LazySettingsModal
              isOpen={panelVisibility.showLabSettingsModal}
              onClose={panelVisibility.handleCloseLabSettings}
              mode={state.mode}
              isLocked={isInteractionLocked}
              labSettings={state.labSettings ?? { name: state.labName }}
              initialSection={panelVisibility.settingsSection}
              autoOpenOnInteraction={panelVisibility.autoOpenOnInteraction}
              onToggleAutoOpen={panelVisibility.handleToggleAutoOpen}
              customSections={customSettingsSections}
              showLabSettings={hasActiveTopology}
              gridLineWidth={layoutControls.gridLineWidth}
              onGridLineWidthChange={layoutControls.setGridLineWidth}
              gridStyle={layoutControls.gridStyle}
              onGridStyleChange={layoutControls.setGridStyle}
              gridColor={layoutControls.gridColor}
              onGridColorChange={layoutControls.setGridColor}
              gridBgColor={layoutControls.gridBgColor}
              onGridBgColorChange={layoutControls.setGridBgColor}
              onResetGridColors={layoutControls.resetGridColors}
            />
          </React.Suspense>
        ) : null}
        {panelVisibility.showSvgExportModal && (
          <SvgExportModalContainer
            onClose={panelVisibility.handleCloseSvgExport}
            rfInstance={rfInstance}
            labName={state.labName}
            customIcons={getCustomIconMap(state.customIcons)}
          />
        )}
        {isBulkLinkModalOpen ? (
          <React.Suspense fallback={null}>
            <LazyBulkLinkModal
              isOpen={isBulkLinkModalOpen}
              mode={interactionMode}
              isLocked={isInteractionLocked}
              onClose={panelVisibility.handleCloseBulkLink}
            />
          </React.Suspense>
        ) : null}
        {aboutModal}
        {helpModal}
      </Box>
    </AppThemeProvider>
  );
};
/* eslint-enable complexity */
