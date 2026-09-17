import type {
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologySnapshot
} from "../core/types/messages";
import type { TopologyRef } from "../contract/topologyRef";
import type { DeploymentState } from "../core/types/topology";
import type {
  ExplorerIncomingMessage,
  ExplorerUiState
} from "../explorer/shared/explorer/types";
import type {
  ContainerImageSummary,
  ImageActionResult,
  ImageManagerTargetOptions,
  ImagePullRequest,
  ImageRemoveRequest,
  KindImageReference
} from "../image-manager/types";

export type TopoViewerLifecycleAction =
  | "deployLab"
  | "deployLabCleanup"
  | "destroyLab"
  | "destroyLabCleanup"
  | "redeployLab"
  | "redeployLabCleanup"
  | "applyLab"
  | "startLab"
  | "stopLab"
  | "restartLab";

export type TopoViewerNodeAction = "ssh" | "shell" | "logs" | "start" | "stop" | "restart";

export interface TopoViewerSvgExportPayload {
  requestId: string;
  baseName: string;
  svgContent: string;
  dashboardJson: string;
  panelYaml: string;
}

export type ClabUiTopoViewerEvent =
  | {
      type: "modeChanged";
      mode: "editor" | "viewer";
      deploymentState: DeploymentState;
      /** Whether the on-disk topology diverged from the runtime (apply pending). */
      dirty?: boolean;
    }
  | {
      type: "panelAction";
      action: string;
      nodeId?: string;
      edgeId?: string;
    }
  | {
      type: "customNodesUpdated";
      customNodes: unknown[];
      defaultNode: string;
    }
  | {
      type: "customNodeError";
      error: string;
    }
  | {
      type: "iconList";
      icons: unknown[];
    }
  | {
      type: "lifecycleLog";
      line: string;
      stream: "stdout" | "stderr";
    }
  | {
      type: "lifecycleStatus";
      status: "success" | "error";
      errorMessage?: string;
    }
  | {
      type: "fitViewport";
    }
  | {
      type: "svgExportResult";
      requestId: string;
      success: boolean;
      error?: string;
      files?: string[];
    };

export interface HostRuntimeInterfaceStats {
  rxBps?: number;
  txBps?: number;
  rxPps?: number;
  txPps?: number;
  rxBytes?: number;
  txBytes?: number;
  rxPackets?: number;
  txPackets?: number;
  statsIntervalSeconds?: number;
}

export interface HostRuntimeNetemState {
  delay?: string;
  jitter?: string;
  loss?: string;
  rate?: string;
  corruption?: string;
}

export interface HostRuntimeInterface {
  name: string;
  alias: string;
  label?: string;
  mac: string;
  mtu: number;
  state: string;
  type: string;
  ifIndex?: number;
  stats?: HostRuntimeInterfaceStats;
  netemState?: HostRuntimeNetemState;
}

export interface HostRuntimeContainer {
  name: string;
  nodeName: string;
  labName: string;
  state: string;
  kind: string;
  image: string;
  ipv4Address: string;
  ipv6Address: string;
  interfaces?: HostRuntimeInterface[];
}

export interface TopologyUiContext {
  topologyRef?: TopologyRef;
  path?: string;
  mode?: "edit" | "view";
  deploymentState?: DeploymentState;
  sessionId?: string;
  runtimeContainers?: HostRuntimeContainer[];
}

export type TopologySessionContext = TopologyUiContext;

export interface TopologyUiRequestOptions {
  externalChange?: boolean;
}

export interface ClabUiExplorerHost {
  connect(): void;
  setFilter(filterText: string): void | Promise<void>;
  invokeAction(actionRef: string): void | Promise<void>;
  persistUiState(state: ExplorerUiState): void | Promise<void>;
  subscribe(handler: (message: ExplorerIncomingMessage) => void): () => void;
}

export interface ClabUiTopoViewerHost {
  runLifecycle(action: TopoViewerLifecycleAction): void;
  cancelLifecycle(): void;
  toggleSplitView(): void;
  runNodeAction(action: TopoViewerNodeAction, nodeName: string): void;
  captureInterface(nodeName: string, interfaceName: string): void;
  setLinkImpairment(nodeName: string, interfaceName: string, data: unknown): void;
  saveCustomNode(data: Record<string, unknown>): void;
  deleteCustomNode(nodeName: string): void;
  setDefaultCustomNode(nodeName: string): void;
  importCustomNodes(): void;
  requestIconList(): void;
  uploadIcon(): void;
  deleteIcon(iconName: string): void;
  reconcileIcons(usedIcons: string[]): void;
  exportGrafanaBundle(payload: TopoViewerSvgExportPayload): void;
  dumpCssVars(vars: Record<string, string>): void;
  subscribe(handler: (event: ClabUiTopoViewerEvent) => void): () => void;
}

export interface ClabUiImageHost {
  listImages(options?: ImageManagerTargetOptions): Promise<ContainerImageSummary[]>;
  listImageReferences(options?: ImageManagerTargetOptions): Promise<KindImageReference[]>;
  pullImage(request: ImagePullRequest): Promise<ImageActionResult>;
  removeImage(request: ImageRemoveRequest): Promise<ImageActionResult>;
}

export interface ClabUiHost {
  postMessage(message: unknown): void;
  subscribe(handler: (event: MessageEvent<unknown>) => void): () => void;
  meta?: {
    isDevMock?: boolean;
    disableDevMockTraffic?: boolean;
  };
  explorer: ClabUiExplorerHost;
  images?: ClabUiImageHost;
  topoViewer: ClabUiTopoViewerHost;
  topology: {
    requestSnapshot(
      context: TopologyUiContext,
      options?: TopologyUiRequestOptions
    ): Promise<TopologySnapshot>;
    dispatchCommand(
      context: TopologyUiContext,
      revision: number,
      command: TopologyHostCommand
    ): Promise<TopologyHostResponseMessage>;
  };
}

export interface CustomPaletteTab {
  id: string;
  label: string;
  render: () => React.ReactNode;
}
