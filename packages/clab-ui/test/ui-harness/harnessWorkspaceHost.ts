// Workspace host for the web and sandbox layouts: brand assets resolve, runtime calls are unavailable.
import animatedNoLogoSvg from "../../../standalone-runtime/public/clab-animated-no-logo.svg?url";
import animatedSvg from "../../../standalone-runtime/public/containerlab-animated.svg?url";
import logoSvg from "../../../standalone-runtime/public/containerlab.svg?url";
import type { WorkspaceHost } from "../../src/workspace";
import type { LabState, WorkspaceAsset } from "../../src/workspace/types";

const ASSET_URLS: Record<WorkspaceAsset, string> = {
  "containerlab.svg": logoSvg,
  "containerlab-animated.svg": animatedSvg,
  "clab-animated-no-logo.svg": animatedNoLogoSvg
};
const NO_LABS = new Map<string, LabState>();
const UNAVAILABLE = "Not available in the UI harness";

function unavailable(): never {
  throw new Error(UNAVAILABLE);
}

function rejectUnavailable(): Promise<never> {
  return Promise.reject(new Error(UNAVAILABLE));
}

export function createHarnessWorkspaceHost(hasEndpoints: boolean): WorkspaceHost {
  return {
    capabilities: { lifecycle: hasEndpoints, endpoints: hasEndpoints },
    assetUrl: (asset) => ASSET_URLS[asset],
    openTerminalWindow: () => {},
    labs: {
      getSnapshot: () => NO_LABS,
      subscribe: () => () => {},
      updateInterfaceNetemState: () => {}
    },
    api: {
      fetchEndpointHealthMetrics: rejectUnavailable,
      listFileExplorerDirectory: rejectUnavailable,
      writeFileExplorerFile: rejectUnavailable,
      fetchVersionInfo: rejectUnavailable,
      fetchVersionCheck: rejectUnavailable,
      fetchEdgeSharkStatus: rejectUnavailable,
      installEdgeShark: rejectUnavailable,
      uninstallEdgeShark: rejectUnavailable,
      fetchNodeLogs: rejectUnavailable,
      inspectAllLabs: rejectUnavailable,
      inspectLab: rejectUnavailable,
      setNetem: rejectUnavailable,
      resetNetem: rejectUnavailable,
      openTerminalSession: rejectUnavailable,
      closeTerminalSession: rejectUnavailable,
      connectTerminalSessionWebSocket: unavailable
    }
  };
}
