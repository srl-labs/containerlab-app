/**
 * Standalone app entry point.
 *
 * Modeled on dev/main.tsx but connects to the real clab-api-server
 * through the Fastify backend instead of using mock data.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { App, useTopoViewerStore } from "@srl-labs/clab-ui";
import "@srl-labs/clab-ui/styles/global.css";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

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
import type {
  ExplorerIncomingMessage,
  ExplorerUiState
} from "@srl-labs/clab-ui/explorer";

import clabSchema from "../schema/clab.schema.json";
import { useLabStore, type LabState } from "./stores/labStore";
import { useAuth } from "./hooks/useAuth";
import { useEventStream } from "./hooks/useEventStream";
import { LoginPage } from "./components/LoginPage";
import { RuntimeActionDialogs } from "./components/RuntimeActionDialogs";
import { RuntimeTerminalWindows } from "./components/RuntimeTerminalWindows";
import { SettingsOverlay } from "./components/SettingsOverlay";
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
  labsEqualForExplorer,
  normalizePathValue
} from "./standaloneHostShared";
import { createStandaloneTopologyManager } from "./standaloneTopology";
import {
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
  try {
    const raw = localStorage.getItem("clab-standalone-theme");
    if (raw === "light") return "light";
  } catch { /* ignore */ }
  return "dark";
}

function persistTheme(theme: "light" | "dark"): void {
  try {
    localStorage.setItem("clab-standalone-theme", theme);
  } catch { /* ignore */ }
}

currentTheme = loadPersistedTheme();

const EXPLORER_REFRESH_DEBOUNCE_MS = 90;
const TOPOLOGY_REFRESH_DEBOUNCE_MS = 120;
function removeLabFromRuntimeStore(topologyRef: Pick<TopologyRef, "yamlPath">): void {
  useLabStore.setState((state) => {
    let changed = false;
    const nextLabs = new Map(state.labs);
    const normalizedPath = normalizePathValue(topologyRef.yamlPath ?? "");
    for (const [key, lab] of nextLabs.entries()) {
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

async function refreshCustomNodesForAuthenticatedUser(): Promise<void> {
  const response = await fetchUiCustomNodes();
  applyCustomNodes(response.customNodes, response.defaultNode);
}

async function refreshCustomIconsForCurrentTopology(): Promise<void> {
  const topologyRef = topologyManager.getCurrentTopologyRef();
  if (!topologyRef) {
    applyCustomIcons([]);
    return;
  }

  const response = await fetchUiIcons({
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
  getLabs: () => useLabStore.getState().labs,
  invalidateTopologyFileListCache: topologyManager.invalidateTopologyFileListCache,
  invokeLifecycleApi: lifecycleManager.invokeLifecycleApi,
  listTopologyFiles: topologyManager.listTopologyFiles,
  loadTopologyFile: topologyManager.loadTopologyFile,
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
      const sessionId = topologyManager.getCurrentSessionId() ?? undefined;
      return { sessionId, topologyRef };
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
      void saveUiCustomNode(payload as Record<string, unknown>).then((response) => {
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
      void deleteUiCustomNode(nodeName).then((response) => {
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
      void setDefaultUiCustomNode(nodeName).then((response) => {
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
          await uploadUiIcon(file);
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
      void deleteUiIcon(iconName).then(() => refreshCustomIconsForCurrentTopology()).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        runtimeUiActions.notify(errorMessage, "error");
      });
      return;
    }

    if (msg.command === "icon-reconcile") {
      const target = topologyManager.getCurrentTopologyRef()
        ? {
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

/**
 * Root component that handles auth and renders the app.
 */
function StandaloneApp() {
  const { isAuthenticated, loading, logout, login, error } = useAuth();
  const connected = useLabStore((s) => s.connected);
  const [theme, setTheme] = useState<"light" | "dark">(() => currentTheme);
  const [apiUrl, setApiUrl] = useState("");
  const [terminalPreferences, setTerminalPreferences] = useState<TerminalPreferences>(() =>
    loadTerminalPreferences()
  );

  // Start event stream when authenticated
  useEventStream(isAuthenticated);

  // Refresh explorer when lab state changes
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

  const refreshApiConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config", { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { clabApiUrl?: string; defaultClabApiUrl?: string };
      if (typeof data.clabApiUrl === "string" && data.clabApiUrl.length > 0) {
        setApiUrl(data.clabApiUrl);
        return;
      }
      if (typeof data.defaultClabApiUrl === "string" && data.defaultClabApiUrl.length > 0) {
        setApiUrl(data.defaultClabApiUrl);
      }
    } catch {
      // Keep current value if config endpoint is temporarily unavailable
    }
  }, []);

  useEffect(() => {
    void refreshApiConfig();
  }, [isAuthenticated, refreshApiConfig]);

  useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated) {
      clearStandaloneUiState();
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
  }, [isAuthenticated]);

  useEffect(() => {
    topologyManager.setAuthenticated(isAuthenticated);
    return () => {
      topologyManager.closeEventStream();
    };
  }, [isAuthenticated]);

  const handleLogin = useCallback(
    async (username: string, password: string, selectedApiUrl: string) => {
      await login(username, password, selectedApiUrl);
      await refreshApiConfig();
    },
    [login, refreshApiConfig]
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
    void topologyManager.disposeCurrentSession();
    void logout();
  }, [logout]);

  const handleSaveTerminalPreferences = useCallback((next: TerminalPreferences) => {
    setTerminalPreferences(persistTerminalPreferences(next));
    runtimeUiActions.notify("Terminal settings updated.", "success");
  }, []);

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

  if (!isAuthenticated) {
    return (
      <MuiThemeProvider>
        <LoginPage
          error={error}
          apiUrl={apiUrl}
          onApiUrlChange={setApiUrl}
          onLogin={handleLogin}
        />
      </MuiThemeProvider>
    );
  }

  return (
    <>
      <App initialData={initialData} runtime={standaloneRuntime!} />
      <MuiThemeProvider>
        <RuntimeTerminalWindows />
        <RuntimeActionDialogs />
      </MuiThemeProvider>
      <SettingsOverlayMounted
        currentTheme={theme}
        onThemeChange={handleThemeChange}
        onLogout={handleLogout}
        onSaveTerminalPreferences={handleSaveTerminalPreferences}
        connected={connected}
        apiUrl={apiUrl || "unknown"}
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
  onThemeChange: (nextTheme: "light" | "dark") => void;
  onLogout: () => void;
  onSaveTerminalPreferences: (next: TerminalPreferences) => void;
  connected: boolean;
  apiUrl: string;
  terminalPreferences: TerminalPreferences;
}) {
  const overlayContainer = document.getElementById("settings-overlay");
  if (!overlayContainer) return null;

  return createPortal(
    <MuiThemeProvider>
      <SettingsOverlay
        currentTheme={props.currentTheme}
        onThemeChange={props.onThemeChange}
        onLogout={props.onLogout}
        onSaveTerminalPreferences={props.onSaveTerminalPreferences}
        apiUrl={props.apiUrl}
        connected={props.connected}
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
