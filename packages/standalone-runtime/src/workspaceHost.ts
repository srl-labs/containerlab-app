import type { WorkspaceHost } from "@containerlab/clab-ui/workspace";
import { writeFileExplorerFile, fetchVersionInfo, fetchVersionCheck, fetchEdgeSharkStatus, installEdgeShark, uninstallEdgeShark, fetchNodeLogs, inspectAllLabs, inspectLab, setNetem, resetNetem, openTerminalSession, closeTerminalSession, connectTerminalSessionWebSocket } from "./runtimeApi";
import { fetchEndpointHealthMetrics } from "./endpointHealth";
import { getStandaloneBackend } from "./backend";
import { publicAssetUrl } from "./publicAssetUrl";
import { buildDetachedTerminalUrl } from "./runtimeDetachedTerminal";
import { useLabStore } from "./stores/labStore";
import { runtimeUiActions } from "./stores/runtimeUiStore";

class IdleWebSocket extends EventTarget {
  readonly readyState = 3;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  close = (): void => undefined;
  send = (): void => undefined;
}

const idleExplorer: WorkspaceHost["explorer"] = {
  listTopologies: async () => [],
  listDirectory: async () => [],
  subscribe: () => () => {},
  createTopology: () => {},
  openTopology: () => {},
  openFile: () => {}
};

const runtimeApi: WorkspaceHost["api"] = {
  writeFileExplorerFile,
  fetchVersionInfo,
  fetchVersionCheck,
  fetchEdgeSharkStatus,
  installEdgeShark,
  uninstallEdgeShark,
  fetchNodeLogs,
  inspectAllLabs,
  inspectLab,
  setNetem,
  resetNetem,
  openTerminalSession,
  closeTerminalSession,
  connectTerminalSessionWebSocket,
  fetchEndpointHealthMetrics
};

/** Empty runtime results for hosts that only edit topology files. */
const idleRuntimeApi: WorkspaceHost["api"] = {
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
    lastActivity: ""
  }),
  closeTerminalSession: async () => {},
  connectTerminalSessionWebSocket: () => new IdleWebSocket() as unknown as WebSocket
};

let explorer = idleExplorer;

/** Replaces the idle explorer with host file and topology operations. */
export function connectWorkspaceExplorer(next: WorkspaceHost["explorer"]): void {
  explorer = next;
}

/** The adapter contains effects; clab-ui owns the views and their interaction state. */
export const workspaceHost: WorkspaceHost = {
  get capabilities() { return getStandaloneBackend().capabilities; },
  assetUrl: publicAssetUrl,
  get api() {
    return getStandaloneBackend().capabilities.lifecycle ? runtimeApi : idleRuntimeApi;
  },
  labs: {
    getSnapshot: () => useLabStore.getState().labs,
    subscribe: (listener) => useLabStore.subscribe(listener),
    updateInterfaceNetemState: (update) => useLabStore.getState().updateInterfaceNetemState(update)
  },
  get explorer() { return explorer; },
  openTerminalWindow(pane) {
    if (!getStandaloneBackend().capabilities.lifecycle) return;
    const popup = window.open(buildDetachedTerminalUrl(pane), "_blank", "noopener,noreferrer");
    if (!popup) runtimeUiActions.notify("Browser blocked the terminal popup.", "warning");
  }
};
