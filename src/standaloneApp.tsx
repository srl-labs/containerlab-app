/**
 * Standalone app entry point.
 *
 * Modeled on dev/main.tsx but connects to the real clab-api-server
 * through the Fastify backend instead of using mock data.
 */
import "@srl-labs/clab-ui/styles/global.css";
import * as EditorWorkerModule from "@srl-labs/clab-ui/monaco/editor-worker?worker";
import * as JsonWorkerModule from "@srl-labs/clab-ui/monaco/json-worker?worker";
import * as YamlWorkerModule from "@srl-labs/clab-ui/monaco/yaml-worker?worker";
import { lazy, Suspense } from "react";
import {
  App,
  EXPORT_COMMANDS,
  MSG_CANCEL_LAB_LIFECYCLE,
  MSG_FIT_VIEWPORT,
  MSG_SVG_EXPORT_RESULT,
  MuiThemeProvider,
  applyThemeVars,
  createApiClabUiHost,
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
  type TopologySnapshot
} from "./mainUiDependencies";

import {
  LabTabsBar,
  createStandaloneLifecycleManager,
  createStandaloneTopologyManager,
  extractEndpointIdFromTopologyId,
  isStandaloneLifecycleCommand,
  labsEqualForExplorer,
  normalizePathValue,
  resolveStandaloneStartupScreen,
  useAuth,
  useEndpointStore,
  useEventStream,
  useLabStore,
  type DeploymentState,
  type EndpointImportResult,
  type EndpointSessionDuration
} from "./mainRuntimeDependencies";
import {
  buildPacketflixCapture,
  createStandaloneExplorerBridge,
  createWiresharkVncSessions,
  deleteUiCustomNode,
  deleteUiIcon,
  fetchRuntimeImages,
  fetchUiCustomNodes,
  fetchUiIcons,
  pullRuntimeImage,
  getSessionHostnameOverride,
  loadCapturePreferences,
  loadTerminalPreferences,
  persistTerminalPreferences,
  readPersistedStandaloneTheme,
  reconcileUiIcons,
  removeRuntimeImage,
  resolveLabTab,
  resolveStandaloneTheme,
  runtimeUiActions,
  useRuntimeUiStore,
  saveUiCustomNode,
  setDefaultUiCustomNode,
  uploadUiIcon,
  useLabTabsStore,
  type TerminalPreferences
} from "./mainApiDependencies";
import type * as ImageManagerExports from "@srl-labs/clab-ui/image-manager";
import type {
  ContainerImageSummary,
  ImageActionResult,
  KindImageReference
} from "@srl-labs/clab-ui/image-manager";

type ImageManagerModule = typeof ImageManagerExports;

let imageManagerModulePromise: Promise<ImageManagerModule> | null = null;

function loadImageManagerModule(): Promise<ImageManagerModule> {
  imageManagerModulePromise ??= import("@srl-labs/clab-ui/image-manager");
  return imageManagerModulePromise;
}

const LazyAttractorEmptyState = lazy(async () => {
  const module = await import("./components/AttractorEmptyState");
  return { default: module.AttractorEmptyState };
});

const LazyLoginPage = lazy(async () => {
  const module = await import("./components/LoginPage");
  return { default: module.LoginPage };
});

const LazyRuntimeTerminalWindows = lazy(async () => {
  const module = await import("./components/RuntimeTerminalWindows");
  return { default: module.RuntimeTerminalWindows };
});

const LazyRuntimeActionDialogs = lazy(async () => {
  const module = await import("./components/RuntimeActionDialogs");
  return { default: module.RuntimeActionDialogs };
});

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
const EditorWorker = (EditorWorkerModule as { default: new () => Worker }).default;
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
    }
  };
}

// Initial data for the App
const initialData = {
  dockerImages: [] as string[],
  customNodes: [],
  defaultNode: "",
  customIcons: []
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
        nodeName: container.nodeName
      });
    }
  }
  return references;
}

async function activeTopologyImageReferences(endpointId?: string): Promise<KindImageReference[]> {
  if (!standaloneRuntime) {
    return [];
  }
  const context = standaloneRuntime.session.getContext();
  const contextEndpointId = extractEndpointIdFromTopologyId(context.topologyRef?.topologyId);
  if (endpointId && contextEndpointId && endpointId !== contextEndpointId) {
    return [];
  }
  try {
    const snapshot = await standaloneRuntime.session.requestSnapshot();
    if (!snapshot.yamlContent.trim()) {
      return [];
    }
    const { collectKindImageReferencesFromYaml } = await loadImageManagerModule();
    return collectKindImageReferencesFromYaml(snapshot.yamlContent, {
      endpointId: contextEndpointId ?? endpointId,
      label: snapshot.labName || snapshot.yamlFileName,
      path: context.topologyRef?.yamlPath
    });
  } catch {
    return [];
  }
}

async function standaloneImageReferences(endpointId?: string): Promise<KindImageReference[]> {
  const [activeRefs, customNodes, imageManagerModule] = await Promise.all([
    activeTopologyImageReferences(endpointId),
    fetchUiCustomNodes(endpointId).catch(() => ({ customNodes: [] })),
    loadImageManagerModule()
  ]);
  return [
    ...activeRefs,
    ...runningLabImageReferences(endpointId),
    ...imageManagerModule.collectKindImageReferencesFromCustomTemplates(customNodes.customNodes, {
      endpointId,
      label: "Custom"
    })
  ];
}

function applyCustomNodes(
  customNodes: ReturnType<typeof useTopoViewerStore.getState>["customNodes"],
  defaultNode: string
): void {
  useTopoViewerStore.getState().setCustomNodes(customNodes, defaultNode);
}

function applyCustomIcons(customIcons: ReturnType<typeof useTopoViewerStore.getState>["customIcons"]): void {
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

function pickIconFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,.png,image/svg+xml,image/png";
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
  } catch { /* ignore */ }
}

currentTheme = loadPersistedTheme();

const EXPLORER_REFRESH_DEBOUNCE_MS = 90;
const TOPOLOGY_REFRESH_DEBOUNCE_MS = 120;
const RUNTIME_CHROME_DEFER_MS = 1000;
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
      (endpoint) => endpoint.id === currentEndpointId && endpoint.status === "connected"
    )
  ) {
    return currentEndpointId;
  }

  return configuredEndpoints.find((endpoint) => endpoint.status === "connected")?.id;
}

function getEndpointIdForEditorContext(): string | undefined {
  return topologyManager.getCurrentEndpointId() ?? getConnectedEndpointIdForUiAssets();
}

function hasActiveConnectedTopologySession(): boolean {
  return Boolean(
    getConnectedEndpointIdForUiAssets() &&
    topologyManager.getCurrentSessionId() &&
    topologyManager.getCurrentTopologyRef()
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
    canRedo: false
  };
}

function removeLabFromRuntimeStore(topologyRef: Pick<TopologyRef, "topologyId" | "yamlPath">): void {
  useLabStore.setState((state) => {
    let changed = false;
    const nextLabs = new Map(state.labs);
    const endpointId = extractEndpointIdFromTopologyId(topologyRef.topologyId);
    const normalizedPath = normalizePathValue(topologyRef.yamlPath ?? "");
    for (const [key, lab] of nextLabs.entries()) {
      if (endpointId && lab.endpointId !== endpointId) {
        continue;
      }
      const matchesPath =
        normalizedPath.length > 0 &&
        (normalizePathValue(lab.topologyPath) === normalizedPath ||
          [...lab.containers.values()].some(
            (container) => normalizePathValue(container.labPath) === normalizedPath
          ));
      if (matchesPath) {
        nextLabs.delete(key);
        changed = true;
      }
    }
    return changed ? { labs: nextLabs } : state;
  });
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
  }
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
      data: { type: MSG_FIT_VIEWPORT }
    })
  );
}

async function activateLabTabById(
  tabId: string,
  options: { deploymentState?: DeploymentState } = {}
): Promise<void> {
  const tab = useLabTabsStore.getState().tabs.find((entry) => entry.id === tabId);
  if (!tab) {
    return;
  }
  useLabTabsStore.getState().setActiveTab(tab.id);
  try {
    await queueTopologyTabActivation(async () => {
      await topologyManager.loadTopologyFile(tab.topologyRef, {
        deploymentState: options.deploymentState,
        endpointId: tab.endpointId
      });
    });
  } catch (error: unknown) {
    runtimeUiActions.notify(toErrorMessage(error), "error");
    throw error;
  }
}

async function openTopologyInTab(
  topologyRef: TopologyRef,
  options: { deploymentState?: DeploymentState; endpointId?: string } = {}
): Promise<void> {
  const resolvedTab = resolveLabTab(
    {
      endpointId: options.endpointId,
      topologyRef
    },
    resolveLabTabFallbackEndpointId()
  );
  const openResult = useLabTabsStore.getState().openOrFocusTab(resolvedTab);
  await activateLabTabById(openResult.tab.id, {
    deploymentState: options.deploymentState
  });
  if (!openResult.alreadyOpen) {
    requestViewportFitFromHost();
  }
}

async function closeLabTabAndActivateNext(tabId: string): Promise<void> {
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

async function closeEndpointTabsAndActivateNext(endpointId: string): Promise<void> {
  const closeResult = useLabTabsStore.getState().closeTabsByEndpoint(endpointId);
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
  const response = await fetchUiCustomNodes(getConnectedEndpointIdForUiAssets());
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
    topologyRef
  });
  applyCustomIcons(response.icons);
}

const lifecycleManager = createStandaloneLifecycleManager({
  getCurrentSessionId: topologyManager.getCurrentSessionId,
  getCurrentTopologyRef: topologyManager.getCurrentTopologyRef,
  invalidateTopologyFileListCache: topologyManager.invalidateTopologyFileListCache,
  removeLabFromRuntimeStore,
  scheduleExplorerSnapshot: (delay) => scheduleExplorerSnapshot(delay),
  scheduleTopologySnapshotRefresh: (delay) => topologyManager.scheduleSnapshotRefresh(delay),
  syncHostContext: topologyManager.syncHostContext
});

const explorerBridge = createStandaloneExplorerBridge({
  debounceMs: EXPLORER_REFRESH_DEBOUNCE_MS,
  getEndpoints: getConfiguredEndpoints,
  getLabs: () => useLabStore.getState().labs,
  invalidateTopologyFileListCache: topologyManager.invalidateTopologyFileListCache,
  listTopologyFiles: topologyManager.listTopologyFiles,
  loadTopologyFile: openTopologyInTab,
  removeEndpoint: async (endpointId) => {
    await closeEndpointTabsAndActivateNext(endpointId);
    await topologyManager.disposeEndpointSession(endpointId);
  },
  resolveApiTopologyPath: topologyManager.resolveApiTopologyPath,
  resolveDeploymentState: topologyManager.resolveDeploymentState,
  resolveTopologyRef: topologyManager.resolveTopologyRef,
  runLifecycle: lifecycleManager.runTarget
});

scheduleExplorerSnapshot = explorerBridge.scheduleSnapshot;

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

function getActiveTopologyTarget() {
  const topologyRef = topologyManager.getCurrentTopologyRef();
  if (!topologyRef) {
    runtimeUiActions.notify("No active topology session is available.", "error");
    return null;
  }
  const endpointId = topologyManager.getCurrentEndpointId() ?? undefined;
  const sessionId = topologyManager.getCurrentSessionId() ?? undefined;
  return { endpointId, sessionId, topologyRef };
}

function openPacketflixCaptures(links: Array<{ packetflixUri?: string }>): void {
  if (links.length === 0) {
    runtimeUiActions.notify("No packet capture targets were returned.", "warning");
    return;
  }
  for (const capture of links) {
    const link = capture.packetflixUri?.trim();
    if (link) {
      window.open(link, "_blank", "noopener,noreferrer");
    }
  }
}

function openWiresharkVncSessions(
  sessions: Array<{ sessionId: string; showVolumeTip?: boolean }>,
  targetEndpointId: string | undefined,
  theme: "light" | "dark"
): void {
  if (sessions.length === 0) {
    runtimeUiActions.notify("No Wireshark sessions were created.", "warning");
    return;
  }
  for (const session of sessions) {
    const params = new URLSearchParams({ sessionId: session.sessionId, theme });
    if (targetEndpointId) {
      params.set("endpointId", targetEndpointId);
    }
    if (session.showVolumeTip) {
      params.set("showVolumeTip", "1");
    }
    window.open(`/wireshark.html?${params.toString()}`, "_blank", "noopener,noreferrer");
  }
}

function openCaptureForInterface(nodeName: string, interfaceName: string): void {
  const target = getActiveTopologyTarget();
  if (!target) {
    return;
  }
  if (!nodeName || !interfaceName) {
    runtimeUiActions.notify("Missing capture target.", "error");
    return;
  }

  void (async () => {
    try {
      const capturePreferences = loadCapturePreferences(target.endpointId);
      if (capturePreferences.preferredAction === "edgeshark") {
        const response = await buildPacketflixCapture({
          ...target,
          targets: [{ containerName: nodeName, interfaceName }],
          remoteHostname: getSessionHostnameOverride(target.endpointId)
        });
        openPacketflixCaptures(response.captures ?? []);
        return;
      }

      const theme = resolveStandaloneTheme(currentTheme);
      const response = await createWiresharkVncSessions({
        ...target,
        targets: [{ containerName: nodeName, interfaceName }],
        theme
      });
      openWiresharkVncSessions(response.sessions ?? [], target.endpointId, theme);
    } catch (error: unknown) {
      runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
    }
  })();
}

function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function handleGrafanaBundleExport(msg: VscodeMessage): void {
  const baseName = typeof msg.baseName === "string" ? msg.baseName.trim() || "topology" : "topology";
  const svgContent = typeof msg.svgContent === "string" ? msg.svgContent : "";
  const dashboardJson = typeof msg.dashboardJson === "string" ? msg.dashboardJson : "";
  const panelYaml = typeof msg.panelYaml === "string" ? msg.panelYaml : "";
  if (svgContent) {
    triggerDownload(`${baseName}.svg`, svgContent, "image/svg+xml");
  }
  if (dashboardJson) {
    triggerDownload(`${baseName}.grafana.json`, dashboardJson, "application/json");
  }
  if (panelYaml) {
    triggerDownload(`${baseName}.flow_panel.yaml`, panelYaml, "application/yaml");
  }
  const files = [
    svgContent ? `${baseName}.svg` : null,
    dashboardJson ? `${baseName}.grafana.json` : null,
    panelYaml ? `${baseName}.flow_panel.yaml` : null
  ].filter((value): value is string => value !== null);
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: MSG_SVG_EXPORT_RESULT,
        requestId: msg.requestId ?? "",
        success: true,
        files
      }
    })
  );
}

function handleNodeTerminalCommand(msg: VscodeMessage): void {
  const target = getActiveTopologyTarget();
  if (!target || typeof msg.nodeName !== "string" || msg.nodeName.trim().length === 0) {
    return;
  }
  runtimeUiActions.openTerminal({
    ...target,
    protocol: msg.command === "clab-node-attach-shell" ? "shell" : "ssh",
    nodeName: msg.nodeName,
    title: `${msg.command === "clab-node-attach-shell" ? "Shell" : "SSH"}: ${msg.nodeName}`
  });
}

function handleNodeLogsCommand(msg: VscodeMessage): void {
  const target = getActiveTopologyTarget();
  if (!target || typeof msg.nodeName !== "string" || msg.nodeName.trim().length === 0) {
    return;
  }
  runtimeUiActions.openLogs({
    ...target,
    nodeName: msg.nodeName,
    title: `Logs: ${msg.nodeName}`
  });
}

function handleLinkImpairmentCommand(msg: VscodeMessage): void {
  const target = getActiveTopologyTarget();
  if (!target || typeof msg.nodeName !== "string" || msg.nodeName.trim().length === 0) {
    return;
  }
  runtimeUiActions.openNetem({
    ...target,
    nodeName: msg.nodeName,
    preferredInterfaceName: typeof msg.interfaceName === "string" ? msg.interfaceName : undefined,
    title: `Impairments: ${msg.nodeName}`
  });
}

function handleSaveCustomNodeCommand(msg: VscodeMessage): void {
  const { command: _command, ...payload } = msg;
  void saveUiCustomNode(payload as Record<string, unknown>, getEndpointIdForEditorContext()).then((response) => {
    applyCustomNodeError(null);
    applyCustomNodes(response.customNodes, response.defaultNode);
  }).catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
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
  void deleteUiCustomNode(nodeName, getEndpointIdForEditorContext()).then((response) => {
    applyCustomNodeError(null);
    applyCustomNodes(response.customNodes, response.defaultNode);
  }).catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
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
  void setDefaultUiCustomNode(nodeName, getEndpointIdForEditorContext()).then((response) => {
    applyCustomNodeError(null);
    applyCustomNodes(response.customNodes, response.defaultNode);
  }).catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    applyCustomNodeError(errorMessage);
    runtimeUiActions.notify(errorMessage, "error");
  });
}

function handleIconUploadCommand(): void {
  void (async () => {
    try {
      const file = await pickIconFile();
      if (!file) {
        return;
      }
      await uploadUiIcon(file, getEndpointIdForEditorContext());
      await refreshCustomIconsForCurrentTopology();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      runtimeUiActions.notify(errorMessage, "error");
    });
}

function handleIconReconcileCommand(msg: VscodeMessage): void {
  const topologyRef = topologyManager.getCurrentTopologyRef();
  if (!topologyRef) {
    return;
  }
  const usedIcons = Array.isArray(msg.usedIcons)
    ? msg.usedIcons.filter((value): value is string => typeof value === "string")
    : [];
  void reconcileUiIcons({
    endpointId: topologyManager.getCurrentEndpointId() ?? undefined,
    sessionId: topologyManager.getCurrentSessionId() ?? undefined,
    topologyRef,
    usedIcons
  }).catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[Standalone] icon reconcile failed:", errorMessage);
  });
}

type StandaloneMessageHandler = (msg: VscodeMessage) => void;

const STANDALONE_MESSAGE_HANDLERS: Record<string, StandaloneMessageHandler> = {
  [EXPORT_COMMANDS.EXPORT_SVG_GRAFANA_BUNDLE]: handleGrafanaBundleExport,
  "clab-node-connect-ssh": handleNodeTerminalCommand,
  "clab-node-attach-shell": handleNodeTerminalCommand,
  "clab-node-view-logs": handleNodeLogsCommand,
  "clab-interface-capture": (msg) => {
    const nodeName = typeof msg.nodeName === "string" ? msg.nodeName.trim() : "";
    const interfaceName = typeof msg.interfaceName === "string" ? msg.interfaceName.trim() : "";
    openCaptureForInterface(nodeName, interfaceName);
  },
  "clab-link-impairment": handleLinkImpairmentCommand,
  "topo-toggle-split-view": () => runtimeUiActions.notify(
    "Split view is not available in standalone mode yet.",
    "info"
  ),
  "save-custom-node": handleSaveCustomNodeCommand,
  "delete-custom-node": handleDeleteCustomNodeCommand,
  "set-default-custom-node": handleSetDefaultCustomNodeCommand,
  "icon-list": () => {
    void refreshCustomIconsForCurrentTopology().catch(() => {
      applyCustomIcons([]);
    });
  },
  "icon-upload": handleIconUploadCommand,
  "icon-delete": handleIconDeleteCommand,
  "icon-reconcile": handleIconReconcileCommand
};

const IGNORED_STANDALONE_MESSAGE_COMMANDS = new Set([
  "reactTopoViewerLog",
  "topoViewerLog"
]);

// Standalone host bridge - explicit UI host with API-backed topology transport.
function setupStandaloneUiHost(): void {
  const warnedCommands = new Set<string>();

  const postMessage = (message: unknown) => {
    const msg = message as VscodeMessage | undefined;

    if (!msg?.command) return;

    if (IGNORED_STANDALONE_MESSAGE_COMMANDS.has(msg.command)) {
      return;
    }

    if (msg.command === MSG_CANCEL_LAB_LIFECYCLE) {
      lifecycleManager.cancel();
      return;
    }

    if (isStandaloneLifecycleCommand(msg.command)) {
      const lifecycleCommand = msg.command;
      void lifecycleManager.run(lifecycleCommand).catch((error: unknown) => {
        console.error(`[Standalone] lifecycle command failed:`, error);
      });
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

  const apiHost = createApiClabUiHost({
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
          image: request.image
        });
      },
      async removeImage(request): Promise<ImageActionResult> {
        return removeRuntimeImage({
          endpointId: request.endpointId,
          reference: request.reference,
          force: request.force
        });
      }
    },
    postMessage,
    targetWindow: window,
    meta: {
      isDevMock: true,
      disableDevMockTraffic: true
    }
  });
  const requestSnapshot: typeof apiHost.topology.requestSnapshot = async (
    context,
    requestOptions
  ) => {
    if (!hasActiveConnectedTopologySession()) {
      return createEmptyTopologySnapshot();
    }
    return apiHost.topology.requestSnapshot(context, requestOptions);
  };

  standaloneRuntime = createClabUiRuntime({
    host: {
      ...apiHost,
      topology: {
        ...apiHost.topology,
        requestSnapshot
      }
    }
  });
}

// Render

type StandaloneWindowState = Window & {
  __clabStandaloneReactRoot?: ReactRoot;
};

const standaloneWindowState = window as StandaloneWindowState;
let reactRoot: ReactRoot | null = standaloneWindowState.__clabStandaloneReactRoot ?? null;

function renderApp(): void {
  (window as unknown as Record<string, unknown>).__INITIAL_DATA__ = initialData;
  (window as unknown as Record<string, unknown>).__DOCKER_IMAGES__ = initialData.dockerImages;

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

  const existingHost = appRoot.querySelector("[data-standalone-lab-tabs-host='true']");
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

  const existingHost = mainElement.querySelector("[data-standalone-lab-empty-host='true']");
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
    host
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

function computeContextPanelOcclusion(
  host: HTMLDivElement | null
): { left: number; right: number } {
  if (!host) {
    return { left: 0, right: 0 };
  }
  const hostRect = host.getBoundingClientRect();
  if (hostRect.width <= 0 || hostRect.height <= 0) {
    return { left: 0, right: 0 };
  }

  const panel = document.querySelector<HTMLElement>(
    "[data-testid='context-panel'] .MuiDrawer-paper"
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

function useEmptyStateOcclusion(host: HTMLDivElement | null): { left: number; right: number } {
  const [occlusion, setOcclusion] = useState<{ left: number; right: number }>({
    left: 0,
    right: 0
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
        "[data-testid='context-panel'] .MuiDrawer-paper"
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
      attributeFilter: ["class", "style"]
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

function useDeferredRuntimeChrome(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let frameId: number | null = null;
    let timerId: number | null = null;
    const scheduleReady = () => {
      if (frameId !== null || timerId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        timerId = window.setTimeout(() => {
          timerId = null;
          setReady(true);
        }, RUNTIME_CHROME_DEFER_MS);
      });
    };
    const scheduleAfterTopoViewerMount = () => {
      if (document.querySelector("[data-testid='topoviewer-app']")) {
        observer?.disconnect();
        observer = null;
        scheduleReady();
      }
    };

    scheduleAfterTopoViewerMount();
    if (frameId === null && timerId === null) {
      observer = new MutationObserver(scheduleAfterTopoViewerMount);
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  return ready;
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
      <LazyAttractorEmptyState occlusionLeft={occlusion.left} occlusionRight={occlusion.right} />
    </Suspense>,
    host
  );
}

/**
 * Root component that handles auth and renders the app.
 */
function StandaloneApp() {
  const {
    addEndpoint,
    defaultApiUrl,
    endpointList,
    error,
    exportEndpoints,
    hasConnectedEndpoint,
    hasEndpointSession,
    importEndpoints,
    loading,
    logout,
    reconnectEndpoint,
    refreshConfig,
    removeEndpoint,
    updateEndpoint,
    setEndpointSessionDuration
  } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">(() => currentTheme);
  const [terminalPreferences, setTerminalPreferences] = useState<TerminalPreferences>(() =>
    loadTerminalPreferences()
  );
  const imageManagerOpen = useRuntimeUiStore((state) => state.imageManagerOpen);
  const closeImageManager = useRuntimeUiStore((state) => state.closeImageManager);
  const terminalCount = useRuntimeUiStore((state) => state.terminals.length);
  const runtimeChromeReady = useDeferredRuntimeChrome();

  const startupScreen = useMemo(
    () => resolveStandaloneStartupScreen(endpointList),
    [endpointList]
  );

  useEventStream(endpointList);

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
        applyCustomNodeError(error instanceof Error ? error.message : String(error));
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

  const handleAddEndpoint = useCallback(
    async (input: {
      label?: string;
      password: string;
      sessionDuration: EndpointSessionDuration;
      url: string;
      username: string;
    }) => {
      await addEndpoint(input);
      await refreshConfig().catch(() => {});
      scheduleExplorerSnapshot(0);
    },
    [addEndpoint, refreshConfig]
  );

  const handleExportEndpoints = useCallback(() => {
    return exportEndpoints();
  }, [exportEndpoints]);

  const handleImportEndpoints = useCallback(
    (content: string): EndpointImportResult => {
      const result = importEndpoints(content);
      scheduleExplorerSnapshot(0);
      return result;
    },
    [importEndpoints]
  );

  const handleReconnectEndpoint = useCallback(
    async (input: { endpointId: string; password: string; username: string }) => {
      await reconnectEndpoint(input);
      scheduleExplorerSnapshot(0);
    },
    [reconnectEndpoint]
  );

  const handleRemoveEndpoint = useCallback(
    async (endpointId: string) => {
      await closeEndpointTabsAndActivateNext(endpointId);
      await removeEndpoint(endpointId);
      scheduleExplorerSnapshot(0);
    },
    [removeEndpoint]
  );

  const handleThemeChange = useCallback((nextTheme: "light" | "dark") => {
    document.documentElement.classList.toggle("light", nextTheme === "light");
    currentTheme = nextTheme;
    setTheme(nextTheme);
    applyThemeVars(nextTheme);
    persistTheme(nextTheme);
  }, []);

  const handleLogout = useCallback(() => {
    topologyManager.closeEventStream();
    clearStandaloneUiState();
    void clearLabTabsAndActiveTopology();
    void logout();
  }, [logout]);

  const handleSaveTerminalPreferences = useCallback((
    next: TerminalPreferences,
    options?: {
      notify?: boolean;
    }
  ) => {
    setTerminalPreferences(persistTerminalPreferences(next));
    if (options?.notify !== false) {
      runtimeUiActions.notify("Terminal settings updated.", "success");
    }
  }, []);

  const handleSetEndpointSessionDuration = useCallback(
    (endpointId: string, sessionDuration: EndpointSessionDuration) => {
      setEndpointSessionDuration(endpointId, sessionDuration);
    },
    [setEndpointSessionDuration]
  );

  const handleUpdateEndpoint = useCallback(
    async (input: {
      endpointId: string;
      label: string;
      sessionDuration: EndpointSessionDuration;
      url: string;
      username: string;
    }) => {
      await updateEndpoint(input);
      scheduleExplorerSnapshot(0);
    },
    [updateEndpoint]
  );

  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", color: "var(--clab-ui-editor-foreground, var(--vscode-editor-foreground, #d4d4d4))"
      }}>
        Loading...
      </div>
    );
  }

  if (startupScreen === "login") {
    return (
      <MuiThemeProvider>
        <Suspense fallback={null}>
          <LazyLoginPage
            defaultApiUrl={defaultApiUrl}
            endpoints={endpointList}
            error={error}
            onAddEndpoint={handleAddEndpoint}
            onExportEndpoints={handleExportEndpoints}
            onImportEndpoints={handleImportEndpoints}
            onReconnectEndpoint={handleReconnectEndpoint}
            onRemoveEndpoint={handleRemoveEndpoint}
            onUpdateEndpoint={handleUpdateEndpoint}
          />
        </Suspense>
      </MuiThemeProvider>
    );
  }

  return (
    <>
      <App initialData={initialData} runtime={standaloneRuntime!} />
      <StandaloneLabTabsMount />
      <StandaloneLabEmptyStateMount />
      {runtimeChromeReady ? (
        <>
          <MuiThemeProvider>
            {terminalCount > 0 ? (
              <Suspense fallback={null}>
                <LazyRuntimeTerminalWindows
                  onSaveTerminalPreferences={handleSaveTerminalPreferences}
                  terminalPreferences={terminalPreferences}
                />
              </Suspense>
            ) : null}
            <Suspense fallback={null}>
              <LazyRuntimeActionDialogs />
            </Suspense>
            {imageManagerOpen ? (
              <Suspense fallback={null}>
                <LazyContainerlabImageManagerDialog
                  open={imageManagerOpen}
                  runtime={standaloneRuntime!}
                  onClose={closeImageManager}
                  endpointOptions={endpointList.map((endpoint) => ({
                    id: endpoint.id,
                    label: endpoint.label
                  }))}
                  initialEndpointId={endpointList.find((endpoint) => endpoint.status === "connected")?.id}
                />
              </Suspense>
            ) : null}
          </MuiThemeProvider>
          <SettingsOverlayMounted
            currentTheme={theme}
            defaultApiUrl={defaultApiUrl}
            endpoints={endpointList}
            onAddEndpoint={handleAddEndpoint}
            onExportEndpoints={handleExportEndpoints}
            onImportEndpoints={handleImportEndpoints}
            onThemeChange={handleThemeChange}
            onLogout={handleLogout}
            onReconnectEndpoint={handleReconnectEndpoint}
            onRemoveEndpoint={handleRemoveEndpoint}
            onUpdateEndpoint={handleUpdateEndpoint}
            onSetEndpointSessionDuration={handleSetEndpointSessionDuration}
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
  defaultApiUrl: string;
  endpoints: ReturnType<typeof useAuth>["endpointList"];
  onAddEndpoint: (input: {
    label?: string;
    password: string;
    sessionDuration: EndpointSessionDuration;
    url: string;
    username: string;
  }) => Promise<void>;
  onExportEndpoints: () => string;
  onImportEndpoints: (content: string) => EndpointImportResult;
  onLogout: () => void;
  onReconnectEndpoint: (input: {
    endpointId: string;
    password: string;
    username: string;
  }) => Promise<void>;
  onRemoveEndpoint: (endpointId: string) => Promise<void>;
  onUpdateEndpoint: (input: {
    endpointId: string;
    label: string;
    sessionDuration: EndpointSessionDuration;
    url: string;
    username: string;
  }) => Promise<void>;
  onSetEndpointSessionDuration: (
    endpointId: string,
    sessionDuration: EndpointSessionDuration
  ) => void;
  onSaveTerminalPreferences: (
    next: TerminalPreferences,
    options?: {
      notify?: boolean;
    }
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
          defaultApiUrl={props.defaultApiUrl}
          endpoints={props.endpoints}
          onAddEndpoint={props.onAddEndpoint}
          onExportEndpoints={props.onExportEndpoints}
          onImportEndpoints={props.onImportEndpoints}
          onThemeChange={props.onThemeChange}
          onLogout={props.onLogout}
          onReconnectEndpoint={props.onReconnectEndpoint}
          onRemoveEndpoint={props.onRemoveEndpoint}
          onUpdateEndpoint={props.onUpdateEndpoint}
          onSetEndpointSessionDuration={props.onSetEndpointSessionDuration}
          onSaveTerminalPreferences={props.onSaveTerminalPreferences}
          terminalPreferences={props.terminalPreferences}
        />
      </Suspense>
    </MuiThemeProvider>,
    overlayContainer
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
