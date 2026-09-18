import type { TopologyRef } from "../session";

export interface RuntimeTargetRequest {
  endpointId?: string;
  sessionId?: string;
  topologyRef?: TopologyRef;
}

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
  nodeName: string;
  group: string;
  owner: string;
}

export type InspectAllLabsResponse = Record<string, InspectContainerInfo[]>;
export type InspectLabResponse = InspectContainerInfo[];

export interface IconImportResponse {
  imported: number;
  renamed: Record<string, string>;
}

export interface NetemFields {
  delay: string;
  jitter: string;
  loss: string;
  rate: string;
  corruption: string;
}

export interface FileExplorerEntry {
  endpointId: string;
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  modifiedAt?: string;
  hasChildren?: boolean;
  labName?: string;
  deploymentState?: string;
  topologyRef?: TopologyRef;
}

export interface FileExplorerDocument {
  endpointId: string;
  path: string;
  content: string;
}

export type LabArchiveFormat = "zip" | "tar.gz";

export interface BinaryDownloadResult {
  blob: Blob;
  contentType: string;
  filename: string;
}

export interface DeployLabFromUrlResponse {
  success: boolean;
  labNames: string[];
}

export interface ImportTopologyFromUrlResponse {
  success: boolean;
  topologyRef: TopologyRef;
  labName: string;
  fileName: string;
}

export type NodeLifecycleAction = "start" | "stop" | "restart" | "pause" | "unpause";

export interface ContainerState {
  endpointId: string;
  name: string;
  containerId: string;
  labName: string;
  labPath: string;
  owner: string;
  nodeName: string;
  kind: string;
  image: string;
  state: string;
  status: string;
  ipv4Address: string;
  ipv6Address: string;
  interfaces: Map<string, InterfaceState>;
}

export interface InterfaceState {
  name: string;
  alias: string;
  label: string;
  state: string;
  type: string;
  mac: string;
  mtu: string;
  ifIndex?: string;
  rxBps?: string;
  txBps?: string;
  rxPps?: string;
  txPps?: string;
  rxBytes?: string;
  txBytes?: string;
  rxPackets?: string;
  txPackets?: string;
  statsIntervalSeconds?: string;
  netemDelay?: string;
  netemJitter?: string;
  netemLoss?: string;
  netemRate?: string;
  netemCorruption?: string;
}

export interface LabState {
  endpointId: string;
  name: string;
  owner: string;
  topologyPath: string;
  containers: Map<string, ContainerState>;
}

export type InterfaceNetemPatch = Partial<Pick<InterfaceState, "netemDelay" | "netemJitter" | "netemLoss" | "netemRate" | "netemCorruption">>;
export interface EndpointConfig {
  id: string;
  url: string;
  label: string;
  username: string;
  sessionDuration: EndpointSessionDuration;
  status: EndpointStatus;
  connected: boolean;
}

export type EndpointStatus = "connected" | "session_expired" | "offline" | "saved";
export type EndpointSessionDuration = string;
export interface EndpointImportResult { added: number; duplicates: number; total: number; unchanged: number; updated: number; }
export interface EndpointHealthMetrics {
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

export interface EdgeSharkStatusResponse {
  running: boolean;
  version?: string;
  packetflixPort: number;
  runtime: string;
}
