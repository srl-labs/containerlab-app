import type { WorkspaceHost } from "@containerlab/clab-ui/workspace";
import { writeFileExplorerFile, fetchVersionInfo, fetchVersionCheck, fetchEdgeSharkStatus, installEdgeShark, uninstallEdgeShark, fetchNodeLogs, inspectAllLabs, inspectLab, setNetem, resetNetem, openTerminalSession, closeTerminalSession, connectTerminalSessionWebSocket } from "./runtimeApi";
import { fetchEndpointHealthMetrics } from "./endpointHealth";
import { getStandaloneBackend } from "./backend";
import { publicAssetUrl } from "./publicAssetUrl";
import { buildDetachedTerminalUrl } from "./runtimeDetachedTerminal";
import { useLabStore } from "./stores/labStore";
import { runtimeUiActions } from "./stores/runtimeUiStore";

/** The adapter contains effects; clab-ui owns the views and their interaction state. */
export const workspaceHost: WorkspaceHost = {
  get capabilities() { return getStandaloneBackend().capabilities; },
  assetUrl: publicAssetUrl,
  api: { writeFileExplorerFile, fetchVersionInfo, fetchVersionCheck, fetchEdgeSharkStatus, installEdgeShark, uninstallEdgeShark, fetchNodeLogs, inspectAllLabs, inspectLab, setNetem, resetNetem, openTerminalSession, closeTerminalSession, connectTerminalSessionWebSocket, fetchEndpointHealthMetrics },
  labs: {
    getSnapshot: () => useLabStore.getState().labs,
    subscribe: (listener) => useLabStore.subscribe(listener),
    updateInterfaceNetemState: (update) => useLabStore.getState().updateInterfaceNetemState(update)
  },
  openTerminalWindow(pane) {
    const popup = window.open(buildDetachedTerminalUrl(pane), "_blank", "noopener,noreferrer");
    if (!popup) runtimeUiActions.notify("Browser blocked the terminal popup.", "warning");
  }
};
