import type { CustomIconInfo, CustomNodeTemplate } from "@containerlab/clab-ui/session";

// DTOs exchanged unchanged between the API proxy and standalone renderer.

export interface SaveConfigResponse {
  message: string;
  output: string;
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
