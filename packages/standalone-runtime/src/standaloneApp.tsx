import { LoadingScreen } from "@containerlab/clab-ui/workspace/bootstrap";
import { persistStandaloneTheme } from "./standaloneTheme";
import { WorkspaceHostProvider, WorkspaceSidebar } from "@containerlab/clab-ui/workspace";
import { workspaceHost } from "./workspaceHost";
import { getStandaloneBackend, runtimeFetch } from "./backend";
import {
  StandaloneLabTabs,
  StandaloneFileEditor,
  StandaloneLabEmptyState,
} from "./components/StandaloneWorkspace";
/**
 * Standalone app entry point.
 *
 * Modeled on dev/main.tsx but connects to the real clab-api-server
 * through the Fastify backend instead of using mock data.
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
  createApiClabUiHost,
  createClabUiRuntime,
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

import {
  createStandaloneLifecycleManager,
  createStandaloneTopologyManager,
  extractEndpointIdFromTopologyId,
  isStandaloneLifecycleCommand,
  labsEqualForExplorer,
  resolveStandaloneStartupScreen,
  useAuth,
  useEndpointStore,
  useEventStream,
  useWorkspaceFileEvents,
  useLabStore,
  type DeploymentState,
  type EndpointImportResult,
  type EndpointSessionDuration,
  type InterfaceNetemPatch,
  type WorkspaceFileEvent,
} from "./mainRuntimeDependencies";
import {
  buildPacketflixCapture,
  controlNodeLifecycle,
  createStandaloneExplorerBridge,
  createWiresharkVncSessions,
  deleteUiCustomNode,
  deleteUiIcon,
  fetchRuntimeImages,
  fetchUiCustomNodes,
  fetchUiIcons,
  importUiIcons,
  inspectLab,
  pullRuntimeImage,
  isFileLabTab,
  getSessionHostnameOverride,
  loadCapturePreferences,
  loadTerminalPreferences,
  persistTerminalPreferences,
  readPersistedStandaloneTheme,
  reconcileUiIcons,
  removeRuntimeImage,
  replaceUiCustomNodes,
  resolveFileTab,
  resolveLabTab,
  resolveStandaloneTheme,
  runtimeUiActions,
  useRuntimeUiStore,
  saveUiCustomNode,
  setNetem,
  setDefaultUiCustomNode,
  uploadUiIcon,
  useLabTabsStore,
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
import { publicAssetUrl } from "./publicAssetUrl";

type ImageManagerModule = typeof ImageManagerExports;

let imageManagerModulePromise: Promise<ImageManagerModule> | null = null;

function loadImageManagerModule(): Promise<ImageManagerModule> {
  imageManagerModulePromise ??= import("@containerlab/clab-ui/image-manager");
  return imageManagerModulePromise;
}

const LazyLoginPage = lazy(async () => {
  const module = await import("./components/LoginPage");
  return { default: module.LoginPage };
});

const LazyRuntimeTerminalWindows = lazy(async () => {
  const module = await import("./components/RuntimeTerminalWindows");
  return { default: module.RuntimeTerminalWindows };
});

import { RuntimeActionDialogs } from "./components/RuntimeActionDialogs";

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

function removeLabFromRuntimeStore(
  topologyRef: Pick<TopologyRef, "labName" | "topologyId" | "yamlPath">,
): void {
  useLabStore.getState().removeLabByTopology({
    endpointId: extractEndpointIdFromTopologyId(topologyRef.topologyId),
    labName: topologyRef.labName,
    topologyPath: topologyRef.yamlPath,
  });
}

async function refreshRuntimeStoreForTopology(target: {
  sessionId?: string;
  topologyRef: TopologyRef;
}): Promise<void> {
  const endpointId = extractEndpointIdFromTopologyId(
    target.topologyRef.topologyId,
  );
  if (!endpointId) {
    return;
  }

  const containers = await inspectLab({
    endpointId,
    sessionId: target.sessionId,
    topologyRef: target.topologyRef,
  });

  useLabStore.getState().replaceLabSnapshot({
    endpointId,
    labName: target.topologyRef.labName,
    topologyPath: target.topologyRef.yamlPath,
    containers,
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

const lifecycleManager = createStandaloneLifecycleManager({
  getCurrentSessionId: topologyManager.getCurrentSessionId,
  getCurrentTopologyRef: topologyManager.getCurrentTopologyRef,
  invalidateTopologyFileListCache:
    topologyManager.invalidateTopologyFileListCache,
  removeLabFromRuntimeStore,
  refreshRuntimeStore: refreshRuntimeStoreForTopology,
  scheduleExplorerSnapshot: (delay) => scheduleExplorerSnapshot(delay),
  scheduleTopologySnapshotRefresh: (delay) =>
    topologyManager.scheduleSnapshotRefresh(delay),
  syncHostContext: topologyManager.syncHostContext,
});

const explorerBridge = createStandaloneExplorerBridge({
  debounceMs: EXPLORER_REFRESH_DEBOUNCE_MS,
  lifecycleActionsAvailable: getStandaloneBackend().capabilities.lifecycle,
  endpointManagementAvailable: getStandaloneBackend().capabilities.endpoints,
  repositoriesAvailable: getStandaloneBackend().capabilities.repositories,
  archivesAvailable: getStandaloneBackend().capabilities.archives,
  defaultExpandExplorerTrees: !getStandaloneBackend().capabilities.lifecycle,
  getEndpoints: getConfiguredEndpoints,
  getLabs: () => useLabStore.getState().labs,
  invalidateTopologyFileListCache:
    topologyManager.invalidateTopologyFileListCache,
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
  runLifecycle: lifecycleManager.runTarget,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalStringField(
  data: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = data[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalNumberField(
  data: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = data[key];
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().replace(/%$/, "").trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function netemPatchFromValues(input: {
  delay?: string;
  jitter?: string;
  loss?: number;
  rate?: number;
  corruption?: number;
}): InterfaceNetemPatch {
  return {
    netemDelay: input.delay ?? "0ms",
    netemJitter: input.jitter ?? "0ms",
    netemLoss: input.loss !== undefined ? String(input.loss) : "0%",
    netemRate: input.rate !== undefined ? String(input.rate) : "0",
    netemCorruption:
      input.corruption !== undefined ? String(input.corruption) : "0",
  };
}

function getActiveTopologyTarget() {
  const topologyRef = topologyManager.getCurrentTopologyRef();
  if (!topologyRef) {
    runtimeUiActions.notify(
      "No active topology session is available.",
      "error",
    );
    return null;
  }
  const endpointId = topologyManager.getCurrentEndpointId() ?? undefined;
  const sessionId = topologyManager.getCurrentSessionId() ?? undefined;
  return { endpointId, sessionId, topologyRef };
}

function openPacketflixCaptures(
  links: Array<{ packetflixUri?: string }>,
): void {
  if (links.length === 0) {
    runtimeUiActions.notify(
      "No packet capture targets were returned.",
      "warning",
    );
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
  theme: "light" | "dark",
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
    window.open(
      `${publicAssetUrl("wireshark.html")}?${params.toString()}`,
      "_blank",
      "noopener,noreferrer",
    );
  }
}

function openCaptureForInterface(
  nodeName: string,
  interfaceName: string,
): void {
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
          remoteHostname: getSessionHostnameOverride(target.endpointId),
        });
        openPacketflixCaptures(response.captures ?? []);
        return;
      }

      const theme = resolveStandaloneTheme(currentTheme);
      const response = await createWiresharkVncSessions({
        ...target,
        targets: [{ containerName: nodeName, interfaceName }],
        theme,
      });
      openWiresharkVncSessions(
        response.sessions ?? [],
        target.endpointId,
        theme,
      );
    } catch (error: unknown) {
      runtimeUiActions.notify(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    }
  })();
}

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

function handleNodeTerminalCommand(msg: VscodeMessage): void {
  const target = getActiveTopologyTarget();
  if (
    !target ||
    typeof msg.nodeName !== "string" ||
    msg.nodeName.trim().length === 0
  ) {
    return;
  }
  runtimeUiActions.openTerminal({
    ...target,
    protocol: msg.command === "clab-node-attach-shell" ? "shell" : "ssh",
    nodeName: msg.nodeName,
    title: `${msg.command === "clab-node-attach-shell" ? "Shell" : "SSH"}: ${msg.nodeName}`,
  });
}

function handleNodeLogsCommand(msg: VscodeMessage): void {
  const target = getActiveTopologyTarget();
  if (
    !target ||
    typeof msg.nodeName !== "string" ||
    msg.nodeName.trim().length === 0
  ) {
    return;
  }
  runtimeUiActions.openLogs({
    ...target,
    nodeName: msg.nodeName,
    title: `Logs: ${msg.nodeName}`,
  });
}

function handleNodeLifecycleCommand(msg: VscodeMessage): void {
  const target = getActiveTopologyTarget();
  const nodeName = typeof msg.nodeName === "string" ? msg.nodeName.trim() : "";
  let action: "start" | "stop" | "restart" | null = null;
  if (msg.command === "clab-node-start") {
    action = "start";
  } else if (msg.command === "clab-node-stop") {
    action = "stop";
  } else if (msg.command === "clab-node-restart") {
    action = "restart";
  }

  if (!target || !nodeName || action === null) {
    return;
  }

  void controlNodeLifecycle({
    ...target,
    nodeName,
    action,
  })
    .then(() => {
      runtimeUiActions.notify(`${nodeName} ${action} requested.`, "success");
    })
    .catch((error: unknown) => {
      runtimeUiActions.notify(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    });
}

function handleLinkImpairmentCommand(msg: VscodeMessage): void {
  const target = getActiveTopologyTarget();
  const nodeName = typeof msg.nodeName === "string" ? msg.nodeName.trim() : "";
  const interfaceName =
    typeof msg.interfaceName === "string" ? msg.interfaceName.trim() : "";
  if (!target || !nodeName) {
    return;
  }
  if (isRecord(msg.data)) {
    if (!interfaceName) {
      runtimeUiActions.notify(
        "Missing interface for link impairment.",
        "error",
      );
      return;
    }
    const delay = optionalStringField(msg.data, "delay");
    const jitter = optionalStringField(msg.data, "jitter");
    const loss = optionalNumberField(msg.data, "loss");
    const rate = optionalNumberField(msg.data, "rate");
    const corruption = optionalNumberField(msg.data, "corruption");
    void setNetem({
      ...target,
      nodeName,
      interfaceName,
      delay,
      jitter,
      loss,
      rate,
      corruption,
    })
      .then(() => {
        useLabStore.getState().updateInterfaceNetemState({
          endpointId: target.endpointId,
          topologyPath: target.topologyRef?.yamlPath,
          labName: target.topologyRef?.labName,
          nodeName,
          interfaceName,
          netem: netemPatchFromValues({
            delay,
            jitter,
            loss,
            rate,
            corruption,
          }),
        });
        runtimeUiActions.notify(
          `Updated impairments for ${nodeName}:${interfaceName}.`,
          "success",
        );
      })
      .catch((error: unknown) => {
        runtimeUiActions.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      });
    return;
  }

  runtimeUiActions.openNetem({
    ...target,
    nodeName,
    preferredInterfaceName: interfaceName || undefined,
    title: `Impairments: ${nodeName}`,
  });
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
  "clab-node-connect-ssh": handleNodeTerminalCommand,
  "clab-node-attach-shell": handleNodeTerminalCommand,
  "clab-node-view-logs": handleNodeLogsCommand,
  "clab-node-start": handleNodeLifecycleCommand,
  "clab-node-stop": handleNodeLifecycleCommand,
  "clab-node-restart": handleNodeLifecycleCommand,
  "clab-interface-capture": (msg) => {
    const nodeName =
      typeof msg.nodeName === "string" ? msg.nodeName.trim() : "";
    const interfaceName =
      typeof msg.interfaceName === "string" ? msg.interfaceName.trim() : "";
    openCaptureForInterface(nodeName, interfaceName);
  },
  "clab-link-impairment": handleLinkImpairmentCommand,
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
    fetchImpl: runtimeFetch,
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
  });
  const requestSnapshot: typeof apiHost.topology.requestSnapshot = async (
    context,
    requestOptions,
  ) => {
    if (!hasActiveConnectedTopologySession()) {
      return createEmptyTopologySnapshot();
    }
    return apiHost.topology.requestSnapshot(context, requestOptions);
  };
  const dispatchCommand: typeof apiHost.topology.dispatchCommand = async (
    context,
    revision,
    command,
  ) => {
    const response = await apiHost.topology.dispatchCommand(
      context,
      revision,
      command,
    );
    return response;
  };

  standaloneRuntime = createClabUiRuntime({
    host: {
      ...apiHost,
      topology: {
        ...apiHost.topology,
        dispatchCommand,
        requestSnapshot,
      },
    },
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

  reactRoot.render(<WorkspaceHostProvider host={workspaceHost}><StandaloneApp /></WorkspaceHostProvider>);
}

/**
 * Root component that handles auth and renders the app.
 */
function StandaloneApp() {
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    setEndpointSessionDuration,
  } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">(() => currentTheme);
  const [terminalPreferences, setTerminalPreferences] =
    useState<TerminalPreferences>(() => loadTerminalPreferences());
  const imageManagerOpen = useRuntimeUiStore((state) => state.imageManagerOpen);
  const closeImageManager = useRuntimeUiStore(
    (state) => state.closeImageManager,
  );
  const terminalCount = useRuntimeUiStore((state) => state.terminals.length);
  const activeLabTabKind = useLabTabsStore((state) => {
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    return activeTab?.kind ?? null;
  });

  const startupScreen = useMemo(
    () => resolveStandaloneStartupScreen(endpointList),
    [endpointList],
  );

  const handleWorkspaceFileEvent = useCallback(
    (endpointId: string, event: WorkspaceFileEvent) => {
      if (event.path === undefined || workspaceEventTouchesTopology(event.path)) {
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
    [addEndpoint, refreshConfig],
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
    [importEndpoints],
  );

  const handleReconnectEndpoint = useCallback(
    async (input: {
      endpointId: string;
      password: string;
      username: string;
    }) => {
      await reconnectEndpoint(input);
      scheduleExplorerSnapshot(0);
    },
    [reconnectEndpoint],
  );

  const handleRemoveEndpoint = useCallback(
    async (endpointId: string) => {
      await closeEndpointTabsAndActivateNext(endpointId);
      await removeEndpoint(endpointId);
      scheduleExplorerSnapshot(0);
    },
    [removeEndpoint],
  );

  const handleThemeChange = useCallback((nextTheme: "light" | "dark") => {
    document.documentElement.classList.toggle("light", nextTheme === "light");
    currentTheme = nextTheme;
    setTheme(nextTheme);
    applyThemeVars(nextTheme);
    persistStandaloneTheme(nextTheme);
  }, []);

  const handleLogout = useCallback(() => {
    topologyManager.closeEventStream();
    clearStandaloneUiState();
    void clearLabTabsAndActiveTopology();
    void logout();
  }, [logout]);

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

  const handleSetEndpointSessionDuration = useCallback(
    (endpointId: string, sessionDuration: EndpointSessionDuration) => {
      setEndpointSessionDuration(endpointId, sessionDuration);
    },
    [setEndpointSessionDuration],
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
    [updateEndpoint],
  );

  if (loading) return <LoadingScreen />;

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
      <App
        initialData={initialData}
        runtime={standaloneRuntime!}
        lifecycleActionsAvailable={getStandaloneBackend().capabilities.lifecycle}
        slots={{
          sidebar: <WorkspaceSidebar colorScheme={theme} onColorSchemeChange={handleThemeChange} onOpenSettings={() => setSettingsOpen(true)} />,
          header: (
            <StandaloneLabTabs
              onActivate={activateLabTabById}
              onClose={closeLabTabAndActivateNext}
            />
          ),
          content:
            activeLabTabKind === "file" ? (
              <StandaloneFileEditor onClose={closeLabTabAndActivateNext} />
            ) : undefined,
          emptyState: <StandaloneLabEmptyState />,
        }}
      />
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
            <RuntimeActionDialogs />
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
            open={settingsOpen}
            onOpen={() => setSettingsOpen(true)}
            onClose={() => setSettingsOpen(false)}
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
    </>
  );
}

/**
 * Compose shared settings with the runtime backend operations.
 */
function SettingsOverlayMounted(props: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
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
    sessionDuration: EndpointSessionDuration,
  ) => void;
  onSaveTerminalPreferences: (
    next: TerminalPreferences,
    options?: {
      notify?: boolean;
    },
  ) => void;
  onThemeChange: (nextTheme: "light" | "dark") => void;
  terminalPreferences: TerminalPreferences;
}) {
  return (
    <MuiThemeProvider>
      <Suspense fallback={null}>
        <LazySettingsOverlay
          open={props.open}
          onOpen={props.onOpen}
          onClose={props.onClose}
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
    </MuiThemeProvider>
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
