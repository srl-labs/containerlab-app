/**
 * Public topology editor. Workspace I/O is SandboxBackend (localStorage),
 * not the API-backed web app.
 */
import "@containerlab/clab-ui/styles/global.css";
import * as EditorWorkerModule from "@containerlab/clab-ui/monaco/editor-worker?worker";
import * as JsonWorkerModule from "@containerlab/clab-ui/monaco/json-worker?worker";
import * as YamlWorkerModule from "@containerlab/clab-ui/monaco/yaml-worker?worker";
import { lazy, Suspense } from "react";
import {
  App,
  EXPORT_COMMANDS,
  MSG_CANCEL_LAB_LIFECYCLE,
  MSG_FIT_VIEWPORT,
  MSG_SVG_EXPORT_RESULT,
  MuiThemeProvider,
  applyThemeVars,
  createWindowClabUiHost,
  createClabUiRuntime,
  createPortal,
  createRoot,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTopoViewerStore,
  type ReactRoot,
  type TopologyRef,
  type TopologySnapshot,
} from "./mainUiDependencies";

import { LabTabsBar } from "./components/LabTabsBar";
import {
  createStandaloneTopologyManager,
  extractEndpointIdFromTopologyId,
  isStandaloneLifecycleCommand,
  labsEqualForExplorer,
  useAuth,
  useEndpointStore,
  useEventStream,
  useWorkspaceFileEvents,
  useLabStore,
  type DeploymentState,
  type WorkspaceFileEvent,
} from "./mainRuntimeDependencies";
import {
  createStandaloneExplorerBridge,
  deleteUiCustomNode,
  deleteUiIcon,
  fetchRuntimeImages,
  fetchUiCustomNodes,
  fetchUiIcons,
  importUiIcons,
  pullRuntimeImage,
  isFileLabTab,
  loadTerminalPreferences,
  persistTerminalPreferences,
  readPersistedStandaloneTheme,
  reconcileUiIcons,
  removeRuntimeImage,
  replaceUiCustomNodes,
  resolveFileTab,
  resolveLabTab,
  runtimeUiActions,
  useRuntimeUiStore,
  saveUiCustomNode,
  setDefaultUiCustomNode,
  uploadUiIcon,
  useLabTabsStore,
  type FileLabTab,
  type TerminalPreferences,
} from "./mainApiDependencies";
import type * as ImageManagerExports from "@containerlab/clab-ui/image-manager";
import type {
  ContainerImageSummary,
  ImageActionResult,
  KindImageReference,
} from "@containerlab/clab-ui/image-manager";
import {
  mergeCustomNodeTemplates,
  parseCustomNodeTemplatesExportFile,
} from "@containerlab/clab-ui/session";
import { confirmRuntimeAction } from "./runtimeActionFlows";
import { getSandboxBackend } from "./sandboxBackend";

type ImageManagerModule = typeof ImageManagerExports;

let imageManagerModulePromise: Promise<ImageManagerModule> | null = null;

function loadImageManagerModule(): Promise<ImageManagerModule> {
  imageManagerModulePromise ??= import("@containerlab/clab-ui/image-manager");
  return imageManagerModulePromise;
}

const LazyAttractorEmptyState = lazy(async () => {
  const module = await import("./components/AttractorEmptyState");
  return { default: module.AttractorEmptyState };
});

const LazyFileEditorTabPanel = lazy(async () => {
  const module = await import("./components/FileEditorTabPanel");
  return { default: module.FileEditorTabPanel };
});

const FILE_TAB_TOPOLOGY_CHROME_CSS = `
  [data-testid="context-panel"],
  [data-testid="panel-toggle-btn"],
  [data-testid="panel-toggle-btn"] + * {
    display: none !important;
  }

  header.MuiAppBar-root:has([data-testid="navbar-lab-name"]) {
    display: none !important;
  }
`;

const LazySettingsOverlay = lazy(async () => {
  const module = await import("./components/SettingsOverlay");
  return { default: module.SettingsOverlay };
});

const LazyContainerlabImageManagerDialog = lazy(async () => {
  const module = await loadImageManagerModule();
  return { default: module.ContainerlabImageManagerDialog };
});

// Monaco workers setup
const monacoGlobal = self as typeof self & {
  MonacoEnvironment?: {
    getWorker: (workerId: string, label: string) => Worker;
  };
};
const EditorWorker = (EditorWorkerModule as { default: new () => Worker })
  .default;
const JsonWorker = (JsonWorkerModule as { default: new () => Worker }).default;
const YamlWorker = (YamlWorkerModule as { default: new () => Worker }).default;

if (!monacoGlobal.MonacoEnvironment) {
  monacoGlobal.MonacoEnvironment = {
    getWorker: (_workerId: string, label: string) => {
      if (label === "json") {
        return new JsonWorker();
      }
      if (label === "yaml") {
        return new YamlWorker();
      }
      return new EditorWorker();
    },
  };
}

// Initial data for the App
const initialData = {
  dockerImages: [] as string[],
  customNodes: [],
  defaultNode: "",
  customIcons: [],
};

function runningLabImageReferences(endpointId?: string): KindImageReference[] {
  const labs = endpointId
    ? useLabStore.getState().getLabsForEndpoint(endpointId)
    : useLabStore.getState().getAllLabs();
  const references: KindImageReference[] = [];
  for (const lab of labs.values()) {
    for (const container of lab.containers.values()) {
      if (!container.kind || !container.image) {
        continue;
      }
      references.push({
        kind: container.kind,
        image: container.image,
        source: "running-lab",
        label: `${lab.name} ${container.nodeName || container.name}`,
        endpointId: container.endpointId,
        path: lab.topologyPath,
        nodeName: container.nodeName,
      });
    }
  }
  return references;
}

async function activeTopologyImageReferences(
  endpointId?: string,
): Promise<KindImageReference[]> {
  if (!standaloneRuntime) {
    return [];
  }
  const context = standaloneRuntime.session.getContext();
  const contextEndpointId = extractEndpointIdFromTopologyId(
    context.topologyRef?.topologyId,
  );
  if (endpointId && contextEndpointId && endpointId !== contextEndpointId) {
    return [];
  }
  try {
    const snapshot = await standaloneRuntime.session.requestSnapshot();
    if (!snapshot.yamlContent.trim()) {
      return [];
    }
    const { collectKindImageReferencesFromYaml } =
      await loadImageManagerModule();
    return collectKindImageReferencesFromYaml(snapshot.yamlContent, {
      endpointId: contextEndpointId ?? endpointId,
      label: snapshot.labName || snapshot.yamlFileName,
      path: context.topologyRef?.yamlPath,
    });
  } catch {
    return [];
  }
}

async function standaloneImageReferences(
  endpointId?: string,
): Promise<KindImageReference[]> {
  const [activeRefs, customNodes, imageManagerModule] = await Promise.all([
    activeTopologyImageReferences(endpointId),
    fetchUiCustomNodes(endpointId).catch(() => ({ customNodes: [] })),
    loadImageManagerModule(),
  ]);
  return [
    ...activeRefs,
    ...runningLabImageReferences(endpointId),
    ...imageManagerModule.collectKindImageReferencesFromCustomTemplates(
      customNodes.customNodes,
      {
        endpointId,
        label: "Custom",
      },
    ),
  ];
}

function applyCustomNodes(
  customNodes: ReturnType<typeof useTopoViewerStore.getState>["customNodes"],
  defaultNode: string,
): void {
  useTopoViewerStore.getState().setCustomNodes(customNodes, defaultNode);
}

function rewriteTemplateIconNames(
  templates: ReturnType<typeof useTopoViewerStore.getState>["customNodes"],
  renamedIcons: Record<string, string>,
): ReturnType<typeof useTopoViewerStore.getState>["customNodes"] {
  if (Object.keys(renamedIcons).length === 0) {
    return templates;
  }
  return templates.map((template) => {
    const iconName = typeof template.icon === "string" ? template.icon : "";
    const renamedIcon = renamedIcons[iconName];
    if (renamedIcon === undefined) {
      return template;
    }
    return { ...template, icon: renamedIcon };
  });
}

function applyCustomIcons(
  customIcons: ReturnType<typeof useTopoViewerStore.getState>["customIcons"],
): void {
  useTopoViewerStore.getState().setCustomIcons(customIcons);
}

function applyCustomNodeError(error: string | null): void {
  useTopoViewerStore.getState().setCustomNodeError(error);
}

function clearStandaloneUiState(): void {
  applyCustomNodes([], "");
  applyCustomIcons([]);
  applyCustomNodeError(null);
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    let settled = false;
    let cancelTimer: number | null = null;
    const clearCancelTimer = () => {
      if (cancelTimer !== null) {
        window.clearTimeout(cancelTimer);
        cancelTimer = null;
      }
    };
    const cleanup = (file: File | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearCancelTimer();
      window.removeEventListener("focus", handleWindowFocus);
      input.removeEventListener("change", handleChange);
      input.removeEventListener("cancel", handleCancel);
      input.remove();
      resolve(file);
    };
    const handleChange = () => {
      cleanup(input.files?.[0] ?? null);
    };
    const handleCancel = () => {
      cleanup(null);
    };
    const handleWindowFocus = () => {
      clearCancelTimer();
      cancelTimer = window.setTimeout(() => {
        cleanup(input.files?.[0] ?? null);
      }, 300);
    };
    input.addEventListener("change", handleChange, { once: true });
    input.addEventListener("cancel", handleCancel, { once: true });
    window.addEventListener("focus", handleWindowFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

// Theme management
let currentTheme: "light" | "dark" = "dark";

function loadPersistedTheme(): "light" | "dark" {
  return readPersistedStandaloneTheme() ?? "dark";
}

function persistTheme(theme: "light" | "dark"): void {
  try {
    localStorage.setItem("clab-standalone-theme", theme);
  } catch {
    /* ignore */
  }
}

currentTheme = loadPersistedTheme();

const EXPLORER_REFRESH_DEBOUNCE_MS = 90;
const TOPOLOGY_REFRESH_DEBOUNCE_MS = 120;
function getConfiguredEndpoints() {
  return Array.from(useEndpointStore.getState().endpoints.values());
}

function getDefaultEndpointId(): string | undefined {
  return getConfiguredEndpoints()[0]?.id;
}

function getConnectedEndpointIdForUiAssets(): string | undefined {
  const configuredEndpoints = getConfiguredEndpoints();
  const currentEndpointId = topologyManager.getCurrentEndpointId();
  if (
    currentEndpointId &&
    configuredEndpoints.some(
      (endpoint) =>
        endpoint.id === currentEndpointId && endpoint.status === "connected",
    )
  ) {
    return currentEndpointId;
  }

  return configuredEndpoints.find((endpoint) => endpoint.status === "connected")
    ?.id;
}

function getEndpointIdForEditorContext(): string | undefined {
  return (
    topologyManager.getCurrentEndpointId() ??
    getConnectedEndpointIdForUiAssets()
  );
}

function hasActiveConnectedTopologySession(): boolean {
  return Boolean(
    getConnectedEndpointIdForUiAssets() &&
    topologyManager.getCurrentSessionId() &&
    topologyManager.getCurrentTopologyRef(),
  );
}

function createEmptyTopologySnapshot(): TopologySnapshot {
  return {
    revision: 0,
    nodes: [],
    edges: [],
    annotations: {},
    yamlFileName: "",
    annotationsFileName: "",
    yamlContent: "",
    annotationsContent: "{}",
    labName: "",
    mode: "edit",
    deploymentState: "undeployed",
    canUndo: false,
    canRedo: false,
  };
}

let scheduleExplorerSnapshot = (_delay?: number) => {};
let standaloneRuntime: ReturnType<typeof createClabUiRuntime> | null = null;

const topologyManager = createStandaloneTopologyManager({
  debounceMs: TOPOLOGY_REFRESH_DEBOUNCE_MS,
  getEndpoints: getConfiguredEndpoints,
  getDefaultEndpointId: getDefaultEndpointId,
  getSessionClient: () => {
    if (!standaloneRuntime) {
      throw new Error("Standalone runtime is not initialized.");
    }
    return standaloneRuntime.session;
  },
  getLabs: () => useLabStore.getState().labs,
  onTopologyFilesChanged: () => {
    scheduleExplorerSnapshot(0);
  },
});

let topologyTabActivationQueue: Promise<void> = Promise.resolve();

function queueTopologyTabActivation(task: () => Promise<void>): Promise<void> {
  const run = topologyTabActivationQueue.then(task, task);
  topologyTabActivationQueue = run.catch(() => {});
  return run;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveLabTabFallbackEndpointId(): string | undefined {
  return topologyManager.getCurrentEndpointId() ?? getDefaultEndpointId();
}

function requestViewportFitFromHost(): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: MSG_FIT_VIEWPORT },
    }),
  );
}

async function activateLabTabById(
  tabId: string,
  options: { deploymentState?: DeploymentState } = {},
): Promise<void> {
  const tab = useLabTabsStore
    .getState()
    .tabs.find((entry) => entry.id === tabId);
  if (!tab) {
    return;
  }
  useLabTabsStore.getState().setActiveTab(tab.id);
  if (isFileLabTab(tab)) {
    return;
  }
  try {
    await queueTopologyTabActivation(async () => {
      await topologyManager.loadTopologyFile(tab.topologyRef, {
        deploymentState: options.deploymentState,
        endpointId: tab.endpointId,
      });
    });
  } catch (error: unknown) {
    runtimeUiActions.notify(toErrorMessage(error), "error");
    throw error;
  }
}

async function openTopologyInTab(
  topologyRef: TopologyRef,
  options: { deploymentState?: DeploymentState; endpointId?: string } = {},
): Promise<void> {
  const resolvedTab = resolveLabTab(
    {
      endpointId: options.endpointId,
      topologyRef,
    },
    resolveLabTabFallbackEndpointId(),
  );
  const openResult = useLabTabsStore.getState().openOrFocusTab(resolvedTab);
  await activateLabTabById(openResult.tab.id, {
    deploymentState: options.deploymentState,
  });
  if (!openResult.alreadyOpen) {
    requestViewportFitFromHost();
  }
}

async function confirmCloseLabTab(tabId: string): Promise<boolean> {
  const tab = useLabTabsStore
    .getState()
    .tabs.find((entry) => entry.id === tabId);
  if (!isFileLabTab(tab) || tab.content === tab.originalContent) {
    return true;
  }
  return confirmRuntimeAction({
    title: "Discard Unsaved Changes",
    message: `Discard unsaved changes to "${tab.title}"?`,
    confirmLabel: "Discard",
    severity: "warning",
  });
}

function openWorkspaceFileInTab(document: {
  content: string;
  endpointId: string;
  path: string;
  title: string;
}): void {
  const tab = resolveFileTab(document);
  const openResult = useLabTabsStore.getState().openOrFocusTab(tab);
  useLabTabsStore.getState().setActiveTab(openResult.tab.id);
}

async function closeLabTabAndActivateNext(tabId: string): Promise<void> {
  if (!(await confirmCloseLabTab(tabId))) {
    return;
  }
  const closeResult = useLabTabsStore.getState().closeTab(tabId);
  if (!closeResult.removed || !closeResult.wasActive) {
    return;
  }
  if (closeResult.nextActiveTabId) {
    await activateLabTabById(closeResult.nextActiveTabId);
    return;
  }
  await queueTopologyTabActivation(async () => {
    await topologyManager.clearActiveTopology();
  });
}

async function closeEndpointTabsAndActivateNext(
  endpointId: string,
): Promise<void> {
  const closeResult = useLabTabsStore
    .getState()
    .closeTabsByEndpoint(endpointId);
  if (closeResult.removedCount === 0) {
    return;
  }
  if (closeResult.removedWasActive) {
    if (closeResult.nextActiveTabId) {
      await activateLabTabById(closeResult.nextActiveTabId);
    } else {
      await queueTopologyTabActivation(async () => {
        await topologyManager.clearActiveTopology();
      });
    }
  }
}

async function clearLabTabsAndActiveTopology(): Promise<void> {
  useLabTabsStore.getState().clear();
  await queueTopologyTabActivation(async () => {
    await topologyManager.clearActiveTopology();
  });
}

async function refreshCustomNodesForAuthenticatedUser(): Promise<void> {
  const response = await fetchUiCustomNodes(
    getConnectedEndpointIdForUiAssets(),
  );
  applyCustomNodes(response.customNodes, response.defaultNode);
}

async function refreshCustomIconsForCurrentTopology(): Promise<void> {
  const topologyRef = topologyManager.getCurrentTopologyRef();
  if (!topologyRef) {
    applyCustomIcons([]);
    return;
  }

  const response = await fetchUiIcons({
    endpointId: topologyManager.getCurrentEndpointId() ?? undefined,
    sessionId: topologyManager.getCurrentSessionId() ?? undefined,
    topologyRef,
  });
  applyCustomIcons(response.icons);
}

const explorerBridge = createStandaloneExplorerBridge({
  debounceMs: EXPLORER_REFRESH_DEBOUNCE_MS,
  getEndpoints: getConfiguredEndpoints,
  getLabs: () => useLabStore.getState().labs,
  invalidateTopologyFileListCache:
    topologyManager.invalidateTopologyFileListCache,
  defaultExpandExplorerTrees: true,
  lifecycleActionsAvailable: false,
  listTopologyFiles: topologyManager.listTopologyFiles,
  loadTopologyFile: openTopologyInTab,
  openFileEditor: openWorkspaceFileInTab,
  removeEndpoint: async (endpointId) => {
    await closeEndpointTabsAndActivateNext(endpointId);
    await topologyManager.disposeEndpointSession(endpointId);
  },
  resolveApiTopologyPath: topologyManager.resolveApiTopologyPath,
  resolveDeploymentState: topologyManager.resolveDeploymentState,
  resolveTopologyRef: topologyManager.resolveTopologyRef,
  runLifecycle: async () => {
    runtimeUiActions.notify(
      "Deploy is not available in the topology editor.",
      "warning",
    );
  },
});

scheduleExplorerSnapshot = explorerBridge.scheduleSnapshot;

function workspaceEventTouchesTopology(pathValue: string | undefined): boolean {
  return /\.clab\.ya?ml(?:\.annotations\.json)?$/i.test(pathValue ?? "");
}

type VscodeMessage = {
  baseName?: string;
  command?: string;
  dashboardJson?: string;
  data?: unknown;
  type?: string;
  fileLine?: string;
  iconName?: string;
  interfaceName?: string;
  level?: string;
  message?: string;
  name?: string;
  nodeName?: string;
  panelYaml?: string;
  requestId?: string;
  svgContent?: string;
  usedIcons?: unknown;
};

function triggerDownload(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function handleGrafanaBundleExport(msg: VscodeMessage): void {
  const baseName =
    typeof msg.baseName === "string"
      ? msg.baseName.trim() || "topology"
      : "topology";
  const svgContent = typeof msg.svgContent === "string" ? msg.svgContent : "";
  const dashboardJson =
    typeof msg.dashboardJson === "string" ? msg.dashboardJson : "";
  const panelYaml = typeof msg.panelYaml === "string" ? msg.panelYaml : "";
  if (svgContent) {
    triggerDownload(`${baseName}.svg`, svgContent, "image/svg+xml");
  }
  if (dashboardJson) {
    triggerDownload(
      `${baseName}.grafana.json`,
      dashboardJson,
      "application/json",
    );
  }
  if (panelYaml) {
    triggerDownload(
      `${baseName}.flow_panel.yaml`,
      panelYaml,
      "application/yaml",
    );
  }
  const files = [
    svgContent ? `${baseName}.svg` : null,
    dashboardJson ? `${baseName}.grafana.json` : null,
    panelYaml ? `${baseName}.flow_panel.yaml` : null,
  ].filter((value): value is string => value !== null);
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: MSG_SVG_EXPORT_RESULT,
        requestId: msg.requestId ?? "",
        success: true,
        files,
      },
    }),
  );
}

function handleSaveCustomNodeCommand(msg: VscodeMessage): void {
  const { command: _command, ...payload } = msg;
  void saveUiCustomNode(
    payload as Record<string, unknown>,
    getEndpointIdForEditorContext(),
  )
    .then((response) => {
      applyCustomNodeError(null);
      applyCustomNodes(response.customNodes, response.defaultNode);
    })
    .catch((error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      applyCustomNodeError(errorMessage);
      runtimeUiActions.notify(errorMessage, "error");
    });
}

function handleDeleteCustomNodeCommand(msg: VscodeMessage): void {
  const nodeName = typeof msg.name === "string" ? msg.name.trim() : "";
  if (!nodeName) {
    applyCustomNodeError("Missing custom node name.");
    return;
  }
  void deleteUiCustomNode(nodeName, getEndpointIdForEditorContext())
    .then((response) => {
      applyCustomNodeError(null);
      applyCustomNodes(response.customNodes, response.defaultNode);
    })
    .catch((error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      applyCustomNodeError(errorMessage);
      runtimeUiActions.notify(errorMessage, "error");
    });
}

function handleSetDefaultCustomNodeCommand(msg: VscodeMessage): void {
  const nodeName = typeof msg.name === "string" ? msg.name.trim() : "";
  if (!nodeName) {
    applyCustomNodeError("Missing custom node name.");
    return;
  }
  void setDefaultUiCustomNode(nodeName, getEndpointIdForEditorContext())
    .then((response) => {
      applyCustomNodeError(null);
      applyCustomNodes(response.customNodes, response.defaultNode);
    })
    .catch((error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      applyCustomNodeError(errorMessage);
      runtimeUiActions.notify(errorMessage, "error");
    });
}

function handleImportCustomNodesCommand(): void {
  void (async () => {
    try {
      const file = await pickFile(".json,application/json");
      if (!file) {
        return;
      }
      const parsed = parseCustomNodeTemplatesExportFile(await file.text());
      const iconImport = await importUiIcons(
        parsed.icons,
        getEndpointIdForEditorContext(),
      );
      const imported = rewriteTemplateIconNames(
        parsed.templates,
        iconImport.renamed,
      );
      const existing = useTopoViewerStore.getState().customNodes;
      const { customNodes, added, replaced } = mergeCustomNodeTemplates(
        existing,
        imported,
      );
      const response = await replaceUiCustomNodes(
        customNodes,
        getEndpointIdForEditorContext(),
      );
      applyCustomNodeError(null);
      applyCustomNodes(response.customNodes, response.defaultNode);
      await refreshCustomIconsForCurrentTopology();
      runtimeUiActions.notify(
        `Imported node templates: ${added} added, ${replaced} updated, ${iconImport.imported} icons imported`,
        "success",
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      applyCustomNodeError(errorMessage);
      runtimeUiActions.notify(errorMessage, "error");
    }
  })();
}

function handleIconUploadCommand(): void {
  void (async () => {
    try {
      const file = await pickFile(".svg,.png,image/svg+xml,image/png");
      if (!file) {
        return;
      }
      await uploadUiIcon(file, getEndpointIdForEditorContext());
      await refreshCustomIconsForCurrentTopology();
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      runtimeUiActions.notify(errorMessage, "error");
    }
  })();
}

function handleIconDeleteCommand(msg: VscodeMessage): void {
  const iconName = typeof msg.iconName === "string" ? msg.iconName.trim() : "";
  if (!iconName) {
    runtimeUiActions.notify("Missing icon name.", "error");
    return;
  }
  void deleteUiIcon(iconName, getEndpointIdForEditorContext())
    .then(() => refreshCustomIconsForCurrentTopology())
    .catch((error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      runtimeUiActions.notify(errorMessage, "error");
    });
}

function handleIconReconcileCommand(msg: VscodeMessage): void {
  const topologyRef = topologyManager.getCurrentTopologyRef();
  if (!topologyRef) {
    return;
  }
  const usedIcons = Array.isArray(msg.usedIcons)
    ? msg.usedIcons.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  void reconcileUiIcons({
    endpointId: topologyManager.getCurrentEndpointId() ?? undefined,
    sessionId: topologyManager.getCurrentSessionId() ?? undefined,
    topologyRef,
    usedIcons,
  }).catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[Standalone] icon reconcile failed:", errorMessage);
  });
}

type StandaloneMessageHandler = (msg: VscodeMessage) => void;

const STANDALONE_MESSAGE_HANDLERS: Record<string, StandaloneMessageHandler> = {
  [EXPORT_COMMANDS.EXPORT_SVG_GRAFANA_BUNDLE]: handleGrafanaBundleExport,
  "topo-toggle-split-view": () =>
    runtimeUiActions.notify(
      "Split view is not available in standalone mode yet.",
      "info",
    ),
  "save-custom-node": handleSaveCustomNodeCommand,
  "delete-custom-node": handleDeleteCustomNodeCommand,
  "set-default-custom-node": handleSetDefaultCustomNodeCommand,
  "import-custom-nodes": handleImportCustomNodesCommand,
  "icon-list": () => {
    void refreshCustomIconsForCurrentTopology().catch(() => {
      applyCustomIcons([]);
    });
  },
  "icon-upload": handleIconUploadCommand,
  "icon-delete": handleIconDeleteCommand,
  "icon-reconcile": handleIconReconcileCommand,
};

const IGNORED_STANDALONE_MESSAGE_COMMANDS = new Set([
  "reactTopoViewerLog",
  "topoViewerLog",
]);

// Editor host: clab-ui talks to SandboxBackend, not the web app HTTP API.
function setupStandaloneUiHost(): void {
  const warnedCommands = new Set<string>();

  const postMessage = (message: unknown) => {
    const msg = message as VscodeMessage | undefined;

    if (!msg?.command) return;

    if (IGNORED_STANDALONE_MESSAGE_COMMANDS.has(msg.command)) {
      return;
    }

    if (msg.command === MSG_CANCEL_LAB_LIFECYCLE) {
      return;
    }

    if (isStandaloneLifecycleCommand(msg.command)) {
      runtimeUiActions.notify(
        "This action is not available in the topology editor.",
        "warning",
      );
      return;
    }

    const handler = STANDALONE_MESSAGE_HANDLERS[msg.command];
    if (handler) {
      handler(msg);
      return;
    }

    if (!warnedCommands.has(msg.command)) {
      warnedCommands.add(msg.command);
      console.warn(`[Standalone] Unhandled VS Code command: ${msg.command}`);
    }
  };

  const apiHost = createWindowClabUiHost({
    explorer: explorerBridge.explorer,
    images: {
      async listImages(options): Promise<ContainerImageSummary[]> {
        const response = await fetchRuntimeImages(options?.endpointId);
        return response.images;
      },
      async listImageReferences(options): Promise<KindImageReference[]> {
        return standaloneImageReferences(options?.endpointId);
      },
      async pullImage(request): Promise<ImageActionResult> {
        return pullRuntimeImage({
          endpointId: request.endpointId,
          image: request.image,
        });
      },
      async removeImage(request): Promise<ImageActionResult> {
        return removeRuntimeImage({
          endpointId: request.endpointId,
          reference: request.reference,
          force: request.force,
        });
      },
    },
    postMessage,
    targetWindow: window,
    meta: {
      isDevMock: true,
      disableDevMockTraffic: true,
    },
    topology: {
      async requestSnapshot(context, requestOptions) {
        if (!hasActiveConnectedTopologySession()) {
          return createEmptyTopologySnapshot();
        }
        return getSandboxBackend().getSnapshot(context.sessionId, {
          externalChange: requestOptions?.externalChange,
        });
      },
      async dispatchCommand(context, revision, command) {
        const response = await getSandboxBackend().dispatchCommand(
          context.sessionId,
          revision,
          command,
        );
        if (response.type === "topology-host:ack") {
          const endpointId =
            extractEndpointIdFromTopologyId(context.topologyRef?.topologyId) ??
            topologyManager.getCurrentEndpointId() ??
            getDefaultEndpointId();
          topologyManager.invalidateTopologyFileListCache(endpointId);
          explorerBridge.invalidateFileExplorerCache(endpointId);
        }
        return response;
      },
    },
  });
  standaloneRuntime = createClabUiRuntime({
    host: apiHost,
  });
}

// Render

type StandaloneWindowState = Window & {
  __clabStandaloneReactRoot?: ReactRoot;
};

const standaloneWindowState = window as StandaloneWindowState;
let reactRoot: ReactRoot | null =
  standaloneWindowState.__clabStandaloneReactRoot ?? null;

function renderApp(): void {
  (window as unknown as Record<string, unknown>).__INITIAL_DATA__ = initialData;
  (window as unknown as Record<string, unknown>).__DOCKER_IMAGES__ =
    initialData.dockerImages;

  const container = document.getElementById("root");
  if (!container) throw new Error("Root element not found");

  if (!reactRoot) {
    reactRoot = createRoot(container);
    standaloneWindowState.__clabStandaloneReactRoot = reactRoot;
  }

  if (!standaloneRuntime) {
    throw new Error("Standalone runtime not configured");
  }

  reactRoot.render(<StandaloneApp />);
}

interface TabsHostResolution {
  created: boolean;
  host: HTMLDivElement | null;
}

function resolveLabTabsHostElement(): TabsHostResolution {
  const appRoot = document.querySelector("[data-testid='topoviewer-app']");
  if (!(appRoot instanceof HTMLDivElement)) {
    return { created: false, host: null };
  }

  const existingHost = appRoot.querySelector(
    "[data-standalone-lab-tabs-host='true']",
  );
  if (existingHost instanceof HTMLDivElement) {
    return { created: false, host: existingHost };
  }

  const mainElement = appRoot.querySelector("main");
  if (!(mainElement instanceof HTMLElement)) {
    return { created: false, host: null };
  }

  const host = document.createElement("div");
  host.setAttribute("data-standalone-lab-tabs-host", "true");
  host.style.position = "absolute";
  host.style.top = "0";
  host.style.left = "0";
  host.style.right = "0";
  host.style.zIndex = "7";
  host.style.pointerEvents = "auto";
  mainElement.insertBefore(host, mainElement.firstChild);
  return { created: true, host };
}

function resolveLabEmptyStateHostElement(): TabsHostResolution {
  const appRoot = document.querySelector("[data-testid='topoviewer-app']");
  if (!(appRoot instanceof HTMLDivElement)) {
    return { created: false, host: null };
  }

  const mainElement = appRoot.querySelector("main");
  if (!(mainElement instanceof HTMLElement)) {
    return { created: false, host: null };
  }

  const existingHost = mainElement.querySelector(
    "[data-standalone-lab-empty-host='true']",
  );
  if (existingHost instanceof HTMLDivElement) {
    return { created: false, host: existingHost };
  }

  const host = document.createElement("div");
  host.setAttribute("data-standalone-lab-empty-host", "true");
  host.style.position = "absolute";
  host.style.top = "0";
  host.style.left = "0";
  host.style.right = "0";
  host.style.bottom = "0";
  host.style.zIndex = "6";
  host.style.pointerEvents = "none";
  mainElement.appendChild(host);
  return { created: true, host };
}

function resolveFileEditorHostElement(): TabsHostResolution {
  const appRoot = document.querySelector("[data-testid='topoviewer-app']");
  if (!(appRoot instanceof HTMLDivElement)) {
    return { created: false, host: null };
  }

  const mainElement = appRoot.querySelector("main");
  if (!(mainElement instanceof HTMLElement)) {
    return { created: false, host: null };
  }

  const existingHost = mainElement.querySelector(
    "[data-standalone-file-editor-host='true']",
  );
  if (existingHost instanceof HTMLDivElement) {
    return { created: false, host: existingHost };
  }

  const host = document.createElement("div");
  host.setAttribute("data-standalone-file-editor-host", "true");
  host.style.position = "absolute";
  host.style.top = "45px";
  host.style.left = "0";
  host.style.right = "0";
  host.style.bottom = "0";
  host.style.zIndex = "6";
  host.style.pointerEvents = "none";
  mainElement.appendChild(host);
  return { created: true, host };
}

function useLabTabsPortalHost(): HTMLDivElement | null {
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    let ownedHost: HTMLDivElement | null = null;
    let observer: MutationObserver | null = null;

    const attach = () => {
      const resolution = resolveLabTabsHostElement();
      if (!resolution.host) {
        return false;
      }
      if (resolution.created) {
        ownedHost = resolution.host;
      }
      if (mounted) {
        setHost(resolution.host);
      }
      return true;
    };

    if (!attach()) {
      observer = new MutationObserver(() => {
        if (attach()) {
          observer?.disconnect();
          observer = null;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      mounted = false;
      observer?.disconnect();
      if (ownedHost && ownedHost.parentElement) {
        ownedHost.remove();
      }
      setHost(null);
    };
  }, []);

  return host;
}

function StandaloneLabTabsMount() {
  const host = useLabTabsPortalHost();
  const tabs = useLabTabsStore((state) => state.tabs);
  const activeTabId = useLabTabsStore((state) => state.activeTabId);
  const endpoints = useEndpointStore((state) => state.endpoints);

  const endpointLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const endpoint of endpoints.values()) {
      labels.set(endpoint.id, endpoint.label);
    }
    return labels;
  }, [endpoints]);

  const handleActivate = useCallback((tabId: string) => {
    void activateLabTabById(tabId);
  }, []);

  const handleClose = useCallback((tabId: string) => {
    void closeLabTabAndActivateNext(tabId);
  }, []);

  if (!host) {
    return null;
  }

  return createPortal(
    <LabTabsBar
      activeTabId={activeTabId}
      endpointLabels={endpointLabels}
      onActivate={handleActivate}
      onClose={handleClose}
      tabs={tabs}
    />,
    host,
  );
}

function useFileEditorPortalHost(): HTMLDivElement | null {
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    let ownedHost: HTMLDivElement | null = null;
    let observer: MutationObserver | null = null;

    const attach = () => {
      const resolution = resolveFileEditorHostElement();
      if (!resolution.host) {
        return false;
      }
      if (resolution.created) {
        ownedHost = resolution.host;
      }
      if (mounted) {
        setHost(resolution.host);
      }
      return true;
    };

    if (!attach()) {
      observer = new MutationObserver(() => {
        if (attach()) {
          observer?.disconnect();
          observer = null;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      mounted = false;
      observer?.disconnect();
      if (ownedHost && ownedHost.parentElement) {
        ownedHost.remove();
      }
      setHost(null);
    };
  }, []);

  return host;
}

function StandaloneFileEditorTabMount() {
  const host = useFileEditorPortalHost();
  const activeFileTab = useLabTabsStore((state): FileLabTab | null => {
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    return isFileLabTab(activeTab) ? activeTab : null;
  });

  const handleClose = useCallback((tabId: string) => {
    void closeLabTabAndActivateNext(tabId);
  }, []);

  if (!host || !activeFileTab) {
    return null;
  }

  return createPortal(
    <Suspense fallback={null}>
      <LazyFileEditorTabPanel onClose={handleClose} tab={activeFileTab} />
    </Suspense>,
    host,
  );
}

function useLabEmptyStatePortalHost(): HTMLDivElement | null {
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    let ownedHost: HTMLDivElement | null = null;
    let observer: MutationObserver | null = null;

    const attach = () => {
      const resolution = resolveLabEmptyStateHostElement();
      if (!resolution.host) {
        return false;
      }
      if (resolution.created) {
        ownedHost = resolution.host;
      }
      if (mounted) {
        setHost(resolution.host);
      }
      return true;
    };

    if (!attach()) {
      observer = new MutationObserver(() => {
        if (attach()) {
          observer?.disconnect();
          observer = null;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      mounted = false;
      observer?.disconnect();
      if (ownedHost && ownedHost.parentElement) {
        ownedHost.remove();
      }
      setHost(null);
    };
  }, []);

  return host;
}

function computeContextPanelOcclusion(host: HTMLDivElement | null): {
  left: number;
  right: number;
} {
  if (!host) {
    return { left: 0, right: 0 };
  }
  const hostRect = host.getBoundingClientRect();
  if (hostRect.width <= 0 || hostRect.height <= 0) {
    return { left: 0, right: 0 };
  }

  const panel = document.querySelector<HTMLElement>(
    "[data-testid='context-panel'] .MuiDrawer-paper",
  );
  if (!panel) {
    return { left: 0, right: 0 };
  }

  const panelRect = panel.getBoundingClientRect();
  const overlapLeft = Math.max(hostRect.left, panelRect.left);
  const overlapRight = Math.min(hostRect.right, panelRect.right);
  const overlapWidth = Math.max(0, overlapRight - overlapLeft);
  if (overlapWidth <= 0) {
    return { left: 0, right: 0 };
  }

  const panelMid = (panelRect.left + panelRect.right) / 2;
  const hostMid = (hostRect.left + hostRect.right) / 2;
  return panelMid < hostMid
    ? { left: overlapWidth, right: 0 }
    : { left: 0, right: overlapWidth };
}

function useEmptyStateOcclusion(host: HTMLDivElement | null): {
  left: number;
  right: number;
} {
  const [occlusion, setOcclusion] = useState<{ left: number; right: number }>({
    left: 0,
    right: 0,
  });

  useEffect(() => {
    if (!host) {
      setOcclusion({ left: 0, right: 0 });
      return;
    }

    let observer: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let rafId: number | null = null;

    const update = () => {
      setOcclusion((previous) => {
        const next = computeContextPanelOcclusion(host);
        if (next.left === previous.left && next.right === previous.right) {
          return previous;
        }
        return next;
      });
    };

    const scheduleUpdate = () => {
      if (rafId !== null) {
        return;
      }
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        update();
      });
    };

    const attachPanelResizeObserver = () => {
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(() => {
        scheduleUpdate();
      });
      resizeObserver.observe(host);
      const panel = document.querySelector<HTMLElement>(
        "[data-testid='context-panel'] .MuiDrawer-paper",
      );
      if (panel) {
        resizeObserver.observe(panel);
      }
    };

    observer = new MutationObserver(() => {
      attachPanelResizeObserver();
      scheduleUpdate();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    window.addEventListener("resize", scheduleUpdate);
    attachPanelResizeObserver();
    update();

    return () => {
      window.removeEventListener("resize", scheduleUpdate);
      observer?.disconnect();
      resizeObserver?.disconnect();
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [host]);

  return occlusion;
}

function StandaloneLabEmptyStateMount() {
  const host = useLabEmptyStatePortalHost();
  const tabs = useLabTabsStore((state) => state.tabs);
  const occlusion = useEmptyStateOcclusion(host);
  const [showEmptyState, setShowEmptyState] = useState(false);

  useEffect(() => {
    if (!host || tabs.length > 0) {
      setShowEmptyState(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowEmptyState(true);
    }, 750);

    return () => {
      window.clearTimeout(timer);
    };
  }, [host, tabs.length]);

  if (!host || tabs.length > 0 || !showEmptyState) {
    return null;
  }

  return createPortal(
    <Suspense fallback={null}>
      <LazyAttractorEmptyState
        occlusionLeft={occlusion.left}
        occlusionRight={occlusion.right}
      />
    </Suspense>,
    host,
  );
}

/**
 * Root component that handles auth and renders the app.
 */
function StandaloneApp() {
  const {
    endpointList,
    hasConnectedEndpoint,
    hasEndpointSession,
    loading,
  } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">(() => currentTheme);
  const [terminalPreferences, setTerminalPreferences] =
    useState<TerminalPreferences>(() => loadTerminalPreferences());
  const imageManagerOpen = useRuntimeUiStore((state) => state.imageManagerOpen);
  const closeImageManager = useRuntimeUiStore(
    (state) => state.closeImageManager,
  );
  const activeLabTabKind = useLabTabsStore((state) => {
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    return activeTab?.kind ?? null;
  });
  const runtimeDialogsReady = true;

  const handleWorkspaceFileEvent = useCallback(
    (endpointId: string, event: WorkspaceFileEvent) => {
      if (workspaceEventTouchesTopology(event.path)) {
        topologyManager.invalidateTopologyFileListCache(endpointId);
      }
      explorerBridge.invalidateFileExplorerCache(endpointId);
    },
    [],
  );

  useEventStream(endpointList);
  useWorkspaceFileEvents(endpointList, handleWorkspaceFileEvent);

  const labsRef = useRef(useLabStore.getState().labs);
  useEffect(() => {
    const unsub = useLabStore.subscribe((state) => {
      if (state.labs !== labsRef.current) {
        const previousLabs = labsRef.current;
        labsRef.current = state.labs;
        if (!labsEqualForExplorer(previousLabs, state.labs)) {
          scheduleExplorerSnapshot(EXPLORER_REFRESH_DEBOUNCE_MS);
        }
        topologyManager.handleLabStateChange(previousLabs, state.labs);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!hasEndpointSession) {
      clearStandaloneUiState();
      void clearLabTabsAndActiveTopology();
      return () => {
        cancelled = true;
      };
    }

    if (!hasConnectedEndpoint) {
      clearStandaloneUiState();
      void clearLabTabsAndActiveTopology();
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        await refreshCustomNodesForAuthenticatedUser();
        if (!cancelled) {
          applyCustomNodeError(null);
        }
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        applyCustomNodes([], "");
        applyCustomNodeError(
          error instanceof Error ? error.message : String(error),
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasConnectedEndpoint, hasEndpointSession]);

  useEffect(() => {
    const endpointIds = new Set(endpointList.map((endpoint) => endpoint.id));
    const staleEndpointIds = new Set<string>();
    for (const tab of useLabTabsStore.getState().tabs) {
      if (!endpointIds.has(tab.endpointId)) {
        staleEndpointIds.add(tab.endpointId);
      }
    }
    if (staleEndpointIds.size === 0) {
      return;
    }

    void (async () => {
      for (const endpointId of staleEndpointIds) {
        await closeEndpointTabsAndActivateNext(endpointId);
      }
    })();
  }, [endpointList]);

  useEffect(() => {
    topologyManager.setAuthenticated(hasConnectedEndpoint);
    return () => {
      topologyManager.closeEventStream();
    };
  }, [hasConnectedEndpoint]);

  useEffect(() => {
    scheduleExplorerSnapshot(0);
  }, [endpointList]);

  const handleThemeChange = useCallback((nextTheme: "light" | "dark") => {
    document.documentElement.classList.toggle("light", nextTheme === "light");
    currentTheme = nextTheme;
    setTheme(nextTheme);
    applyThemeVars(nextTheme);
    persistTheme(nextTheme);
  }, []);

  const handleSaveTerminalPreferences = useCallback(
    (
      next: TerminalPreferences,
      options?: {
        notify?: boolean;
      },
    ) => {
      setTerminalPreferences(persistTerminalPreferences(next));
      if (options?.notify !== false) {
        runtimeUiActions.notify("Terminal settings updated.", "success");
      }
    },
    [],
  );

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color:
            "var(--clab-ui-editor-foreground, var(--vscode-editor-foreground, #d4d4d4))",
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <>
      {activeLabTabKind === "file" ? (
        <style>{FILE_TAB_TOPOLOGY_CHROME_CSS}</style>
      ) : null}
      <App
        initialData={initialData}
        runtime={standaloneRuntime!}
        lifecycleActionsAvailable={false}
      />
      <StandaloneLabTabsMount />
      <StandaloneFileEditorTabMount />
      <StandaloneLabEmptyStateMount />
      {runtimeDialogsReady ? (
        <>
          <MuiThemeProvider>
            {imageManagerOpen ? (
              <Suspense fallback={null}>
                <LazyContainerlabImageManagerDialog
                  open={imageManagerOpen}
                  runtime={standaloneRuntime!}
                  onClose={closeImageManager}
                  endpointOptions={endpointList.map((endpoint) => ({
                    id: endpoint.id,
                    label: endpoint.label,
                  }))}
                  initialEndpointId={
                    endpointList.find(
                      (endpoint) => endpoint.status === "connected",
                    )?.id
                  }
                />
              </Suspense>
            ) : null}
          </MuiThemeProvider>
          <SettingsOverlayMounted
            currentTheme={theme}
            onThemeChange={handleThemeChange}
            onSaveTerminalPreferences={handleSaveTerminalPreferences}
            terminalPreferences={terminalPreferences}
          />
        </>
      ) : null}
    </>
  );
}

/**
 * Settings overlay mounted in its own root div.
 */
function SettingsOverlayMounted(props: {
  currentTheme: "light" | "dark";
  onSaveTerminalPreferences: (
    next: TerminalPreferences,
    options?: {
      notify?: boolean;
    },
  ) => void;
  onThemeChange: (nextTheme: "light" | "dark") => void;
  terminalPreferences: TerminalPreferences;
}) {
  const overlayContainer = document.getElementById("settings-overlay");
  if (!overlayContainer) return null;

  return createPortal(
    <MuiThemeProvider>
      <Suspense fallback={null}>
        <LazySettingsOverlay
          currentTheme={props.currentTheme}
          onThemeChange={props.onThemeChange}
          onSaveTerminalPreferences={props.onSaveTerminalPreferences}
          terminalPreferences={props.terminalPreferences}
        />
      </Suspense>
    </MuiThemeProvider>,
    overlayContainer,
  );
}

// Bootstrap

export function mountStandaloneApp(): void {
  if (currentTheme === "light") {
    document.documentElement.classList.add("light");
  } else {
    document.documentElement.classList.remove("light");
  }
  applyThemeVars(currentTheme);
  if (!standaloneRuntime) {
    setupStandaloneUiHost();
  }
  renderApp();
}
