import type {
  CustomIconInfo,
  CustomNodeTemplate,
  CustomNodeTemplateExportIcon,
  TopologyRef,
} from "@containerlab/clab-ui/session";

import {
  getSandboxBackend,
  type SandboxCustomNodes,
  type SandboxFileDocument,
  type SandboxFileExplorerEntry,
} from "./sandboxBackend";

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

export type TerminalProtocol = "ssh" | "shell" | "telnet";

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

export type FileExplorerEntry = SandboxFileExplorerEntry;
export type FileExplorerDocument = SandboxFileDocument;

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

function notAnEditorFeature(): never {
  throw new Error("This action is not available in the topology editor.");
}

function asCustomNodes(result: SandboxCustomNodes): CustomNodesResponse {
  return {
    customNodes: result.customNodes as CustomNodeTemplate[],
    defaultNode: result.defaultNode,
  };
}

function safeDownloadFallbackName(pathValue: string): string {
  const segments = pathValue.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || "download";
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

function iconUploadRequestFromExportIcon(icon: CustomNodeTemplateExportIcon): IconUploadRequest {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(icon.dataUri);
  if (!match) {
    throw new Error(`Icon "${icon.name}" is not a base64 data URI`);
  }
  const expectedContentType = icon.format === "png" ? "image/png" : "image/svg+xml";
  if (match[1].toLowerCase() !== expectedContentType) {
    throw new Error(
      `Icon "${icon.name}" has MIME type ${match[1]}, expected ${expectedContentType}`,
    );
  }
  return {
    fileName: `${icon.name}.${icon.format}`,
    contentType: expectedContentType,
    dataBase64: match[2],
  };
}

export async function inspectAllLabs(_endpointId?: string): Promise<InspectAllLabsResponse> {
  return {};
}

export async function inspectLab(_target: RuntimeTargetRequest): Promise<InspectLabResponse> {
  return [];
}

export async function saveLabConfigs(
  _input: RuntimeTargetRequest & { nodeName?: string },
): Promise<SaveConfigResponse> {
  notAnEditorFeature();
}

export async function controlNodeLifecycle(
  _input: RuntimeTargetRequest & { nodeName: string; action: NodeLifecycleAction },
): Promise<void> {
  notAnEditorFeature();
}

export async function fetchNodeBrowserPorts(
  _input: RuntimeTargetRequest & { nodeName: string },
): Promise<NodeBrowserPortsResponse> {
  notAnEditorFeature();
}

export async function runSshxShareAction(
  _input: RuntimeTargetRequest & { action: ShareToolAction },
): Promise<ShareToolResponse> {
  notAnEditorFeature();
}

export async function runGottyShareAction(
  _input: RuntimeTargetRequest & { action: ShareToolAction; port?: number },
): Promise<ShareToolResponse> {
  notAnEditorFeature();
}

export async function runFcliCommand(
  _input: RuntimeTargetRequest & { command: string },
): Promise<FcliCommandResponse> {
  notAnEditorFeature();
}

export async function generateDrawioGraph(
  _input: RuntimeTargetRequest & { layout: "horizontal" | "vertical" | "interactive"; theme?: string },
): Promise<DrawioGenerateResponse> {
  notAnEditorFeature();
}

export async function fetchRuntimeImages(_endpointId?: string): Promise<RuntimeImagesResponse> {
  return { runtime: "browser", images: [] };
}

export async function pullRuntimeImage(
  _input: RuntimeTargetRequest & { image: string },
): Promise<RuntimeImageActionResponse> {
  notAnEditorFeature();
}

export async function removeRuntimeImage(
  _input: RuntimeTargetRequest & { reference: string; force?: boolean },
): Promise<RuntimeImageActionResponse> {
  notAnEditorFeature();
}

export async function installEdgeShark(_endpointId?: string): Promise<void> {
  notAnEditorFeature();
}

export async function uninstallEdgeShark(_endpointId?: string): Promise<void> {
  notAnEditorFeature();
}

export async function listFileExplorerDirectory(
  _endpointId: string,
  pathValue = "",
): Promise<FileExplorerEntry[]> {
  return getSandboxBackend().listDirectory(pathValue);
}

export async function readFileExplorerFile(
  _endpointId: string,
  pathValue: string,
): Promise<FileExplorerDocument> {
  return await getSandboxBackend().readFile(pathValue);
}

export async function downloadFileExplorerFile(
  _endpointId: string,
  pathValue: string,
): Promise<BinaryDownloadResult> {
  const document = await getSandboxBackend().readFile(pathValue);
  return {
    blob: new Blob([document.content], { type: "text/plain;charset=utf-8" }),
    contentType: "text/plain;charset=utf-8",
    filename: safeDownloadFallbackName(pathValue),
  };
}

export async function uploadFileExplorerFile(input: {
  endpointId: string;
  file?: File;
  files?: readonly File[];
  path: string;
  targetKind?: "directory" | "file";
}): Promise<void> {
  const files = input.files ?? (input.file ? [input.file] : []);
  const uploaded = await Promise.all(
    files.map(async (file) => ({ name: file.name, content: await file.text() })),
  );
  await getSandboxBackend().uploadFiles(input.path, uploaded, input.targetKind ?? "directory");
}

export async function writeFileExplorerFile(input: {
  endpointId: string;
  path: string;
  content: string;
}): Promise<void> {
  await getSandboxBackend().writeFile(input.path, input.content);
}

export async function deleteFileExplorerPath(
  _endpointId: string,
  pathValue: string,
  options: { recursive?: boolean } = {},
): Promise<void> {
  await getSandboxBackend().deletePath(pathValue, options.recursive === true);
}

export async function renameFileExplorerPath(input: {
  endpointId: string;
  oldPath: string;
  newPath: string;
}): Promise<void> {
  await getSandboxBackend().renamePath(input.oldPath, input.newPath);
}

export async function createFileExplorerDirectory(
  _endpointId: string,
  pathValue: string,
): Promise<void> {
  getSandboxBackend().createDirectory(pathValue);
}

export async function downloadLabArchive(_input: {
  endpointId: string;
  format: LabArchiveFormat;
  path: string;
}): Promise<BinaryDownloadResult> {
  notAnEditorFeature();
}

export async function deployLabFromUrl(
  _input: RuntimeTargetRequest & { topologySourceUrl: string; labNameOverride?: string },
): Promise<DeployLabFromUrlResponse> {
  notAnEditorFeature();
}

export async function importTopologyFromUrl(
  _input: RuntimeTargetRequest & { topologySourceUrl: string; labNameOverride?: string },
): Promise<ImportTopologyFromUrlResponse> {
  notAnEditorFeature();
}

export async function buildPacketflixCapture(
  _input: RuntimeTargetRequest & { targets: CaptureTarget[]; remoteHostname?: string },
): Promise<CapturePacketflixResponse> {
  notAnEditorFeature();
}

export async function createWiresharkVncSessions(
  _input: RuntimeTargetRequest & { targets: CaptureTarget[]; theme?: string },
): Promise<CaptureWiresharkVncCreateResponse> {
  notAnEditorFeature();
}

export async function closeAllWiresharkVncSessions(
  _endpointId?: string,
): Promise<CaptureCloseAllResponse> {
  notAnEditorFeature();
}

export async function fetchUiCustomNodes(_endpointId?: string): Promise<CustomNodesResponse> {
  return asCustomNodes(getSandboxBackend().getCustomNodes());
}

export async function saveUiCustomNode(
  data: Record<string, unknown>,
  _endpointId?: string,
): Promise<CustomNodesResponse> {
  return asCustomNodes(getSandboxBackend().saveCustomNode(data));
}

export async function replaceUiCustomNodes(
  customNodes: CustomNodeTemplate[],
  _endpointId?: string,
): Promise<CustomNodesResponse> {
  return asCustomNodes(getSandboxBackend().replaceCustomNodes(customNodes));
}

export async function deleteUiCustomNode(
  name: string,
  _endpointId?: string,
): Promise<CustomNodesResponse> {
  return asCustomNodes(getSandboxBackend().deleteCustomNode(name));
}

export async function setDefaultUiCustomNode(
  name: string,
  _endpointId?: string,
): Promise<CustomNodesResponse> {
  return asCustomNodes(getSandboxBackend().setDefaultCustomNode(name));
}

export async function fetchUiIcons(_target: RuntimeTargetRequest): Promise<IconListResponse> {
  return { icons: getSandboxBackend().listIcons() };
}

export async function uploadUiIcon(file: File, _endpointId?: string): Promise<IconUploadResponse> {
  const result = getSandboxBackend().uploadIcon({
    fileName: file.name,
    contentType: file.type || undefined,
    dataBase64: await fileToBase64(file),
  });
  return { success: true, iconName: result.iconName };
}

export async function deleteUiIcon(iconName: string, _endpointId?: string): Promise<void> {
  getSandboxBackend().deleteIcon(iconName);
}

export async function importUiIcons(
  icons: CustomNodeTemplateExportIcon[],
  _endpointId?: string,
): Promise<IconImportResponse> {
  const backend = getSandboxBackend();
  const renamed: Record<string, string> = {};
  for (const icon of icons) {
    const request = iconUploadRequestFromExportIcon(icon);
    backend.deleteIcon(icon.name);
    const response = backend.uploadIcon(request);
    if (response.iconName !== icon.name) {
      renamed[icon.name] = response.iconName;
    }
  }
  return { imported: icons.length, renamed };
}

export async function reconcileUiIcons(
  _input: RuntimeTargetRequest & { usedIcons: string[] },
): Promise<void> {}

export async function createTopologyFile(input: {
  content?: string;
  endpointId?: string;
  fileName: string;
}): Promise<{ success: boolean; topologyRef: TopologyRef }> {
  const topologyRef = await getSandboxBackend().createTopologyFile(input.fileName, input.content);
  return { success: true, topologyRef };
}

export async function deleteTopologyFile(target: RuntimeTargetRequest): Promise<{
  path: string;
  success: boolean;
}> {
  if (!target.topologyRef) {
    throw new Error("Missing topologyRef");
  }
  const path = await getSandboxBackend().deleteTopologyFile(target.topologyRef);
  return { path, success: true };
}
