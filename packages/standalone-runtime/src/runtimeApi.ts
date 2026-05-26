import type { CustomIconInfo, CustomNodeTemplate, TopologyRef } from "@srl-labs/clab-ui/session";

import { extractEndpointIdFromTopologyId } from "./standaloneHostShared";
import { standaloneServerUrl } from "./standaloneServerOrigin";
import { useEndpointStore } from "./stores/endpointStore";
import { useLabStore } from "./stores/labStore";
import { isPagesRuntimeMode, PAGES_SANDBOX_ENDPOINT_ID } from "./runtimeMode";

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

export interface IconUploadResponse {
  success: boolean;
  iconName: string;
}

export interface NetemFields {
  delay: string;
  jitter: string;
  loss: string;
  rate: string;
  corruption: string;
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

export interface NetemShowResult {
  containerName: string;
  impairments: NetemShowResponse;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function pickString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = toStringValue(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return "";
}

function normalizeInspectContainer(value: unknown): InspectContainerInfo {
  const record = isRecord(value) ? value : {};
  return {
    name: pickString(record, "name"),
    containerId: pickString(record, "containerId", "container_id", "id"),
    image: pickString(record, "image"),
    kind: pickString(record, "kind"),
    state: pickString(record, "state"),
    status: pickString(record, "status"),
    ipv4Address: pickString(
      record,
      "ipv4Address",
      "ipv4_address",
      "IPv4Address",
      "mgmtIpv4Address",
      "mgmt_ipv4"
    ),
    ipv6Address: pickString(
      record,
      "ipv6Address",
      "ipv6_address",
      "IPv6Address",
      "mgmtIpv6Address",
      "mgmt_ipv6"
    ),
    labName: pickString(record, "labName", "lab_name"),
    labPath: pickString(record, "labPath", "lab_path"),
    absLabPath: pickString(record, "absLabPath", "abs_lab_path"),
    nodeName: pickString(record, "nodeName", "node_name", "clab-node-name"),
    group: pickString(record, "group"),
    owner: pickString(record, "owner")
  };
}

function normalizeInspectContainerList(value: unknown): InspectLabResponse {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => normalizeInspectContainer(entry));
}

function normalizeInspectAllLabsPayload(value: unknown): InspectAllLabsResponse {
  if (!isRecord(value)) {
    return {};
  }
  const normalized: InspectAllLabsResponse = {};
  for (const [labName, containers] of Object.entries(value)) {
    normalized[labName] = normalizeInspectContainerList(containers);
  }
  return normalized;
}

function resolveEndpointId(
  target?: RuntimeTargetRequest | { endpointId?: string }
): string | undefined {
  return target?.endpointId;
}

function resolveTargetEndpointId(target?: RuntimeTargetRequest): string | undefined {
  return (
    resolveEndpointId(target) ?? extractEndpointIdFromTopologyId(target?.topologyRef?.topologyId)
  );
}

function withEndpointHeaders(init: RequestInit = {}, endpointId?: string): RequestInit {
  if (!endpointId) {
    return init;
  }
  const headers = new Headers(init.headers);
  headers.set("x-endpoint-id", endpointId);
  return {
    ...init,
    headers
  };
}

async function readError(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const text = await response.text().catch(() => fallback);
  if (!text) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
    if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
      return parsed.message;
    }
  } catch {
    // Fall back to raw text.
  }
  return text;
}

function markEndpointUnavailable(
  endpointId: string | undefined,
  status: "offline" | "session_expired"
): void {
  if (!endpointId) {
    return;
  }
  if (isPagesRuntimeMode() && endpointId === PAGES_SANDBOX_ENDPOINT_ID) {
    return;
  }
  useLabStore.getState().setConnected(endpointId, false);
  useEndpointStore.getState().setStatus(endpointId, status);
}

const ABSOLUTE_OR_PROTOCOL_RELATIVE_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

export function resolveRuntimeRequestUrl(
  input: string,
  toStandaloneServerUrl: (path: string) => string = standaloneServerUrl
): string {
  return ABSOLUTE_OR_PROTOCOL_RELATIVE_URL.test(input) ? input : toStandaloneServerUrl(input);
}

async function requestJson<T>(input: string, init?: RequestInit, endpointId?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(resolveRuntimeRequestUrl(input), {
      credentials: "include",
      ...init
    });
  } catch (error) {
    markEndpointUnavailable(endpointId, "offline");
    throw error;
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      markEndpointUnavailable(endpointId, "session_expired");
    }
    throw new Error(await readError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function filenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) {
    return fallback;
  }
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header)?.[1];
  if (quoted) {
    return quoted;
  }
  const bare = /filename=([^;]+)/i.exec(header)?.[1]?.trim();
  return bare || fallback;
}

async function requestBlob(
  input: string,
  fallbackFilename: string,
  init?: RequestInit,
  endpointId?: string
): Promise<BinaryDownloadResult> {
  let response: Response;
  try {
    response = await fetch(resolveRuntimeRequestUrl(input), {
      credentials: "include",
      ...init
    });
  } catch (error) {
    markEndpointUnavailable(endpointId, "offline");
    throw error;
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      markEndpointUnavailable(endpointId, "session_expired");
    }
    throw new Error(await readError(response));
  }

  return {
    blob: await response.blob(),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    filename: filenameFromContentDisposition(
      response.headers.get("content-disposition"),
      fallbackFilename
    )
  };
}

function asJsonBody(body: unknown, endpointId?: string): RequestInit {
  return withEndpointHeaders(
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    endpointId
  );
}

export async function inspectAllLabs(endpointId?: string): Promise<InspectAllLabsResponse> {
  const payload = await requestJson<unknown>(
    "/api/runtime/inspect/all",
    withEndpointHeaders({}, endpointId),
    endpointId
  );
  return normalizeInspectAllLabsPayload(payload);
}

export async function inspectLab(target: RuntimeTargetRequest): Promise<InspectLabResponse> {
  const endpointId = resolveTargetEndpointId(target);
  const payload = await requestJson<unknown>(
    "/api/runtime/inspect/lab",
    asJsonBody(target, endpointId),
    endpointId
  );
  return normalizeInspectContainerList(payload);
}

export async function saveLabConfigs(
  input: RuntimeTargetRequest & {
    nodeName?: string;
  }
): Promise<SaveConfigResponse> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<SaveConfigResponse>(
    "/api/runtime/save",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function requestNodeSsh(
  input: RuntimeTargetRequest & {
    nodeName: string;
    duration?: string;
    sshUsername?: string;
  }
): Promise<SSHAccessResponse> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<SSHAccessResponse>(
    "/api/runtime/ssh",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function openTerminalSession(
  input: RuntimeTargetRequest & {
    nodeName: string;
    protocol: TerminalProtocol;
    cols: number;
    rows: number;
    sshUsername?: string;
    telnetPort?: number;
  }
): Promise<TerminalSessionInfo> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<TerminalSessionInfo>(
    "/api/runtime/terminal-sessions",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function fetchTerminalSession(
  sessionId: string,
  endpointId?: string
): Promise<TerminalSessionInfo> {
  return await requestJson<TerminalSessionInfo>(
    `/api/runtime/terminal-sessions/${encodeURIComponent(sessionId)}`,
    withEndpointHeaders({}, endpointId),
    endpointId
  );
}

export async function closeTerminalSession(sessionId: string, endpointId?: string): Promise<void> {
  await requestJson<{ success: boolean }>(
    `/api/runtime/terminal-sessions/${encodeURIComponent(sessionId)}`,
    withEndpointHeaders({ method: "DELETE" }, endpointId),
    endpointId
  );
}

export function connectTerminalSessionWebSocket(sessionId: string, endpointId?: string): WebSocket {
  const url = new URL(
    `/api/runtime/terminal-sessions/${encodeURIComponent(sessionId)}/stream`,
    window.location.origin
  );
  if (endpointId) {
    url.searchParams.set("endpointId", endpointId);
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(url);
}

export async function fetchNodeLogs(
  input: RuntimeTargetRequest & {
    nodeName: string;
    tail?: string;
  }
): Promise<LogsResponse> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<LogsResponse>(
    "/api/runtime/logs",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function controlNodeLifecycle(
  input: RuntimeTargetRequest & {
    nodeName: string;
    action: NodeLifecycleAction;
  }
): Promise<void> {
  const endpointId = resolveTargetEndpointId(input);
  await requestJson<{ success: boolean }>(
    `/api/runtime/nodes/${encodeURIComponent(input.action)}`,
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function fetchNodeBrowserPorts(
  input: RuntimeTargetRequest & {
    nodeName: string;
  }
): Promise<NodeBrowserPortsResponse> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<NodeBrowserPortsResponse>(
    "/api/runtime/nodes/browser-ports",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function runSshxShareAction(
  input: RuntimeTargetRequest & {
    action: ShareToolAction;
  }
): Promise<ShareToolResponse> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<ShareToolResponse>(
    `/api/runtime/share/sshx/${encodeURIComponent(input.action)}`,
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function runGottyShareAction(
  input: RuntimeTargetRequest & {
    action: ShareToolAction;
    port?: number;
  }
): Promise<ShareToolResponse> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<ShareToolResponse>(
    `/api/runtime/share/gotty/${encodeURIComponent(input.action)}`,
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function runFcliCommand(
  input: RuntimeTargetRequest & {
    command: string;
  }
): Promise<FcliCommandResponse> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<FcliCommandResponse>(
    "/api/runtime/fcli",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function generateDrawioGraph(
  input: RuntimeTargetRequest & {
    layout: "horizontal" | "vertical" | "interactive";
    theme?: string;
  }
): Promise<DrawioGenerateResponse> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<DrawioGenerateResponse>(
    "/api/runtime/labs/graph/drawio",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function fetchVersionInfo(endpointId?: string): Promise<VersionResponse> {
  return await requestJson<VersionResponse>(
    "/api/runtime/version",
    withEndpointHeaders({}, endpointId),
    endpointId
  );
}

export async function fetchVersionCheck(endpointId?: string): Promise<VersionCheckResponse> {
  return await requestJson<VersionCheckResponse>(
    "/api/runtime/version/check",
    withEndpointHeaders({}, endpointId),
    endpointId
  );
}

export async function fetchEdgeSharkStatus(endpointId?: string): Promise<EdgeSharkStatusResponse> {
  return await requestJson<EdgeSharkStatusResponse>(
    "/api/runtime/capture/edgeshark/status",
    withEndpointHeaders({}, endpointId),
    endpointId
  );
}

export async function fetchRuntimeImages(endpointId?: string): Promise<RuntimeImagesResponse> {
  return await requestJson<RuntimeImagesResponse>(
    "/api/runtime/images",
    withEndpointHeaders({}, endpointId),
    endpointId
  );
}

export async function pullRuntimeImage(
  input: RuntimeTargetRequest & {
    image: string;
  }
): Promise<RuntimeImageActionResponse> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<RuntimeImageActionResponse>(
    "/api/runtime/images/pull",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function removeRuntimeImage(
  input: RuntimeTargetRequest & {
    reference: string;
    force?: boolean;
  }
): Promise<RuntimeImageActionResponse> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<RuntimeImageActionResponse>(
    "/api/runtime/images/remove",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function installEdgeShark(endpointId?: string): Promise<void> {
  await requestJson<{ success: boolean }>(
    "/api/runtime/capture/edgeshark/install",
    withEndpointHeaders({ method: "POST" }, endpointId),
    endpointId
  );
}

export async function uninstallEdgeShark(endpointId?: string): Promise<void> {
  await requestJson<{ success: boolean }>(
    "/api/runtime/capture/edgeshark/uninstall",
    withEndpointHeaders({ method: "POST" }, endpointId),
    endpointId
  );
}

export async function listFileExplorerDirectory(
  endpointId: string,
  pathValue = ""
): Promise<FileExplorerEntry[]> {
  const params = new URLSearchParams();
  if (pathValue) {
    params.set("path", pathValue);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return await requestJson<FileExplorerEntry[]>(
    `/api/runtime/file-explorer/tree${suffix}`,
    withEndpointHeaders({}, endpointId),
    endpointId
  );
}

export async function readFileExplorerFile(
  endpointId: string,
  pathValue: string
): Promise<FileExplorerDocument> {
  return await requestJson<FileExplorerDocument>(
    `/api/runtime/file-explorer/file?path=${encodeURIComponent(pathValue)}`,
    withEndpointHeaders({}, endpointId),
    endpointId
  );
}

function safeDownloadFallbackName(pathValue: string): string {
  const segments = pathValue.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || "download";
}

export async function downloadFileExplorerFile(
  endpointId: string,
  pathValue: string
): Promise<BinaryDownloadResult> {
  return await requestBlob(
    `/api/runtime/file-explorer/download?path=${encodeURIComponent(pathValue)}`,
    safeDownloadFallbackName(pathValue),
    withEndpointHeaders({}, endpointId),
    endpointId
  );
}

export async function uploadFileExplorerFile(input: {
  endpointId: string;
  file?: File;
  files?: readonly File[];
  path: string;
  targetKind?: "directory" | "file";
}): Promise<void> {
  const files = input.files ?? (input.file ? [input.file] : []);
  if (files.length === 0) {
    throw new Error("Select at least one file to upload.");
  }
  const form = new FormData();
  form.set("path", input.path);
  if (input.targetKind) {
    form.set("targetKind", input.targetKind);
  }
  for (const file of files) {
    form.append("file", file, file.name);
  }
  await requestJson<{ success: boolean }>(
    "/api/runtime/file-explorer/upload",
    withEndpointHeaders(
      {
        method: "POST",
        body: form
      },
      input.endpointId
    ),
    input.endpointId
  );
}

export async function writeFileExplorerFile(input: {
  endpointId: string;
  path: string;
  content: string;
}): Promise<void> {
  await requestJson<{ success: boolean }>(
    `/api/runtime/file-explorer/file?path=${encodeURIComponent(input.path)}`,
    withEndpointHeaders(
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: input.path, content: input.content })
      },
      input.endpointId
    ),
    input.endpointId
  );
}

export async function deleteFileExplorerPath(
  endpointId: string,
  pathValue: string,
  options: { recursive?: boolean } = {}
): Promise<void> {
  const params = new URLSearchParams({ path: pathValue });
  if (options.recursive) {
    params.set("recursive", "true");
  }
  await requestJson<{ success: boolean }>(
    `/api/runtime/file-explorer/file?${params.toString()}`,
    withEndpointHeaders({ method: "DELETE" }, endpointId),
    endpointId
  );
}

export async function renameFileExplorerPath(input: {
  endpointId: string;
  oldPath: string;
  newPath: string;
}): Promise<void> {
  await requestJson<{ success: boolean }>(
    "/api/runtime/file-explorer/file/rename",
    asJsonBody({ oldPath: input.oldPath, newPath: input.newPath }, input.endpointId),
    input.endpointId
  );
}

export async function createFileExplorerDirectory(
  endpointId: string,
  pathValue: string
): Promise<void> {
  await requestJson<{ success: boolean }>(
    "/api/runtime/file-explorer/directory",
    asJsonBody({ path: pathValue }, endpointId),
    endpointId
  );
}

export async function downloadLabArchive(input: {
  endpointId: string;
  format: LabArchiveFormat;
  path: string;
}): Promise<BinaryDownloadResult> {
  const params = new URLSearchParams({
    format: input.format,
    path: input.path
  });
  const extension = input.format === "zip" ? "zip" : "tar.gz";
  return await requestBlob(
    `/api/runtime/labs/archive?${params.toString()}`,
    `${safeDownloadFallbackName(input.path)}.${extension}`,
    withEndpointHeaders({}, input.endpointId),
    input.endpointId
  );
}

export async function deployLabFromUrl(
  input: RuntimeTargetRequest & {
    topologySourceUrl: string;
    labNameOverride?: string;
  }
): Promise<DeployLabFromUrlResponse> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<DeployLabFromUrlResponse>(
    "/api/runtime/labs/deploy-from-url",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function importTopologyFromUrl(
  input: RuntimeTargetRequest & {
    topologySourceUrl: string;
    labNameOverride?: string;
  }
): Promise<ImportTopologyFromUrlResponse> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<ImportTopologyFromUrlResponse>(
    "/api/runtime/topology-file/import-from-url",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function buildPacketflixCapture(
  input: RuntimeTargetRequest & {
    targets: CaptureTarget[];
    remoteHostname?: string;
  }
): Promise<CapturePacketflixResponse> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<CapturePacketflixResponse>(
    "/api/runtime/capture/packetflix",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function createWiresharkVncSessions(
  input: RuntimeTargetRequest & {
    targets: CaptureTarget[];
    theme?: string;
  }
): Promise<CaptureWiresharkVncCreateResponse> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<CaptureWiresharkVncCreateResponse>(
    "/api/runtime/capture/wireshark-vnc-sessions",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function fetchWiresharkVncSessionReady(
  sessionId: string,
  endpointId?: string
): Promise<CaptureWiresharkVncReadyResponse> {
  return await requestJson<CaptureWiresharkVncReadyResponse>(
    `/api/runtime/capture/wireshark-vnc-sessions/${encodeURIComponent(sessionId)}/ready`,
    withEndpointHeaders({}, endpointId),
    endpointId
  );
}

export async function closeWiresharkVncSession(
  sessionId: string,
  endpointId?: string
): Promise<void> {
  await requestJson<{ success: boolean }>(
    `/api/runtime/capture/wireshark-vnc-sessions/${encodeURIComponent(sessionId)}`,
    withEndpointHeaders({ method: "DELETE" }, endpointId),
    endpointId
  );
}

export async function closeAllWiresharkVncSessions(
  endpointId?: string
): Promise<CaptureCloseAllResponse> {
  return await requestJson<CaptureCloseAllResponse>(
    "/api/runtime/capture/wireshark-vnc-sessions/close-all",
    withEndpointHeaders({ method: "POST" }, endpointId),
    endpointId
  );
}

export async function fetchUiCustomNodes(endpointId?: string): Promise<CustomNodesResponse> {
  return await requestJson<CustomNodesResponse>(
    "/api/runtime/ui/custom-nodes",
    withEndpointHeaders({}, endpointId),
    endpointId
  );
}

export async function saveUiCustomNode(
  data: Record<string, unknown>,
  endpointId?: string
): Promise<CustomNodesResponse> {
  return await requestJson<CustomNodesResponse>(
    "/api/runtime/ui/custom-nodes",
    asJsonBody(data, endpointId),
    endpointId
  );
}

export async function deleteUiCustomNode(
  name: string,
  endpointId?: string
): Promise<CustomNodesResponse> {
  return await requestJson<CustomNodesResponse>(
    `/api/runtime/ui/custom-nodes/${encodeURIComponent(name)}`,
    withEndpointHeaders({ method: "DELETE" }, endpointId),
    endpointId
  );
}

export async function setDefaultUiCustomNode(
  name: string,
  endpointId?: string
): Promise<CustomNodesResponse> {
  return await requestJson<CustomNodesResponse>(
    "/api/runtime/ui/custom-nodes/default",
    asJsonBody({ name }, endpointId),
    endpointId
  );
}

export async function fetchUiIcons(target: RuntimeTargetRequest): Promise<IconListResponse> {
  const endpointId = resolveTargetEndpointId(target);
  return await requestJson<IconListResponse>(
    "/api/runtime/ui/icons/list",
    asJsonBody(target, endpointId),
    endpointId
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < buffer.length; index += chunkSize) {
    binary += String.fromCharCode(...buffer.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function uploadUiIcon(file: File, endpointId?: string): Promise<IconUploadResponse> {
  return await requestJson<IconUploadResponse>(
    "/api/runtime/ui/icons",
    asJsonBody(
      {
        fileName: file.name,
        contentType: file.type || undefined,
        dataBase64: await fileToBase64(file)
      },
      endpointId
    ),
    endpointId
  );
}

export async function deleteUiIcon(iconName: string, endpointId?: string): Promise<void> {
  await requestJson<{ success: boolean }>(
    `/api/runtime/ui/icons/${encodeURIComponent(iconName)}`,
    withEndpointHeaders({ method: "DELETE" }, endpointId),
    endpointId
  );
}

export async function reconcileUiIcons(
  input: RuntimeTargetRequest & {
    usedIcons: string[];
  }
): Promise<void> {
  const endpointId = resolveTargetEndpointId(input);
  await requestJson<{ success: boolean }>(
    "/api/runtime/ui/icons/reconcile",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function fetchNetem(
  input: RuntimeTargetRequest & {
    nodeName: string;
  }
): Promise<NetemShowResult> {
  const endpointId = resolveTargetEndpointId(input);
  return await requestJson<NetemShowResult>(
    "/api/runtime/netem/show",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function setNetem(
  input: RuntimeTargetRequest & {
    nodeName: string;
    interfaceName: string;
    delay?: string;
    jitter?: string;
    loss?: number;
    rate?: number;
    corruption?: number;
  }
): Promise<void> {
  const endpointId = resolveTargetEndpointId(input);
  await requestJson<{ success: boolean }>(
    "/api/runtime/netem/set",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function resetNetem(
  input: RuntimeTargetRequest & {
    nodeName: string;
    interfaceName: string;
  }
): Promise<void> {
  const endpointId = resolveTargetEndpointId(input);
  await requestJson<{ success: boolean }>(
    "/api/runtime/netem/reset",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function createTopologyFile(input: {
  content?: string;
  endpointId?: string;
  fileName: string;
}): Promise<{ success: boolean; topologyRef: TopologyRef }> {
  const endpointId = resolveEndpointId(input);
  return await requestJson<{ success: boolean; topologyRef: TopologyRef }>(
    "/api/runtime/topology-file/create",
    asJsonBody(input, endpointId),
    endpointId
  );
}

export async function deleteTopologyFile(target: RuntimeTargetRequest): Promise<{
  path: string;
  success: boolean;
}> {
  const endpointId = resolveTargetEndpointId(target);
  return await requestJson<{ path: string; success: boolean }>(
    "/api/runtime/topology-file/delete",
    asJsonBody(target, endpointId),
    endpointId
  );
}

export function netemFieldsFromShowResponse(
  response: NetemShowResponse,
  containerName: string
): Record<string, NetemFields> {
  const result: Record<string, NetemFields> = {};
  const entries = response[containerName] ?? [];
  for (const entry of entries) {
    result[entry.interface] = {
      delay: entry.delay ?? "",
      jitter: entry.jitter ?? "",
      loss: Number.isFinite(entry.packet_loss) ? String(entry.packet_loss) : "",
      rate: Number.isFinite(entry.rate) ? String(entry.rate) : "",
      corruption:
        typeof entry.corruption === "number" && Number.isFinite(entry.corruption)
          ? String(entry.corruption)
          : ""
    };
  }
  return result;
}

export function normalizeNetemFields(value: unknown): NetemFields {
  if (!isRecord(value)) {
    return { delay: "", jitter: "", loss: "", rate: "", corruption: "" };
  }
  return {
    delay: typeof value.delay === "string" ? value.delay : "",
    jitter: typeof value.jitter === "string" ? value.jitter : "",
    loss: typeof value.loss === "string" ? value.loss : "",
    rate: typeof value.rate === "string" ? value.rate : "",
    corruption: typeof value.corruption === "string" ? value.corruption : ""
  };
}
