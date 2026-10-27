import type {
  C9sExposeType,
  LabBackendCapabilities,
  LabBackendFeatures,
  LabExecRequest,
  LabHostInfo,
  LabHostNamespaceMode,
  LabHostProfile,
  LabHostSupport,
  LabLifecycleOptions,
  LabRuntimeKind,
  LabOperationSupport,
  LabSnapshotSaveRequest,
  TailscaleStatus,
  TopologyVariables,
  TopoViewerNodesAction
} from "@containerlab/clab-ui/host";
import type { FileSystemAdapter } from "@containerlab/clab-ui/session";

import type {
  CaptureCloseAllResponse,
  CaptureInterface,
  CaptureStreamOptions,
  CaptureTicket,
  CapturePacketflixResponse,
  CaptureTarget,
  CaptureWiresharkVncCreateResponse,
  CaptureWiresharkVncReadyResponse,
  DrawioGenerateResponse,
  EdgeSharkStatusResponse,
  ExecResponse,
  FcliCommandResponse,
  GenerateTopologyRequest,
  GenerateTopologyResponse,
  GraphExportFormat,
  GraphExportResponse,
  HealthMetricsResponse,
  ImportTopologyFromUrlResponse,
  InspectAllLabsResponse,
  InspectDetailsResponse,
  InspectLabResponse,
  LabStatsSample,
  LifecycleActionResult,
  LogsResponse,
  MermaidDirection,
  NetemResetRequest,
  NetemSetRequest,
  NetemShowResponse,
  NodeBrowserPortsResponse,
  NodeLifecycleAction,
  NodeLogLine,
  RuntimeImageActionResponse,
  RuntimeImagesResponse,
  SaveConfigResponse,
  ShareToolAction,
  ShareToolOptions,
  ShareToolResponse,
  SnapshotSaveResponse,
  SSHAccessResponse,
  TerminalProtocol,
  TerminalSessionInfo,
  TopologyEntry,
  ValidateTopologyResponse,
  VersionCheckResponse,
  VersionResponse,
  WorkspaceFileEntry
} from "./dto.ts";

export type LabBackendKind = "local" | "api";

export type {
  C9sExposeType,
  LabBackendCapabilities,
  LabBackendFeatures,
  LabHostInfo,
  LabHostNamespaceMode,
  LabHostProfile,
  LabHostSupport,
  LabRuntimeKind
};

export type LabLifecycleAction =
  | "deploy"
  | "destroy"
  | "redeploy"
  | "apply"
  | "start"
  | "stop"
  | "restart";

export interface LabTarget {
  /** The lab name; for a running lab, the name containerlab runs it under. */
  labName: string;
  /**
   * The topology file, relative to the workspace. Deploy and apply read it;
   * the other actions find the topology of the running lab.
   */
  path?: string;
}

export interface LifecycleRunOptions {
  /**
   * Remove configuration artifacts: `--reconfigure` for deploy, `--cleanup`
   * for destroy and redeploy.
   */
  cleanup?: boolean;
  /** Extra containerlab options of deploy, redeploy and destroy. */
  lifecycleOptions?: LabLifecycleOptions;
  /** Apply only: report the plan without changing the lab. */
  dryRun?: boolean;
  signal?: AbortSignal;
}

/** One NDJSON line of a streamed lifecycle action. */
export type LifecycleStreamEvent =
  | { type: "log"; line: string; stream?: "stdout" | "stderr" }
  | { type: "done"; message?: string; result?: unknown }
  | { type: "error"; error: string };

/** A `containerlab events --format json` record. */
export interface LabEvent {
  timestamp?: string;
  type: string;
  action: string;
  actor_id?: string;
  actor_name?: string;
  actor_full_id?: string;
  attributes?: Record<string, unknown>;
}

export interface LabEventStreamOptions {
  /** Start with the current state of every container and interface. */
  initialState?: boolean;
  interfaceStats?: boolean;
  /** Go duration between interface statistics samples, e.g. `1s`. */
  interfaceStatsInterval?: string;
}

/**
 * A workspace change. Paths are relative to the workspace root; `kind` is
 * missing when the path no longer exists. A rename reports the old path, and
 * the new path arrives as `create`.
 */
export interface WorkspaceFileEvent {
  type: "workspace-file";
  action: "create" | "change" | "delete" | "rename";
  path: string;
  parentPath: string;
  kind?: "file" | "directory";
}

export interface LabFileContent {
  data: Uint8Array;
  contentType: string;
}

/**
 * The workspace of the signed-in user: topologies, annotations and lab files.
 * Paths are relative to the workspace root and use `/`.
 */
export interface LabFileSystem {
  list(path?: string): Promise<WorkspaceFileEntry[]>;
  /** Rejects with status 413 when the file is larger than `maxBytes`. */
  read(path: string, options?: { maxBytes?: number }): Promise<LabFileContent>;
  write(path: string, content: string | Uint8Array, contentType?: string): Promise<void>;
  delete(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** Resolves once watching has started; ends when `signal` aborts. */
  watch(signal: AbortSignal): Promise<AsyncIterable<WorkspaceFileEvent>>;
}

export interface TopologyFilesOptions {
  labName: string;
  yamlPath?: string;
  annotationsPath?: string;
  /**
   * `running-lab-doc` reads and writes the topology a running lab was deployed
   * from, instead of the workspace file at `yamlPath`.
   */
  sourcePreference?: "api-file" | "running-lab-doc";
}

/** A topology as containerlab renders it before deploying. */
export interface RenderedTopology {
  /** Topology YAML after the template and environment variables are expanded. */
  content: string;
  /** The lab name in the rendered topology, with Git tokens expanded. */
  labName?: string;
  /** Template variable files containerlab used, relative to the topology directory. */
  varsFiles?: string[];
  /** Why containerlab rejects the rendered topology, when it does. */
  error?: string;
}

/** File access for one topology, as the shared topology core expects it. */
export interface TopologyFileSystem extends FileSystemAdapter {
  /** An opaque version of the topology document, if the backend tracks one. */
  revision(path: string): Promise<string | undefined>;
}

export interface TerminalCreateOptions {
  protocol: TerminalProtocol;
  cols: number;
  rows: number;
  sshUsername?: string;
  telnetPort?: number;
  /**
   * Keeps the session running when its stream disconnects, so it can be
   * attached again (`terminalResume`). Without it the session ends with its
   * stream, which is what clients that never attach again expect.
   */
  resumable?: boolean;
}

/** Messages from the lab host, as in the clab-api-server terminal protocol. */
export type TerminalServerMessage =
  | {
      type: "ready";
      sessionId: string;
      protocol: TerminalProtocol;
      createdAt: string;
      expiresAt: string;
      /** The session outlives this connection and can be attached again. */
      resumable?: boolean;
      /** The first output replays the session's recent output. */
      replay?: boolean;
    }
  | { type: "output"; data: string; encoding: "base64" }
  | { type: "exit"; exitCode?: number | null; error?: string; state: string };

export type TerminalClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "close" };

/** A duplex terminal connection. */
export interface TerminalStream {
  send(message: TerminalClientMessage): void;
  onMessage(listener: (message: TerminalServerMessage) => void): () => void;
  /**
   * Called once when the stream ends from either side. `takenOver` is true
   * when another client attached to the session.
   */
  onClose(listener: (reason: string, details: { takenOver: boolean }) => void): () => void;
  /**
   * Disconnects. A resumable session on a lab host with `terminalResume`
   * keeps running for the next attach; send `close` or call `closeTerminal`
   * to end it. Any other session ends with its stream.
   */
  close(): void;
}

export interface NodeLogStreamOptions {
  /** Lines from the end of the log to start with: a number or `all`. */
  tail?: string;
  signal: AbortSignal;
}

export interface LabStatsStreamOptions {
  /** Time between samples, 1 to 20 seconds. */
  intervalSeconds?: number;
  signal: AbortSignal;
}

/** One HTTP request to a Wireshark VNC session's web server. */
export interface WiresharkVncRequest {
  method: string;
  /** Path below the session's `vnc/` root, with query string. */
  path: string;
  headers: Record<string, string>;
}

export interface WiresharkVncResponse {
  status: number;
  headers: Array<[string, string]>;
  body: Uint8Array;
}

/** A WebSocket-like connection to a Wireshark VNC session. */
export interface WiresharkVncSocket {
  send(data: Uint8Array | string, isBinary: boolean): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (data: Uint8Array | string, isBinary: boolean) => void): void;
  onClose(listener: (code: number, reason: string) => void): void;
  onError(listener: (error: Error) => void): void;
  close(code?: number, reason?: string): void;
}

/**
 * Talks to containerlab for one user on one lab host: the local CLI and
 * container runtime, or a clab-api-server.
 */
export interface LabBackend {
  readonly kind: LabBackendKind;
  readonly capabilities: LabBackendCapabilities;
  /** Identifies the lab host, e.g. to serialize edits of one document. */
  readonly scope: string;

  // Host

  version(options?: { timeoutMs?: number }): Promise<VersionResponse>;
  versionCheck(): Promise<VersionCheckResponse>;
  healthMetrics(): Promise<HealthMetricsResponse>;
  features(): Promise<LabBackendFeatures>;
  /** The runtime of the lab host and, for c9s, its cluster settings. */
  hostProfile(): Promise<LabHostProfile>;

  // Labs

  inspectAll(): Promise<InspectAllLabsResponse>;
  inspectLab(labName: string): Promise<InspectLabResponse>;
  isLabRunning(labName: string): Promise<boolean>;
  runLifecycle(
    action: LabLifecycleAction,
    lab: LabTarget,
    options?: LifecycleRunOptions
  ): Promise<LifecycleActionResult>;
  /**
   * Starts a lifecycle action and resolves once it runs. Rejects when it
   * cannot start; failures after that arrive as an `error` event.
   */
  streamLifecycle(
    action: LabLifecycleAction,
    lab: LabTarget,
    options?: LifecycleRunOptions
  ): Promise<AsyncIterable<LifecycleStreamEvent>>;
  deployFromUrl(source: { url: string; labName?: string }): Promise<InspectAllLabsResponse>;
  /** `copyDir` copies the saved configs there (`save --copy`), relative to the topology directory. */
  save(
    lab: LabTarget,
    options?: { nodeFilter?: string; copyDir?: string }
  ): Promise<SaveConfigResponse>;
  graphDrawio(
    lab: LabTarget,
    options: { layout: "horizontal" | "vertical" | "interactive"; theme?: string }
  ): Promise<DrawioGenerateResponse>;
  fcli(lab: LabTarget, command: string): Promise<FcliCommandResponse>;
  /** The Tailscale proxy, sidecars and tailscale nodes of a running lab. */
  tailscaleStatus(labName: string): Promise<TailscaleStatus>;
  shareTool(
    tool: "sshx" | "gotty",
    labName: string,
    action: ShareToolAction,
    options?: ShareToolOptions
  ): Promise<ShareToolResponse>;
  /** `containerlab validate` on the topology file. */
  validate(lab: LabTarget): Promise<ValidateTopologyResponse>;
  /** `containerlab graph --mermaid|--dot`, from the topology file alone. */
  graphExport(
    lab: LabTarget,
    format: GraphExportFormat,
    options?: { direction?: MermaidDirection }
  ): Promise<GraphExportResponse>;
  /** `containerlab generate`: a Clos topology, returned and not written anywhere. */
  generateTopology(request: GenerateTopologyRequest): Promise<GenerateTopologyResponse>;
  /**
   * The Kubernetes resources a c9s deploy would create (`deploy --emit-crs`),
   * as multi-document YAML. Rejects with 501 without `manifestExport`.
   */
  exportManifests(lab: LabTarget): Promise<{ yaml: string }>;

  // Lab operations. Hosts check labOperationSupport() before exec by label,
  // snapshots, save --copy, inspect details and deploy restore.

  labOperationSupport(): Promise<LabOperationSupport>;
  /** `containerlab exec` on the lab's nodes, restricted to the lab. */
  exec(lab: LabTarget, request: LabExecRequest): Promise<ExecResponse>;
  /** Start, stop or restart some nodes of a running lab, by topology node name, at once. */
  nodesAction(
    lab: LabTarget,
    nodeNames: string[],
    action: TopoViewerNodesAction
  ): Promise<LifecycleActionResult>;
  /** `containerlab tools snapshot save` for the lab's VM nodes. */
  saveSnapshots(lab: LabTarget, request: LabSnapshotSaveRequest): Promise<SnapshotSaveResponse>;
  /** `containerlab inspect --details` for one lab. */
  inspectLabDetails(lab: LabTarget): Promise<InspectDetailsResponse>;

  // Nodes (by container name)

  nodeAction(labName: string, containerName: string, action: NodeLifecycleAction): Promise<void>;
  nodeLogs(labName: string, containerName: string, options?: { tail?: string }): Promise<LogsResponse>;
  /**
   * Follows a node's container log: the last `tail` lines, then new lines as
   * the node writes them. Resolves once the stream is open; ends when
   * `signal` aborts or the container goes away.
   */
  streamNodeLogs(
    labName: string,
    containerName: string,
    options: NodeLogStreamOptions
  ): Promise<AsyncIterable<NodeLogLine>>;
  nodeBrowserPorts(labName: string, containerName: string): Promise<NodeBrowserPortsResponse>;
  requestSshAccess(
    labName: string,
    containerName: string,
    options?: { sshUsername?: string; duration?: string }
  ): Promise<SSHAccessResponse>;

  // Terminals

  createTerminal(
    labName: string,
    containerName: string,
    options: TerminalCreateOptions
  ): Promise<TerminalSessionInfo>;
  getTerminal(sessionId: string): Promise<TerminalSessionInfo>;
  closeTerminal(sessionId: string): Promise<void>;
  /** Resolves once the terminal is attached. */
  attachTerminal(sessionId: string): Promise<TerminalStream>;

  // Links

  netemShow(containerName: string): Promise<NetemShowResponse>;
  netemSet(request: NetemSetRequest): Promise<void>;
  netemReset(request: NetemResetRequest): Promise<void>;

  // Capture

  edgesharkStatus(): Promise<EdgeSharkStatusResponse>;
  edgesharkInstall(): Promise<void>;
  edgesharkUninstall(): Promise<void>;
  capturePacketflix(
    labName: string,
    request: { targets: CaptureTarget[]; remoteHostname?: string }
  ): Promise<CapturePacketflixResponse>;
  createWiresharkVnc(
    labName: string,
    request: { targets: CaptureTarget[]; theme?: string }
  ): Promise<CaptureWiresharkVncCreateResponse>;
  wiresharkVncReady(sessionId: string): Promise<CaptureWiresharkVncReadyResponse>;
  closeWiresharkVnc(sessionId: string): Promise<void>;
  closeAllWiresharkVnc(): Promise<CaptureCloseAllResponse>;
  /**
   * The lab-link interfaces of a running lab's nodes, with their peers.
   * Rejects with 501 without the `captureStream` feature.
   */
  captureInterfaces(labName: string): Promise<CaptureInterface[]>;
  /**
   * Captures the targets into one pcapng stream: one section, one interface
   * per target, named `<node>:<interface>`. Resolves once the capture runs;
   * the stream ends at the duration or packet limit, or when `signal`
   * aborts, always with a complete last block. Long captures are continuous;
   * gaps go to `onGap`. On c9s, `containerName` of a target is the inspect
   * name (`<lab>-<node>`). Rejects with 501 without `captureStream`.
   */
  openCaptureStream(labName: string, options: CaptureStreamOptions): Promise<AsyncIterable<Uint8Array>>;
  /**
   * A single-use `packetflix:` link to a capture of the targets, valid for a
   * short time. Rejects with 501 without the `captureTickets` support.
   */
  createCaptureTicket(
    labName: string,
    targets: CaptureTarget[],
    options?: { duration?: string }
  ): Promise<CaptureTicket>;
  fetchWiresharkVnc(sessionId: string, request: WiresharkVncRequest): Promise<WiresharkVncResponse>;
  connectWiresharkVnc(
    sessionId: string,
    path: string,
    options: { protocols: string[]; origin?: string }
  ): WiresharkVncSocket;

  // Images

  listImages(): Promise<RuntimeImagesResponse>;
  pullImage(image: string): Promise<RuntimeImageActionResponse>;
  removeImage(reference: string, force?: boolean): Promise<RuntimeImageActionResponse>;

  // Files

  readonly fs: LabFileSystem;
  listTopologies(): Promise<TopologyEntry[]>;
  importTopologyFromUrl(source: {
    url: string;
    labName?: string;
  }): Promise<ImportTopologyFromUrlResponse>;
  topologyFiles(options: TopologyFilesOptions): TopologyFileSystem;
  /** The topology YAML a running lab was deployed from. */
  runningTopologyYaml(labName: string): Promise<string>;
  /**
   * Renders the topology at `lab.path` like a deploy would, without
   * deploying. `varsFile` is relative to the topology file. Rejects with
   * 422 when the template does not render and 501 when the lab host cannot
   * render topologies.
   */
  renderTopology(lab: LabTarget, options?: { varsFile?: string }): Promise<RenderedTopology>;
  /**
   * The lab name, topology directory and the named environment variables
   * containerlab would expand in the topology at `lab.path`.
   */
  topologyVariables(
    lab: LabTarget,
    request: { labName: string; envNames: string[] }
  ): Promise<TopologyVariables>;
  /**
   * Watches one topology document. Lines are NDJSON records such as
   * `{"type":"topology-doc",...}`; resolves once watching has started.
   */
  watchTopology(
    labName: string,
    path: string,
    signal: AbortSignal
  ): Promise<AsyncIterable<string>>;

  // Live state

  /** Resolves once the stream is open; ends when `signal` aborts. */
  events(options: LabEventStreamOptions, signal: AbortSignal): Promise<AsyncIterable<LabEvent>>;
  /**
   * The CPU and memory usage of a lab's running nodes, one sample per
   * interval. Rejects with 501 when the lab host has no `nodeStats`.
   */
  streamLabStats(labName: string, options: LabStatsStreamOptions): Promise<AsyncIterable<LabStatsSample>>;

  /** Stops background work: event streams, terminals and capture containers. */
  dispose(): void | Promise<void>;
}
