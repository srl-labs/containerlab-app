import type {
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologySnapshot
} from "../core/types/messages";
import type { TopologyRef } from "../contract/topologyRef";
import type { DeploymentState } from "../core/types/topology";
import type { SchemaData } from "../core/schema";
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

import type { ApplyPlan } from "./applyPlan";
import type { ClabUiLabOperationsHost } from "./labOperations";
import type { LabLifecycleOptionKind, LabLifecycleOptions } from "./lifecycleOptions";
import type { TailscaleStatus } from "./tailscaleStatus";

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

/** Lifecycle actions that take `LabLifecycleOptions`, with the option set each one uses. */
export const LIFECYCLE_ACTION_OPTION_KIND: Partial<
  Record<TopoViewerLifecycleAction, LabLifecycleOptionKind>
> = {
  deployLab: "deploy",
  deployLabCleanup: "deploy",
  redeployLab: "redeploy",
  redeployLabCleanup: "redeploy",
  destroyLab: "destroy",
  destroyLabCleanup: "destroy"
};

export type TopoViewerNodeAction = "ssh" | "shell" | "logs" | "start" | "stop" | "restart";

/** Node actions that act on several nodes in one containerlab call. */
export type TopoViewerNodesAction = Extract<TopoViewerNodeAction, "start" | "stop" | "restart">;

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

export interface CaptureInterfacesOptions {
  /**
   * The names are ports inside the node's network namespace: capture them
   * there as-is, instead of resolving aliases to host-side link ends.
   */
  nodeNamespace?: boolean;
  /** Name for the capture window or tab, e.g. the ports as the user knows them (1/1/c1/1). */
  label?: string;
}

/** A port of a node, named as the topology shows it. */
export interface CaptureTargetRef {
  nodeName: string;
  interfaceName: string;
}

export interface ClabUiTopoViewerHost {
  /** `options` adds containerlab flags to deploy, redeploy and destroy; other actions ignore it. */
  runLifecycle(action: TopoViewerLifecycleAction, options?: LabLifecycleOptions): void;
  /**
   * Dry-run `containerlab apply` and return what it would change. Hosts that
   * omit it apply without showing a plan first.
   */
  planApply?(): Promise<ApplyPlan>;
  /**
   * Tailscale devices of the running lab. Resolves undefined when the lab host
   * cannot report them; hosts that omit it never can.
   */
  tailscaleStatus?(): Promise<TailscaleStatus | undefined>;
  cancelLifecycle(): void;
  toggleSplitView(): void;
  runNodeAction(action: TopoViewerNodeAction, nodeName: string): void;
  /**
   * Start, stop or restart several nodes at once (`--node a,b`). Hosts that
   * omit it get one `runNodeAction` per node.
   */
  runNodesAction?(action: TopoViewerNodesAction, nodeNames: string[]): void;
  /** Exec, snapshots, config save and inspect details; hosts that omit it hide them. */
  labOperations?: ClabUiLabOperationsHost;
  captureInterface(
    nodeName: string,
    interfaceName: string,
    options?: Pick<CaptureInterfacesOptions, "label">
  ): void;
  /** Capture several interfaces of one node together in a single session. */
  captureInterfaces(
    nodeName: string,
    interfaceNames: string[],
    options?: CaptureInterfacesOptions
  ): void;
  /**
   * Capture ports of several nodes, such as both ends of a link, in as few
   * sessions as possible: ports that share a network namespace (host-side link
   * ends) share one session.
   */
  captureTargets(targets: CaptureTargetRef[], options?: Pick<CaptureInterfacesOptions, "label">): void;
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

/** Editor reference data owned by the host: the schema and the images it can run. */
export interface ClabUiEditorDataHost {
  /** Host-provided containerlab schema; the bundled schema applies when absent. */
  getSchema(): SchemaData | undefined;
  /** Image references known to the host, or undefined until the host has provided them. */
  getDockerImages(): string[] | undefined;
  subscribeDockerImages(handler: (images: string[]) => void): () => void;
}

export interface ClabUiHost {
  postMessage(message: unknown): void;
  subscribe(handler: (event: MessageEvent<unknown>) => void): () => void;
  meta?: {
    isDevMock?: boolean;
    disableDevMockTraffic?: boolean;
  };
  editorData?: ClabUiEditorDataHost;
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
