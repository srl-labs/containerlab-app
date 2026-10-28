import type { CustomIconInfo, CustomNodeTemplate } from "@containerlab/clab-ui/session";

// DTOs every lab backend returns, unchanged from clab-api-server JSON. They are
// shared with the standalone renderer, which reads them through the app server.

export interface SaveConfigResponse {
  message: string;
  output: string;
  /** Where `save --copy` put the configs. */
  copyDir?: string;
}

export interface SSHAccessResponse {
  port: number;
  host: string;
  username: string;
  expiration: string;
  command: string;
}

export type TerminalProtocol = "ssh" | "shell" | "telnet";

export interface TerminalSessionInfo {
  sessionId: string;
  username: string;
  labName: string;
  nodeName: string;
  protocol: TerminalProtocol;
  state: string;
  createdAt: string;
  expiresAt: string;
  lastActivity: string;
  /** The session outlives a disconnected stream. Older lab hosts leave it out. */
  resumable?: boolean;
  /** A client is connected to the session's stream. */
  attached?: boolean;
  exitCode?: number | null;
  error?: string;
}

export interface LogsResponse {
  containerName: string;
  logs: string;
}

/** One line of a node's container log. */
export interface NodeLogLine {
  line: string;
  /** The container output the line came from, when the lab host tells. */
  stream?: "stdout" | "stderr";
}

/** Resource usage of one running node. */
export interface NodeStats {
  /** Container name. */
  name: string;
  /** Node name in the topology. */
  nodeName: string;
  /** CPU usage since the previous sample, where 100 is one busy CPU; missing in a node's first sample. */
  cpuPercent?: number;
  /** CPUs the node can use, when known. */
  cpuCount?: number;
  memoryBytes: number;
  memoryLimitBytes?: number;
  pids?: number;
}

/** The resource usage of a lab's running nodes at one time. */
export interface LabStatsSample {
  type: "stats";
  /** ISO timestamp. */
  time: string;
  intervalSeconds: number;
  nodes: NodeStats[];
}

export interface VersionResponse {
  versionInfo: string;
}

export interface VersionCheckResponse {
  checkResult: string;
}

export interface CustomNodesResponse {
  customNodes: CustomNodeTemplate[];
  defaultNode: string;
}

export interface IconListResponse {
  icons: CustomIconInfo[];
}

export interface IconUploadRequest {
  fileName: string;
  contentType?: string;
  dataBase64: string;
}

export interface IconUploadResponse {
  success: boolean;
  iconName: string;
}

export interface NetemInterfaceInfo {
  interface: string;
  delay: string;
  jitter: string;
  packet_loss: number;
  rate: number;
  corruption?: number;
}

export type NetemShowResponse = Record<string, NetemInterfaceInfo[]>;

export interface CaptureTarget {
  containerName: string;
  interfaceName: string;
  /** The name is the port inside the node: capture it there, not on the host-side link end. */
  nodeNamespace?: boolean;
}

/**
 * A lab-link interface a lab host with `captureStream` can capture, as
 * `containerlab capture --list` reports it.
 */
export interface CaptureInterface {
  /** The node as the topology spells it. */
  node: string;
  /** The interface name in the node; what the capture's pcapng `if_name` carries. */
  interface: string;
  /** The vendor name the topology used, e.g. `ethernet-1/1` for SR Linux `e1-1`. */
  alias?: string;
  /** The node at the other end of the link; `host` for a host endpoint. */
  peerNode: string;
  /** The peer's interface as the link names it. */
  peerInterface: string;
}

/**
 * A capture that switched segments and missed packets in between. The
 * stream goes on; clients show it as a status, not as an error.
 */
export interface CaptureGap {
  node?: string;
  interfaces?: string[];
  /** RFC 3339 times on the pod clock, when known. */
  from?: string;
  to?: string;
  reason?: string;
}

export interface CaptureStreamOptions {
  targets: CaptureTarget[];
  /** Go duration, e.g. `30s`. Without it the capture runs until `signal` aborts. */
  duration?: string;
  /** Packets across all targets after which the capture ends. */
  packetLimit?: number;
  /** Bytes kept of each packet, 64 to 1048576; the lab host's default when unset. */
  snapLength?: number;
  /** Ends the capture; the stream then ends cleanly. */
  signal: AbortSignal;
  /** Called when the lab host reports a gap; the stream goes on. */
  onGap?: (gap: CaptureGap) => void;
}

export interface CapturePacketflixURI {
  containerName: string;
  interfaceNames: string[];
  packetflixUri: string;
}

export interface CapturePacketflixResponse {
  captures: CapturePacketflixURI[];
}

export interface CaptureWiresharkVncSession {
  sessionId: string;
  labName: string;
  containerName: string;
  interfaceNames: string[];
  vncPath: string;
  showVolumeTip: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface CaptureWiresharkVncCreateResponse {
  sessions: CaptureWiresharkVncSession[];
}

export interface CaptureWiresharkVncReadyResponse {
  ready: boolean;
  url: string;
}

export interface EdgeSharkStatusResponse {
  running: boolean;
  version?: string;
  packetflixPort: number;
  runtime: string;
}

export interface RuntimeImageSummary {
  id: string;
  shortId?: string;
  repoTags: string[];
  repoDigests: string[];
  created?: number;
  createdAt?: string;
  size?: number | string;
  virtualSize?: number | string;
}

export interface RuntimeImagesResponse {
  runtime: string;
  images: RuntimeImageSummary[];
}

export interface RuntimeImageActionResponse {
  success: boolean;
  image?: string;
  message?: string;
  output?: string;
}

export interface NodeBrowserPort {
  hostIp?: string;
  hostPort: number;
  containerPort: number;
  protocol?: string;
  description?: string;
}

export interface NodeBrowserPortsResponse {
  nodeName: string;
  containerName: string;
  ports: NodeBrowserPort[];
}

export type ShareToolAction = "attach" | "detach" | "reattach";

export interface ShareToolResponse {
  message: string;
  link?: string;
  output?: string;
  /** sshx with `enableReaders`: the link that only watches the session. */
  readOnlyLink?: string;
  /** GoTTY: the web terminal user and shell in effect, never the password. */
  username?: string;
  shell?: string;
}

export interface FcliCommandResponse {
  command: string;
  output: string;
}

export interface DrawioGenerateResponse {
  fileName: string;
  content: string;
  layout: string;
  message?: string;
  output?: string;
}

export interface CaptureCloseAllResponse {
  message: string;
  closed: number;
}

export interface LoginResponse {
  token: string;
}

/** A topology file in the lab workspace, as the explorer lists it. */
export interface TopologyEntry {
  labName: string;
  absolutePath?: string;
  yamlFileName: string;
  annotationsFileName: string;
  hasAnnotations: boolean;
  deploymentState: string;
}

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  modifiedAt?: string;
  hasChildren?: boolean;
}

export interface LifecycleActionResult {
  result?: unknown;
  message?: string;
  logs?: string[];
}

/**
 * One container of a running lab, as `containerlab inspect --format json`
 * reports it. Some keys are snake_case on the wire (`container_id`,
 * `ipv4_address`, `lab_name`), so callers that need them read both spellings.
 */
export interface InspectContainerInfo {
  name: string;
  containerId: string;
  image: string;
  kind: string;
  state: string;
  status: string;
  ipv4Address: string;
  ipv6Address: string;
  labName: string;
  labPath: string;
  absLabPath: string;
  group: string;
  owner: string;
}

export type InspectAllLabsResponse = Record<string, InspectContainerInfo[]>;
export type InspectLabResponse = InspectContainerInfo[];

export interface HealthMetricsResponse {
  serverInfo: {
    version: string;
    uptime: string;
    startTime: string;
  };
  metrics: {
    cpu?: {
      usagePercent: number;
      numCPU: number;
      loadAvg1?: number;
      loadAvg5?: number;
      loadAvg15?: number;
      processPercent?: number;
    };
    mem?: {
      totalMem: number;
      usedMem: number;
      availableMem: number;
      usagePercent: number;
      processMemMB?: number;
      processMemPct?: number;
    };
    disk?: {
      path: string;
      totalDisk: number;
      usedDisk: number;
      freeDisk: number;
      usagePercent: number;
    };
  };
}

export interface NetemSetRequest {
  containerName: string;
  interface: string;
  delay?: string;
  jitter?: string;
  loss?: number;
  rate?: number;
  corruption?: number;
}

export interface NetemResetRequest {
  containerName: string;
  interface: string;
}

export type NodeLifecycleAction = "start" | "stop" | "restart" | "pause" | "unpause";

export interface ImportTopologyFromUrlResponse {
  success: boolean;
  labName: string;
  fileName: string;
  topology: TopologyEntry;
}

// Lab operations: exec, VM snapshots and inspect details.

/** One command run in one container, as `containerlab exec --format json` reports it. */
export interface ExecCommandResult {
  cmd: string[];
  "return-code": number;
  /** containerlab embeds output that is valid JSON as JSON. */
  stdout: unknown;
  stderr: string;
}

/** Exec results by container name. */
export type ExecResponse = Record<string, ExecCommandResult[]>;

export interface SnapshotNodeResult {
  node: string;
  status: "success" | "failed" | "skipped";
  path?: string;
  sizeBytes?: number;
  durationMs?: number;
  error?: string;
  reason?: string;
}

export interface SnapshotSaveResponse {
  outputDir: string;
  results: SnapshotNodeResult[];
  summary: string;
}

/** `containerlab inspect --details`: full runtime records of the containers, by lab name. */
export type InspectDetailsResponse = Record<string, Record<string, unknown>[]>;

// Lab operation tools: validate, generate, text graph exports and share options.

/** `containerlab validate`; a rejected topology is `valid: false`, not an error. */
export interface ValidateTopologyResponse {
  valid: boolean;
  path: string;
  labName?: string;
  nodes: number;
  links: number;
  /** containerlab's error when `valid` is false. */
  error?: string;
}

export type GraphExportFormat = "mermaid" | "dot";
export type MermaidDirection = "TD" | "TB" | "BT" | "RL" | "LR";

/** `containerlab graph --mermaid` or `--dot`. */
export interface GraphExportResponse {
  fileName: string;
  content: string;
  format: GraphExportFormat;
  direction?: MermaidDirection;
  output?: string;
}

/** One Clos stage of `containerlab generate --nodes <count>:<kind>:<type>`. */
export interface GenerateTopologyTier {
  count: number;
  kind?: string;
  type?: string;
}

export interface GenerateTopologyRequest {
  name: string;
  tiers: GenerateTopologyTier[];
  /** Kind of tiers that name none. */
  defaultKind?: string;
  /** Image per kind. */
  images: Record<string, string>;
  /** License file per kind, on the lab host. */
  licenses?: Record<string, string>;
  nodePrefix?: string;
  groupPrefix?: string;
  managementNetwork?: string;
  ipv4Subnet?: string;
  ipv6Subnet?: string;
}

export interface GenerateTopologyResponse {
  message: string;
  topologyYaml?: string;
}

/** Options of `containerlab tools sshx|gotty attach|reattach`. */
export interface ShareToolOptions {
  /** GoTTY: the port it listens on. */
  port?: number;
  /** sshx: also create a read-only link. */
  enableReaders?: boolean;
  /** GoTTY: web terminal credentials, both or neither. */
  username?: string;
  password?: string;
  /** GoTTY: the shell of the web terminal. */
  shell?: string;
}
