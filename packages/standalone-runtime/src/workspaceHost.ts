import type { WorkspaceHost } from "@containerlab/clab-ui/workspace";
import { listFileExplorerDirectory, readFileExplorerFile, writeFileExplorerFile, createFileExplorerDirectory, renderFileExplorerTopology, fetchVersionInfo, fetchVersionCheck, fetchEdgeSharkStatus, installEdgeShark, uninstallEdgeShark, fetchNodeLogs, streamNodeLogs, inspectAllLabs, inspectLab, setNetem, resetNetem, openTerminalSession, closeTerminalSession, getTerminalSession, connectTerminalSessionWebSocket } from "./runtimeApi";
import { fetchEndpointHealthMetrics } from "./endpointHealth";
import { getStandaloneBackend } from "./backend";
import { publicAssetUrl } from "./publicAssetUrl";
import { buildDetachedTerminalUrl } from "./runtimeDetachedTerminal";
import { openLabFileInWorkspace, type LabFileWorkspace } from "./standaloneLabFiles";
import { useAuthStore } from "./stores/authStore";
import { useLabStore } from "./stores/labStore";
import { useWorkspaceViewStore } from "./stores/workspaceViewStore";
import { resolveFileTab, runtimeUiActions, useLabTabsStore } from "@containerlab/clab-ui/workspace/state";

class IdleWebSocket extends EventTarget {
  readonly readyState = 3;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  close = (): void => undefined;
  send = (): void => undefined;
}

const runtimeApi: WorkspaceHost["api"] = {
  listFileExplorerDirectory,
  writeFileExplorerFile,
  renderTopologyFile: renderFileExplorerTopology,
  fetchVersionInfo,
  fetchVersionCheck,
  fetchEdgeSharkStatus,
  installEdgeShark,
  uninstallEdgeShark,
  fetchNodeLogs,
  streamNodeLogs,
  inspectAllLabs,
  inspectLab,
  setNetem,
  resetNetem,
  openTerminalSession,
  closeTerminalSession,
  getTerminalSession,
  connectTerminalSessionWebSocket,
  fetchEndpointHealthMetrics
};

/** Empty runtime results for hosts that only edit topology files. */
const idleRuntimeApi: WorkspaceHost["api"] = {
  listFileExplorerDirectory,
  writeFileExplorerFile,
  fetchVersionInfo,
  fetchVersionCheck,
  fetchEndpointHealthMetrics: async () => ({
    serverInfo: { version: "", uptime: "", startTime: "" },
    metrics: {}
  }),
  fetchEdgeSharkStatus: async () => ({ running: false, packetflixPort: 0, runtime: "none" }),
  installEdgeShark: async () => {},
  uninstallEdgeShark: async () => {},
  fetchNodeLogs: async (target) => ({ containerName: target.nodeName, logs: "" }),
  inspectAllLabs: async () => ({}),
  inspectLab: async () => [],
  setNetem: async () => {},
  resetNetem: async () => {},
  openTerminalSession: async (target) => ({
    sessionId: "",
    username: "",
    labName: "",
    nodeName: target.nodeName,
    protocol: target.protocol,
    state: "closed",
    createdAt: "",
    expiresAt: "",
    lastActivity: ""
  }),
  closeTerminalSession: async () => {},
  connectTerminalSessionWebSocket: () => new IdleWebSocket() as unknown as WebSocket
};

/** Shows a workspace file in a file tab, focusing the tab when it is already open. */
export function openWorkspaceFileInTab(document: {
  content: string;
  endpointId: string;
  path: string;
  title: string;
}): void {
  const tab = resolveFileTab(document);
  // A document replaces the labs overview and any "lab host does not answer" panel.
  useWorkspaceViewStore.getState().setOverviewOpen(false);
  useWorkspaceViewStore.getState().setUnavailableTabId(null);
  const openResult = useLabTabsStore.getState().openOrFocusTab(tab);
  useLabTabsStore.getState().setActiveTab(openResult.tab.id);
}

const labFileWorkspace: LabFileWorkspace = {
  list: listFileExplorerDirectory,
  read: readFileExplorerFile,
  write: writeFileExplorerFile,
  createDirectory: createFileExplorerDirectory,
  openTab: openWorkspaceFileInTab,
  notify: (message, severity) => runtimeUiActions.notify(message, severity)
};

/** The adapter contains effects; clab-ui owns the views and their interaction state. */
export const workspaceHost: WorkspaceHost = {
  get capabilities() {
    return { ...getStandaloneBackend().capabilities, localWireshark: useAuthStore.getState().localWireshark };
  },
  assetUrl: publicAssetUrl,
  get api() {
    return getStandaloneBackend().capabilities.lifecycle ? runtimeApi : idleRuntimeApi;
  },
  labs: {
    getSnapshot: () => useLabStore.getState().labs,
    subscribe: (listener) => useLabStore.subscribe(listener),
    updateInterfaceNetemState: (update) => useLabStore.getState().updateInterfaceNetemState(update)
  },
  openTerminalWindow(pane) {
    if (!getStandaloneBackend().capabilities.lifecycle) return;
    const popup = window.open(buildDetachedTerminalUrl(pane), "_blank", "noopener,noreferrer");
    if (!popup) runtimeUiActions.notify("Browser blocked the terminal popup.", "warning");
  },
  openLabFile(request) {
    void openLabFileInWorkspace(request, request, labFileWorkspace);
  }
};
