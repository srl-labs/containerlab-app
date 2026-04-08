/**
 * Standalone app entry point.
 *
 * Modeled on dev/main.tsx but connects to the real clab-api-server
 * through the Fastify backend instead of using mock data.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { App, useTopoViewerStore } from "@srl-labs/clab-ui";
import "@srl-labs/clab-ui/styles/global.css";
import * as EditorWorkerModule from "monaco-editor/esm/vs/editor/editor.worker?worker";
import * as JsonWorkerModule from "monaco-editor/esm/vs/language/json/json.worker?worker";

import {
  createApiClabUiHost,
  createClabUiRuntime
} from "@srl-labs/clab-ui/host";
import { applyThemeVars, MuiThemeProvider } from "@srl-labs/clab-ui/theme";
import {
  EXPORT_COMMANDS,
  MSG_CANCEL_LAB_LIFECYCLE,
  MSG_SVG_EXPORT_RESULT,
  parseSchemaData,
  type TopologyRef
} from "@srl-labs/clab-ui/session";

import clabSchema from "../schema/clab.schema.json";
import { useLabStore } from "./stores/labStore";
import { useEndpointStore, type EndpointSessionDuration } from "./stores/endpointStore";
import { useAuth } from "./hooks/useAuth";
import { useEventStream } from "./hooks/useEventStream";
import { LabTabsBar } from "./components/LabTabsBar";
import { LoginPage } from "./components/LoginPage";
import { RuntimeActionDialogs } from "./components/RuntimeActionDialogs";
import { RuntimeTerminalWindows } from "./components/RuntimeTerminalWindows";
import { SettingsOverlay } from "./components/SettingsOverlay";
import { resolveStandaloneStartupScreen } from "./startupScreen";
import {
  loadTerminalPreferences,
  persistTerminalPreferences,
  type TerminalPreferences
} from "./runtimeTerminalSettings";
import { createStandaloneExplorerBridge } from "./standaloneExplorer";
import {
  createStandaloneLifecycleManager,
  isStandaloneLifecycleCommand
} from "./standaloneLifecycle";
import {
  type DeploymentState,
  extractEndpointIdFromTopologyId,
  labsEqualForExplorer,
  normalizePathValue
} from "./standaloneHostShared";
import { createStandaloneTopologyManager } from "./standaloneTopology";
import {
  resolveLabTab,
  useLabTabsStore
} from "./stores/labTabsStore";
import { readPersistedStandaloneTheme, resolveStandaloneTheme } from "./standaloneTheme";
import {
  createWiresharkVncSessions,
  deleteUiCustomNode,
  deleteUiIcon,
  fetchUiCustomNodes,
  fetchUiIcons,
  reconcileUiIcons,
  saveUiCustomNode,
  setDefaultUiCustomNode,
  uploadUiIcon
} from "./runtimeApi";
import { runtimeUiActions } from "./stores/runtimeUiStore";

// Monaco workers setup
const monacoGlobal = self as typeof self & {
  MonacoEnvironment?: {
    getWorker: (workerId: string, label: string) => Worker;
  };
};
const EditorWorker = (EditorWorkerModule as { default: new () => Worker }).default;
const JsonWorker = (JsonWorkerModule as { default: new () => Worker }).default;

if (!monacoGlobal.MonacoEnvironment) {
  monacoGlobal.MonacoEnvironment = {
    getWorker: (_workerId: string, label: string) => {
      if (label === "json") {
        return new JsonWorker();
      }
      return new EditorWorker();
    }
  };
}

// Schema data
const schemaData = parseSchemaData(clabSchema as Record<string, unknown>);

// Initial data for the App
const initialData = {
  schemaData,
  dockerImages: [] as string[],
  customNodes: [],
  defaultNode: "",
  customIcons: []
};

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
  invokeLifecycleApi: lifecycleManager.invokeLifecycleApi,
  listTopologyFiles: topologyManager.listTopologyFiles,
  loadTopologyFile: openTopologyInTab,
  removeEndpoint: async (endpointId) => {
    await closeEndpointTabsAndActivateNext(endpointId);
    await topologyManager.disposeEndpointSession(endpointId);
  },
  resolveApiTopologyPath: topologyManager.resolveApiTopologyPath,
  resolveDeploymentState: topologyManager.resolveDeploymentState,
  resolveTopologyRef: topologyManager.resolveTopologyRef
});

scheduleExplorerSnapshot = explorerBridge.scheduleSnapshot;

// Standalone host bridge - explicit UI host with API-backed topology transport.
function setupStandaloneUiHost(): void {
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

  const warnedCommands = new Set<string>();

  const triggerDownload = (filename: string, content: string, mimeType: string): void => {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const postMessage = (message: unknown) => {
    const msg = message as VscodeMessage | undefined;

    if (!msg?.command) return;

    const getActiveTopologyTarget = () => {
      const topologyRef = topologyManager.getCurrentTopologyRef();
      if (!topologyRef) {
        runtimeUiActions.notify("No active topology session is available.", "error");
        return null;
      }
      const endpointId = topologyManager.getCurrentEndpointId() ?? undefined;
      const sessionId = topologyManager.getCurrentSessionId() ?? undefined;
      return { endpointId, sessionId, topologyRef };
    };

    const openCaptureVncForInterface = (nodeName: string, interfaceName: string): void => {
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
          const theme = resolveStandaloneTheme(currentTheme);

          const response = await createWiresharkVncSessions({
            ...target,
            targets: [{ containerName: nodeName, interfaceName }],
            theme
          });

          const sessions = response.sessions ?? [];
          if (sessions.length === 0) {
            runtimeUiActions.notify("No Wireshark sessions were created.", "warning");
            return;
          }

          for (const session of sessions) {
            const params = new URLSearchParams({ sessionId: session.sessionId, theme });
            if (target.endpointId) {
              params.set("endpointId", target.endpointId);
            }
            if (session.showVolumeTip) {
              params.set("showVolumeTip", "1");
            }
            window.open(`/wireshark.html?${params.toString()}`, "_blank", "noopener,noreferrer");
          }
        } catch (error: unknown) {
          runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
        }
      })();
    };

    if (msg.command === "reactTopoViewerLog" || msg.command === "topoViewerLog") {
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

    if (msg.command === EXPORT_COMMANDS.EXPORT_SVG_GRAFANA_BUNDLE) {
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
      return;
    }

    if (msg.command === "clab-node-connect-ssh" || msg.command === "clab-node-attach-shell") {
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
      return;
    }

    if (msg.command === "clab-node-view-logs") {
      const target = getActiveTopologyTarget();
      if (!target || typeof msg.nodeName !== "string" || msg.nodeName.trim().length === 0) {
        return;
      }
      runtimeUiActions.openLogs({
        ...target,
        nodeName: msg.nodeName,
        title: `Logs: ${msg.nodeName}`
      });
      return;
    }

    if (msg.command === "clab-interface-capture") {
      const nodeName = typeof msg.nodeName === "string" ? msg.nodeName.trim() : "";
      const interfaceName = typeof msg.interfaceName === "string" ? msg.interfaceName.trim() : "";
      openCaptureVncForInterface(nodeName, interfaceName);
      return;
    }

    if (msg.command === "clab-link-impairment") {
      const target = getActiveTopologyTarget();
      if (
        !target ||
        typeof msg.nodeName !== "string" ||
        msg.nodeName.trim().length === 0
      ) {
        return;
      }
      runtimeUiActions.openNetem({
        ...target,
        nodeName: msg.nodeName,
        preferredInterfaceName:
          typeof msg.interfaceName === "string" ? msg.interfaceName : undefined,
        title: `Impairments: ${msg.nodeName}`
      });
      return;
    }

    if (msg.command === "topo-toggle-split-view") {
      runtimeUiActions.notify(
        "Split view is not available in standalone mode yet.",
        "info"
      );
      return;
    }

    if (msg.command === "save-custom-node") {
      const { command: _command, ...payload } = msg;
      void saveUiCustomNode(payload as Record<string, unknown>, getEndpointIdForEditorContext()).then((response) => {
        applyCustomNodeError(null);
        applyCustomNodes(response.customNodes, response.defaultNode);
      }).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        applyCustomNodeError(errorMessage);
        runtimeUiActions.notify(errorMessage, "error");
      });
      return;
    }

    if (msg.command === "delete-custom-node") {
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
      return;
    }

    if (msg.command === "set-default-custom-node") {
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
      return;
    }

    if (msg.command === "icon-list") {
      void refreshCustomIconsForCurrentTopology().catch(() => {
        applyCustomIcons([]);
      });
      return;
    }

    if (msg.command === "icon-upload") {
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
      return;
    }

    if (msg.command === "icon-delete") {
      const iconName = typeof msg.iconName === "string" ? msg.iconName.trim() : "";
      if (!iconName) {
        runtimeUiActions.notify("Missing icon name.", "error");
        return;
      }
      void deleteUiIcon(iconName, getEndpointIdForEditorContext()).then(() => refreshCustomIconsForCurrentTopology()).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        runtimeUiActions.notify(errorMessage, "error");
      });
      return;
    }

    if (msg.command === "icon-reconcile") {
      const target = topologyManager.getCurrentTopologyRef()
        ? {
            endpointId: topologyManager.getCurrentEndpointId() ?? undefined,
            sessionId: topologyManager.getCurrentSessionId() ?? undefined,
            topologyRef: topologyManager.getCurrentTopologyRef() ?? undefined
          }
        : null;
      if (!target) {
        return;
      }
      const usedIcons = Array.isArray(msg.usedIcons)
        ? msg.usedIcons.filter((value): value is string => typeof value === "string")
        : [];
      void reconcileUiIcons({ ...target, usedIcons }).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[Standalone] icon reconcile failed:", errorMessage);
      });
      return;
    }

    if (!warnedCommands.has(msg.command)) {
      warnedCommands.add(msg.command);
      console.warn(`[Standalone] Unhandled VS Code command: ${msg.command}`);
    }
  };

  standaloneRuntime = createClabUiRuntime({
    host: createApiClabUiHost({
      explorer: explorerBridge.explorer,
      postMessage,
      targetWindow: window,
      meta: {
        isDevMock: true,
        disableDevMockTraffic: true
      }
    })
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
  (window as unknown as Record<string, unknown>).__SCHEMA_DATA__ = initialData.schemaData;
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

function StandaloneLabTabsMount(): React.JSX.Element | null {
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

function StandaloneLabEmptyStateMount(): React.JSX.Element | null {
  const host = useLabEmptyStatePortalHost();
  const tabs = useLabTabsStore((state) => state.tabs);
  const occlusion = useEmptyStateOcclusion(host);

  if (!host || tabs.length > 0) {
    return null;
  }

  return createPortal(
    <div
      data-testid="standalone-empty-lab-state"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--vscode-editor-background, #1e1e1e)",
        color: "var(--vscode-editor-foreground, #d4d4d4)",
        textAlign: "center",
        paddingLeft: occlusion.left,
        paddingRight: occlusion.right
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          maxWidth: 460,
          padding: "20px 24px"
        }}
      >
        <img
          src="/containerlab.svg"
          alt="containerlab"
          style={{
            width: 120,
            height: "auto",
            opacity: 0.95
          }}
        />
        <div style={{ fontSize: 18, fontWeight: 600 }}>No lab is open</div>
        <div style={{ fontSize: 13, opacity: 0.82, lineHeight: 1.4 }}>
          Open a lab from the explorer, or create a new `*.clab.yml` file to start.
        </div>
      </div>
    </div>,
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
    hasConnectedEndpoint,
    hasEndpointSession,
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
    topologyManager.setAuthenticated(hasEndpointSession);
    return () => {
      topologyManager.closeEventStream();
    };
  }, [hasEndpointSession]);

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
        <LoginPage
          defaultApiUrl={defaultApiUrl}
          endpoints={endpointList}
          error={error}
          onAddEndpoint={handleAddEndpoint}
          onReconnectEndpoint={handleReconnectEndpoint}
          onRemoveEndpoint={handleRemoveEndpoint}
          onUpdateEndpoint={handleUpdateEndpoint}
        />
      </MuiThemeProvider>
    );
  }

  return (
    <>
      <App initialData={initialData} runtime={standaloneRuntime!} />
      <StandaloneLabTabsMount />
      <StandaloneLabEmptyStateMount />
      <MuiThemeProvider>
        <RuntimeTerminalWindows
          onSaveTerminalPreferences={handleSaveTerminalPreferences}
          terminalPreferences={terminalPreferences}
        />
        <RuntimeActionDialogs />
      </MuiThemeProvider>
      <SettingsOverlayMounted
        currentTheme={theme}
        defaultApiUrl={defaultApiUrl}
        endpoints={endpointList}
        onAddEndpoint={handleAddEndpoint}
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
      <SettingsOverlay
        currentTheme={props.currentTheme}
        defaultApiUrl={props.defaultApiUrl}
        endpoints={props.endpoints}
        onAddEndpoint={props.onAddEndpoint}
        onThemeChange={props.onThemeChange}
        onLogout={props.onLogout}
        onReconnectEndpoint={props.onReconnectEndpoint}
        onRemoveEndpoint={props.onRemoveEndpoint}
        onUpdateEndpoint={props.onUpdateEndpoint}
        onSetEndpointSessionDuration={props.onSetEndpointSessionDuration}
        onSaveTerminalPreferences={props.onSaveTerminalPreferences}
        terminalPreferences={props.terminalPreferences}
      />
    </MuiThemeProvider>,
    overlayContainer
  );
}

// Bootstrap

if (currentTheme === "light") {
  document.documentElement.classList.add("light");
} else {
  document.documentElement.classList.remove("light");
}
applyThemeVars(currentTheme);
setupStandaloneUiHost();
renderApp();
