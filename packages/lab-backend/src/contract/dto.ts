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
  exitCode?: number | null;
  error?: string;
}

export interface LogsResponse {
  containerName: string;
  logs: string;
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
