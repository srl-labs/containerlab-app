// Zustand store for TopoViewer UI state.
import { createWithEqualityFn } from "zustand/traditional";
import { shallow } from "zustand/shallow";

import type { CustomNodeTemplate, CustomTemplateEditorData } from "../core/types/editors";
import type { EdgeAnnotation } from "../core/types/topology";
import type { CustomIconInfo } from "../core/types/icons";
import type { LabSettings } from "../core/types/labSettings";
import { upsertEdgeAnnotation } from "../annotations/edgeAnnotations";
import {
  DEFAULT_ENDPOINT_LABEL_OFFSET,
  clampEndpointLabelOffset
} from "../annotations/endpointLabelOffset";

import { useAnnotationUIStore } from "./annotationUIStore";
import { isRecord } from "../core/utilities/typeHelpers";

// ============================================================================
// Types
// ============================================================================

export type DeploymentState = "deployed" | "undeployed" | "unknown";
export type LinkLabelMode = "show-all" | "on-select" | "hide" | "telemetry-style";
export type NonTelemetryLinkLabelMode = Exclude<LinkLabelMode, "telemetry-style">;
type GridStyle = "dotted" | "quadratic";
export type ProcessingMode = "deploy" | "destroy" | "apply" | "start" | "stop" | "restart" | null;
type LifecycleLogStream = "stdout" | "stderr";
export type LifecycleStatus = "running" | "success" | "error" | null;

export interface LifecycleLogEntry {
  line: string;
  stream: LifecycleLogStream;
}

export interface TopoViewerState {
  labName: string;
  mode: "edit" | "view";
  deploymentState: DeploymentState;
  /**
   * Whether the on-disk topology diverged from the deployed runtime state
   * (i.e. apply would change something). `undefined` = unknown.
   */
  isDirty: boolean | undefined;
  /**
   * YAML content captured when the runtime is known to be in sync. Annotation
   * file updates must not dirty apply state while this content is unchanged.
   */
  cleanYamlContent: string | undefined;
  labSettings?: LabSettings;
  yamlFileName: string;
  annotationsFileName: string;
  /** Raw YAML content from host snapshot (used by Monaco source editors). */
  yamlContent: string;
  /** Raw annotations JSON content from host snapshot (used by Monaco source editors). */
  annotationsContent: string;
  documentRevision: string;
  selectedNode: string | null;
  selectedEdge: string | null;
  editingImpairment: string | null;
  editingNode: string | null;
  editingEdge: string | null;
  editingNetwork: string | null;
  isLocked: boolean;
  linkLabelMode: LinkLabelMode;
  lastNonTelemetryLinkLabelMode: NonTelemetryLinkLabelMode;
  showDummyLinks: boolean;
  endpointLabelOffsetEnabled: boolean;
  endpointLabelOffset: number;
  telemetryNodeSizePx: number;
  telemetryInterfaceSizePercent: number;
  showRateLabels: boolean;
  telemetryGlobalInterfaceOverrideSelection: string;
  telemetryInterfaceLabelOverrides: Record<string, string>;
  gridLineWidth: number;
  gridStyle: GridStyle;
  gridColor: string | null;
  gridBgColor: string | null;
  edgeAnnotations: EdgeAnnotation[];
  canUndo: boolean;
  canRedo: boolean;
  customNodes: CustomNodeTemplate[];
  defaultNode: string;
  customIcons: CustomIconInfo[];
  editingCustomTemplate: CustomTemplateEditorData | null;
  isProcessing: boolean;
  processingMode: ProcessingMode;
  lifecycleModalOpen: boolean;
  lifecycleStatus: LifecycleStatus;
  lifecycleStatusMessage: string | null;
  lifecycleLogs: LifecycleLogEntry[];
  editorDataVersion: number;
  customNodeError: string | null;
}

export interface TopoViewerActions {
  // Selection (mutually exclusive)
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;

  // Editing (mutually exclusive, clears selection)
  editNode: (nodeId: string | null) => void;
  editEdge: (edgeId: string | null) => void;
  editImpairment: (edgeId: string | null) => void;
  editNetwork: (nodeId: string | null) => void;

  // Mode and state
  setMode: (mode: "edit" | "view") => void;
  setDeploymentState: (state: DeploymentState) => void;
  setDirty: (dirty: boolean | undefined) => void;
  toggleLock: () => void;

  // Rendering settings
  setLinkLabelMode: (mode: LinkLabelMode) => void;
  toggleDummyLinks: () => void;
  toggleEndpointLabelOffset: () => void;
  setEndpointLabelOffset: (value: number) => void;
  setTelemetryNodeSizePx: (value: number) => void;
  setTelemetryInterfaceSizePercent: (value: number) => void;
  setShowRateLabels: (enabled: boolean) => void;
  setTelemetryGlobalInterfaceOverrideSelection: (value: string) => void;
  setTelemetryInterfaceLabelOverrides: (overrides: Record<string, string>) => void;
  setTelemetryInterfaceLabelOverride: (endpoint: string, override: string | null) => void;
  setGridLineWidth: (width: number) => void;
  setGridStyle: (style: GridStyle) => void;
  setGridColor: (color: string | null) => void;
  setGridBgColor: (color: string | null) => void;

  // Edge annotations
  setEdgeAnnotations: (annotations: EdgeAnnotation[]) => void;
  upsertEdgeAnnotation: (annotation: EdgeAnnotation) => void;

  // Custom nodes
  setCustomNodes: (customNodes: CustomNodeTemplate[], defaultNode: string) => void;
  setCustomIcons: (icons: CustomIconInfo[]) => void;
  editCustomTemplate: (data: CustomTemplateEditorData | null) => void;
  setCustomNodeError: (error: string | null) => void;
  clearCustomNodeError: () => void;

  // Processing state
  setProcessing: (isProcessing: boolean, mode?: Exclude<ProcessingMode, null>) => void;
  setLifecycleStatus: (status: LifecycleStatus, message?: string | null) => void;
  appendLifecycleLog: (line: string, stream?: LifecycleLogStream) => void;
  clearLifecycleLogs: () => void;
  closeLifecycleModal: () => void;

  // Data refresh
  refreshEditorData: () => void;

  // Cleanup helpers
  clearSelectionForDeletedNode: (nodeId: string) => void;
  clearSelectionForDeletedEdge: (edgeId: string) => void;

  // Initial data
  setInitialData: (data: Partial<TopoViewerState>) => void;
}

export type TopoViewerStore = TopoViewerState & TopoViewerActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: TopoViewerState = {
  labName: "",
  mode: "edit",
  deploymentState: "unknown",
  isDirty: undefined,
  cleanYamlContent: undefined,
  labSettings: undefined,
  yamlFileName: "topology.clab.yml",
  annotationsFileName: "topology.clab.yml.annotations.json",
  yamlContent: "",
  annotationsContent: "{}\n",
  documentRevision: "",
  selectedNode: null,
  selectedEdge: null,
  editingImpairment: null,
  editingNode: null,
  editingEdge: null,
  editingNetwork: null,
  isLocked: true,
  linkLabelMode: "show-all",
  lastNonTelemetryLinkLabelMode: "show-all",
  showDummyLinks: true,
  endpointLabelOffsetEnabled: true,
  endpointLabelOffset: DEFAULT_ENDPOINT_LABEL_OFFSET,
  telemetryNodeSizePx: 40,
  telemetryInterfaceSizePercent: 100,
  showRateLabels: false,
  telemetryGlobalInterfaceOverrideSelection: "__auto__",
  telemetryInterfaceLabelOverrides: {},
  gridLineWidth: 0.5,
  gridStyle: "dotted",
  gridColor: null,
  gridBgColor: null,
  edgeAnnotations: [],
  canUndo: false,
  canRedo: false,
  customNodes: [],
  defaultNode: "",
  customIcons: [],
  editingCustomTemplate: null,
  isProcessing: false,
  processingMode: null,
  lifecycleModalOpen: false,
  lifecycleStatus: null,
  lifecycleStatusMessage: null,
  lifecycleLogs: [],
  editorDataVersion: 0,
  customNodeError: null
};

const MAX_LIFECYCLE_LOG_LINES = 500;

// ============================================================================
// Helper Functions
// ============================================================================

function isCustomNodeTemplate(value: unknown): value is CustomNodeTemplate {
  return isRecord(value) && typeof value.name === "string" && typeof value.kind === "string";
}

function parseCustomNodeTemplates(value: unknown): CustomNodeTemplate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is CustomNodeTemplate => isCustomNodeTemplate(entry));
}

function isCustomIconInfo(value: unknown): value is CustomIconInfo {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.source === "workspace" || value.source === "global") &&
    typeof value.dataUri === "string" &&
    (value.format === "svg" || value.format === "png")
  );
}

function parseCustomIconInfos(value: unknown): CustomIconInfo[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is CustomIconInfo => isCustomIconInfo(entry));
}

function hasOwnProperty<T extends object, K extends PropertyKey>(
  value: T,
  key: K
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function resolveDirtyUpdate(
  dirty: boolean | undefined,
  yamlContent: string,
  cleanYamlContent: string | undefined
): Partial<Pick<TopoViewerState, "isDirty" | "cleanYamlContent">> {
  if (dirty === false) {
    return { isDirty: false, cleanYamlContent: yamlContent };
  }
  if (dirty === true) {
    if (cleanYamlContent !== undefined && yamlContent === cleanYamlContent) {
      return { isDirty: false };
    }
    return { isDirty: true };
  }
  return { isDirty: undefined };
}

function resolveInitialDataDirtyUpdate(
  state: TopoViewerState,
  data: Partial<TopoViewerState>
): Partial<Pick<TopoViewerState, "isDirty" | "cleanYamlContent">> {
  const hasYamlContent = hasOwnProperty(data, "yamlContent");
  const yamlContent = data.yamlContent ?? state.yamlContent;
  const fileChanged =
    hasOwnProperty(data, "yamlFileName") && data.yamlFileName !== state.yamlFileName;
  const cleanYamlContent = fileChanged ? undefined : state.cleanYamlContent;

  if (hasOwnProperty(data, "isDirty")) {
    return resolveDirtyUpdate(data.isDirty, yamlContent, cleanYamlContent);
  }
  if (fileChanged) {
    return { isDirty: undefined, cleanYamlContent: undefined };
  }
  if (hasYamlContent && cleanYamlContent !== undefined) {
    return { isDirty: yamlContent === cleanYamlContent ? false : true };
  }
  return {};
}

/** Parse non-topology bootstrap data from extension/dev host */
export function parseInitialData(data: unknown): Partial<TopoViewerState> {
  if (!isRecord(data)) return {};
  const obj = data;
  const defaultNode = typeof obj.defaultNode === "string" ? obj.defaultNode : "";
  return {
    customNodes: parseCustomNodeTemplates(obj.customNodes),
    defaultNode,
    customIcons: parseCustomIconInfos(obj.customIcons)
  };
}

// ============================================================================
// Store Creation
// ============================================================================

export const useTopoViewerStore = createWithEqualityFn<TopoViewerStore>((set, get) => ({
  ...initialState,

  // Selection (mutually exclusive)
  selectNode: (nodeId) => {
    set({ selectedNode: nodeId, selectedEdge: null, editingImpairment: null });
  },

  selectEdge: (edgeId) => {
    set({ selectedEdge: edgeId, selectedNode: null, editingImpairment: null });
  },

  // Editing (mutually exclusive, clears selection)
  editNode: (nodeId) => {
    set({
      editingNode: nodeId,
      editingEdge: null,
      editingImpairment: null,
      editingNetwork: null,
      selectedNode: null,
      selectedEdge: null
    });
  },

  editEdge: (edgeId) => {
    set({
      editingEdge: edgeId,
      editingNode: null,
      editingImpairment: null,
      editingNetwork: null,
      selectedNode: null,
      selectedEdge: null
    });
  },

  editImpairment: (edgeId) => {
    set({
      editingImpairment: edgeId,
      editingNode: null,
      editingEdge: null,
      editingNetwork: null,
      selectedNode: null,
      selectedEdge: null
    });
  },

  editNetwork: (nodeId) => {
    set({
      editingNetwork: nodeId,
      editingNode: null,
      editingEdge: null,
      editingImpairment: null,
      selectedNode: null,
      selectedEdge: null
    });
  },

  // Mode and state — clear selection & editing so stale tabs disappear
  setMode: (mode) => {
    set({
      mode,
      selectedNode: null,
      selectedEdge: null,
      editingNode: null,
      editingEdge: null,
      editingNetwork: null,
      editingImpairment: null,
      editingCustomTemplate: null
    });
    // Also clear annotation editing state (separate store)
    const annotationUI = useAnnotationUIStore.getState();
    if (annotationUI.editingTextAnnotation) annotationUI.setEditingTextAnnotation(null);
    if (annotationUI.editingShapeAnnotation) annotationUI.setEditingShapeAnnotation(null);
    if (annotationUI.editingTrafficRateAnnotation) annotationUI.closeTrafficRateEditor();
    if (annotationUI.editingGroup) annotationUI.closeGroupEditor();
  },

  setDeploymentState: (deploymentState) => {
    set({ deploymentState });
  },

  setDirty: (isDirty) => {
    set((state) => resolveDirtyUpdate(isDirty, state.yamlContent, state.cleanYamlContent));
  },

  toggleLock: () => {
    set((state) => ({ isLocked: !state.isLocked }));
  },

  // Rendering settings
  setLinkLabelMode: (linkLabelMode) => {
    set((state) => ({
      linkLabelMode,
      lastNonTelemetryLinkLabelMode:
        linkLabelMode === "telemetry-style" ? state.lastNonTelemetryLinkLabelMode : linkLabelMode
    }));
  },

  toggleDummyLinks: () => {
    set((state) => ({ showDummyLinks: !state.showDummyLinks }));
  },

  toggleEndpointLabelOffset: () => {
    set((state) => ({ endpointLabelOffsetEnabled: !state.endpointLabelOffsetEnabled }));
  },

  setEndpointLabelOffset: (value) => {
    const next = Number.isFinite(value)
      ? clampEndpointLabelOffset(value)
      : DEFAULT_ENDPOINT_LABEL_OFFSET;
    set({ endpointLabelOffset: next });
  },

  setTelemetryNodeSizePx: (value) => {
    const next = Number.isFinite(value) ? value : 40;
    set({ telemetryNodeSizePx: next });
  },

  setTelemetryInterfaceSizePercent: (value) => {
    const next = Number.isFinite(value) ? value : 100;
    set({ telemetryInterfaceSizePercent: next });
  },

  setShowRateLabels: (showRateLabels) => {
    set({ showRateLabels });
  },

  setTelemetryGlobalInterfaceOverrideSelection: (value) => {
    set({ telemetryGlobalInterfaceOverrideSelection: value });
  },

  setTelemetryInterfaceLabelOverrides: (overrides) => {
    set({ telemetryInterfaceLabelOverrides: { ...overrides } });
  },

  setTelemetryInterfaceLabelOverride: (endpoint, override) => {
    set((state) => {
      const next = { ...state.telemetryInterfaceLabelOverrides };
      if (override === null || override.trim().length === 0) {
        delete next[endpoint];
      } else {
        next[endpoint] = override.trim();
      }
      return { telemetryInterfaceLabelOverrides: next };
    });
  },

  setGridLineWidth: (gridLineWidth) => {
    set({ gridLineWidth });
  },

  setGridStyle: (gridStyle) => {
    set({ gridStyle });
  },

  setGridColor: (color) => {
    set({ gridColor: color });
  },

  setGridBgColor: (color) => {
    set({ gridBgColor: color });
  },

  // Edge annotations
  setEdgeAnnotations: (edgeAnnotations) => {
    set({ edgeAnnotations });
  },

  upsertEdgeAnnotation: (annotation) => {
    set((state) => ({
      edgeAnnotations: upsertEdgeAnnotation(state.edgeAnnotations, annotation)
    }));
  },

  // Custom nodes
  setCustomNodes: (customNodes, defaultNode) => {
    set({ customNodes, defaultNode, customNodeError: null });
  },

  setCustomIcons: (customIcons) => {
    set({ customIcons });
  },

  editCustomTemplate: (editingCustomTemplate) => {
    set((state) => ({
      editingCustomTemplate,
      editingNode: editingCustomTemplate ? null : state.editingNode,
      editingEdge: editingCustomTemplate ? null : state.editingEdge,
      editingNetwork: editingCustomTemplate ? null : state.editingNetwork,
      selectedNode: editingCustomTemplate ? null : state.selectedNode,
      selectedEdge: editingCustomTemplate ? null : state.selectedEdge
    }));
  },

  setCustomNodeError: (customNodeError) => {
    set({ customNodeError });
  },

  clearCustomNodeError: () => {
    set({ customNodeError: null });
  },

  // Processing state
  setProcessing: (isProcessing, mode) => {
    const next: Partial<TopoViewerState> = {
      isProcessing
    };

    if (isProcessing) {
      next.processingMode = mode ?? null;
      next.lifecycleModalOpen = true;
      next.lifecycleStatus = "running";
      next.lifecycleStatusMessage = null;
      next.editingNode = null;
      next.editingEdge = null;
      next.editingImpairment = null;
      next.editingNetwork = null;
      next.editingCustomTemplate = null;
      next.selectedNode = null;
      next.selectedEdge = null;
      next.lifecycleLogs = [];
    } else if (mode) {
      next.processingMode = mode;
    }

    set(next);
  },

  setLifecycleStatus: (lifecycleStatus, lifecycleStatusMessage = null) => {
    set({ lifecycleStatus, lifecycleStatusMessage });
  },

  appendLifecycleLog: (line, stream = "stdout") => {
    set((state) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        return state;
      }

      const nextLogs = [...state.lifecycleLogs, { line: trimmedLine, stream }];
      if (nextLogs.length > MAX_LIFECYCLE_LOG_LINES) {
        nextLogs.splice(0, nextLogs.length - MAX_LIFECYCLE_LOG_LINES);
      }

      return { lifecycleLogs: nextLogs };
    });
  },

  clearLifecycleLogs: () => {
    set({ lifecycleLogs: [] });
  },

  closeLifecycleModal: () => {
    set({
      lifecycleModalOpen: false,
      lifecycleStatus: null,
      lifecycleStatusMessage: null,
      lifecycleLogs: [],
      processingMode: null
    });
  },

  // Data refresh
  refreshEditorData: () => {
    set((state) => ({ editorDataVersion: state.editorDataVersion + 1 }));
  },

  // Cleanup helpers
  clearSelectionForDeletedNode: (nodeId) => {
    set((state) => ({
      selectedNode: state.selectedNode === nodeId ? null : state.selectedNode,
      editingNode: state.editingNode === nodeId ? null : state.editingNode,
      editingNetwork: state.editingNetwork === nodeId ? null : state.editingNetwork
    }));
  },

  clearSelectionForDeletedEdge: (edgeId) => {
    set((state) => ({
      selectedEdge: state.selectedEdge === edgeId ? null : state.selectedEdge,
      editingEdge: state.editingEdge === edgeId ? null : state.editingEdge,
      editingImpairment: state.editingImpairment === edgeId ? null : state.editingImpairment
    }));
  },

  // Initial data — if mode changes, clear selection & editing so stale tabs disappear
  setInitialData: (data) => {
    const currentState = get();
    const nextData = {
      ...data,
      ...resolveInitialDataDirtyUpdate(currentState, data)
    };

    if (data.mode && data.mode !== currentState.mode) {
      set({
        ...nextData,
        selectedNode: null,
        selectedEdge: null,
        editingNode: null,
        editingEdge: null,
        editingNetwork: null,
        editingImpairment: null,
        editingCustomTemplate: null
      });
      const annotationUI = useAnnotationUIStore.getState();
      if (annotationUI.editingTextAnnotation) annotationUI.setEditingTextAnnotation(null);
      if (annotationUI.editingShapeAnnotation) annotationUI.setEditingShapeAnnotation(null);
      if (annotationUI.editingTrafficRateAnnotation) annotationUI.closeTrafficRateEditor();
      if (annotationUI.editingGroup) annotationUI.closeGroupEditor();
    } else {
      set(nextData);
    }
  }
}));

// ============================================================================
// Selector Hooks (for convenience)
// ============================================================================

/** Get mode */
export const useMode = () => useTopoViewerStore((state) => state.mode);

/** Get lab name */
export const useLabName = () => useTopoViewerStore((state) => state.labName);

/** Get deployment state */
export const useDeploymentState = () => useTopoViewerStore((state) => state.deploymentState);

/** Get dirty state (on-disk topology diverged from runtime; undefined = unknown) */
export const useIsDirty = () => useTopoViewerStore((state) => state.isDirty);

/** Get lock state */
export const useIsLocked = () =>
  useTopoViewerStore((state) => state.isLocked || state.isProcessing);

/** Get Telemetry label rendering settings */
export const useTelemetryLabelSettings = () =>
  useTopoViewerStore(
    (state) => ({
      nodeSizePx: state.telemetryNodeSizePx,
      interfaceSizePercent: state.telemetryInterfaceSizePercent,
      showRateLabels: state.showRateLabels,
      globalInterfaceOverrideSelection: state.telemetryGlobalInterfaceOverrideSelection,
      interfaceLabelOverrides: state.telemetryInterfaceLabelOverrides
    }),
    shallow
  );

/** Get processing state */
export const useIsProcessing = () => useTopoViewerStore((state) => state.isProcessing);

/** Get custom nodes */
export const useCustomNodes = () => useTopoViewerStore((state) => state.customNodes);

/** Get custom icons */
export const useCustomIcons = () => useTopoViewerStore((state) => state.customIcons);

/** Get TopoViewer actions (stable reference) */
export const useTopoViewerActions = () =>
  useTopoViewerStore(
    (state) => ({
      selectNode: state.selectNode,
      selectEdge: state.selectEdge,
      editNode: state.editNode,
      editEdge: state.editEdge,
      editImpairment: state.editImpairment,
      editNetwork: state.editNetwork,
      setMode: state.setMode,
      setDeploymentState: state.setDeploymentState,
      setDirty: state.setDirty,
      toggleLock: state.toggleLock,
      setLinkLabelMode: state.setLinkLabelMode,
      toggleDummyLinks: state.toggleDummyLinks,
      toggleEndpointLabelOffset: state.toggleEndpointLabelOffset,
      setEndpointLabelOffset: state.setEndpointLabelOffset,
      setTelemetryNodeSizePx: state.setTelemetryNodeSizePx,
      setTelemetryInterfaceSizePercent: state.setTelemetryInterfaceSizePercent,
      setShowRateLabels: state.setShowRateLabels,
      setTelemetryGlobalInterfaceOverrideSelection:
        state.setTelemetryGlobalInterfaceOverrideSelection,
      setTelemetryInterfaceLabelOverrides: state.setTelemetryInterfaceLabelOverrides,
      setTelemetryInterfaceLabelOverride: state.setTelemetryInterfaceLabelOverride,
      setGridLineWidth: state.setGridLineWidth,
      setGridStyle: state.setGridStyle,
      setEdgeAnnotations: state.setEdgeAnnotations,
      upsertEdgeAnnotation: state.upsertEdgeAnnotation,
      setCustomNodes: state.setCustomNodes,
      setCustomIcons: state.setCustomIcons,
      editCustomTemplate: state.editCustomTemplate,
      setCustomNodeError: state.setCustomNodeError,
      clearCustomNodeError: state.clearCustomNodeError,
      setProcessing: state.setProcessing,
      setLifecycleStatus: state.setLifecycleStatus,
      appendLifecycleLog: state.appendLifecycleLog,
      clearLifecycleLogs: state.clearLifecycleLogs,
      closeLifecycleModal: state.closeLifecycleModal,
      refreshEditorData: state.refreshEditorData,
      clearSelectionForDeletedNode: state.clearSelectionForDeletedNode,
      clearSelectionForDeletedEdge: state.clearSelectionForDeletedEdge,
      setInitialData: state.setInitialData
    }),
    shallow
  );
