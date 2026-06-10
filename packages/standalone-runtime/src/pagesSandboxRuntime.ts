import {
  TopologySessionCore,
  createRuntimeContainerDataProvider,
  type FileSystemAdapter,
  type TopologyHostCommand,
  type TopologyHostResponseMessage,
  type TopologyRef,
  type TopologySnapshot,
} from "@srl-labs/clab-ui/session";

import type { EndpointHealthMetrics } from "./endpointHealth";
import {
  buildStandaloneTopologyRefFromPath,
  normalizePathValue,
  safeFilename,
  stripTopologySuffix,
  type TopologyFileEntry,
} from "./standaloneHostShared";
import { PAGES_SANDBOX_ENDPOINT_ID } from "./runtimeMode";

const SANDBOX_ENDPOINT_ID = PAGES_SANDBOX_ENDPOINT_ID;
const SANDBOX_STORAGE_FILES = "clab-pages-sandbox-files-v1";
const SANDBOX_STORAGE_DIRECTORIES = "clab-pages-sandbox-directories-v1";
const SANDBOX_STORAGE_CUSTOM_NODES = "clab-pages-sandbox-custom-nodes-v1";
const SANDBOX_STORAGE_DEFAULT_NODE = "clab-pages-sandbox-default-node-v1";
const SANDBOX_STORAGE_ICONS = "clab-pages-sandbox-icons-v1";

const DEFAULT_PAGES_CUSTOM_NODES = [
  {
    name: "SRLinux Latest",
    kind: "nokia_srlinux",
    type: "ixr-d1",
    image: "ghcr.io/nokia/srlinux:latest",
    icon: "router",
    baseName: "srl",
    interfacePattern: "e1-{n}",
    setDefault: true,
  },
  {
    name: "Network Multitool",
    kind: "linux",
    image: "ghcr.io/srl-labs/network-multitool:latest",
    icon: "client",
    baseName: "client",
    interfacePattern: "eth{n}",
    setDefault: false,
  },
] satisfies Array<Record<string, unknown> & { kind: string; name: string }>;

interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

interface SandboxEndpoint {
  connected: boolean;
  id: string;
  label: string;
  sessionDuration: string;
  status: "connected";
  url: string;
  username: string;
}

interface RuntimeContainerPayload {
  name: string;
  nodeName: string;
  labName: string;
  state: string;
  kind: string;
  image: string;
  ipv4Address: string;
  ipv6Address: string;
  interfaces?: unknown[];
}

interface TopologySessionRecord {
  endpointId: string;
  host: TopologySessionCore;
  sessionId: string;
  topologyRef: TopologyRef;
}

interface TopologySessionRequest {
  deploymentState?: "deployed" | "undeployed" | "unknown";
  mode?: "edit" | "view";
  runtimeContainers?: RuntimeContainerPayload[];
  sessionId?: string;
  topologyRef?: TopologyRef;
}

interface TopologyCommandRequest extends TopologySessionRequest {
  baseRevision?: number;
  command?: TopologyHostCommand;
}

interface FileExplorerEntry {
  endpointId: string;
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  hasChildren?: boolean;
  labName?: string;
  deploymentState?: string;
  topologyRef?: TopologyRef;
}

interface IconInfo {
  name: string;
  source: "global" | "workspace";
  dataUri: string;
  format: "svg" | "png";
}

let installed = false;

const sandboxEndpoint: SandboxEndpoint = {
  id: SANDBOX_ENDPOINT_ID,
  url: "local://containerlab-pages",
  label: "Local workspace",
  username: "local",
  sessionDuration: "24h",
  status: "connected",
  connected: true,
};

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function browserStorage(): StorageLike {
  try {
    const storage = globalThis.localStorage;
    const probeKey = "clab-pages-sandbox-probe";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return new MemoryStorage();
  }
}

function readJson<T>(storage: StorageLike, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(storage: StorageLike, key: string, value: unknown): void {
  storage.setItem(key, JSON.stringify(value));
}

function normalizeSandboxPath(pathValue: string): string {
  return normalizePathValue(pathValue).replace(/^\/+/, "");
}

function dirname(pathValue: string): string {
  const normalized = normalizeSandboxPath(pathValue);
  const index = normalized.lastIndexOf("/");
  if (index < 0) {
    return ".";
  }
  if (index === 0) {
    return "";
  }
  return normalized.slice(0, index);
}

function basename(pathValue: string): string {
  const normalized = normalizeSandboxPath(pathValue);
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function joinPath(...segments: string[]): string {
  const joined = segments
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
  return normalizeSandboxPath(joined);
}

function createNotFoundError(pathValue: string): Error & { code?: string } {
  const error = new Error(`ENOENT: no such file ${pathValue}`) as Error & { code?: string };
  error.code = "ENOENT";
  return error;
}

function defaultTopologyContent(fileName: string): string {
  const labName = stripTopologySuffix(safeFilename(fileName)) || "new-lab";
  return [
    `name: ${labName}`,
    "topology:",
    "  nodes: {}",
    "",
  ].join("\n");
}

export class BrowserSandboxFileSystem implements FileSystemAdapter {
  private readonly storage: StorageLike;

  constructor(storage: StorageLike = browserStorage()) {
    this.storage = storage;
  }

  readFiles(): Record<string, string> {
    return readJson<Record<string, string>>(this.storage, SANDBOX_STORAGE_FILES, {});
  }

  writeFiles(files: Record<string, string>): void {
    writeJson(this.storage, SANDBOX_STORAGE_FILES, files);
  }

  readDirectories(): Set<string> {
    return new Set(readJson<string[]>(this.storage, SANDBOX_STORAGE_DIRECTORIES, []));
  }

  writeDirectories(directories: Set<string>): void {
    writeJson(this.storage, SANDBOX_STORAGE_DIRECTORIES, [...directories].sort());
  }

  async readFile(filePath: string): Promise<string> {
    const normalized = normalizeSandboxPath(filePath);
    const files = this.readFiles();
    const content = files[normalized];
    if (content === undefined) {
      throw createNotFoundError(normalized);
    }
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const normalized = normalizeSandboxPath(filePath);
    const files = this.readFiles();
    files[normalized] = content;
    this.writeFiles(files);

    const parent = dirname(normalized);
    if (parent && parent !== ".") {
      const directories = this.readDirectories();
      addDirectoryAncestors(directories, parent);
      this.writeDirectories(directories);
    }
  }

  async unlink(filePath: string): Promise<void> {
    const normalized = normalizeSandboxPath(filePath);
    const files = this.readFiles();
    delete files[normalized];
    this.writeFiles(files);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldNormalized = normalizeSandboxPath(oldPath);
    const newNormalized = normalizeSandboxPath(newPath);
    const files = this.readFiles();
    const content = files[oldNormalized];
    if (content === undefined) {
      throw createNotFoundError(oldNormalized);
    }
    delete files[oldNormalized];
    files[newNormalized] = content;
    this.writeFiles(files);

    const parent = dirname(newNormalized);
    if (parent && parent !== ".") {
      const directories = this.readDirectories();
      addDirectoryAncestors(directories, parent);
      this.writeDirectories(directories);
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const normalized = normalizeSandboxPath(filePath);
    return this.readFiles()[normalized] !== undefined;
  }

  dirname(filePath: string): string {
    return dirname(filePath);
  }

  basename(filePath: string): string {
    return basename(filePath);
  }

  join(...segments: string[]): string {
    return joinPath(...segments);
  }
}

function addDirectoryAncestors(directories: Set<string>, pathValue: string): void {
  const segments = normalizeSandboxPath(pathValue).split("/").filter(Boolean);
  for (let index = 1; index <= segments.length; index += 1) {
    directories.add(segments.slice(0, index).join("/"));
  }
}

function isTopologyPath(pathValue: string): boolean {
  return /\.clab\.ya?ml$/i.test(pathValue) && !/\.annotations\.json$/i.test(pathValue);
}

function topologyFileEntry(pathValue: string, content: string): TopologyFileEntry {
  const topologyRef = buildStandaloneTopologyRefFromPath(
    pathValue,
    labNameFromYaml(content) ?? stripTopologySuffix(safeFilename(pathValue)),
    SANDBOX_ENDPOINT_ID,
  );
  return {
    endpointId: SANDBOX_ENDPOINT_ID,
    filename: safeFilename(pathValue),
    path: pathValue,
    hasAnnotations: false,
    labName: topologyRef.labName,
    deploymentState: "undeployed",
    topologyRef,
  };
}

function labNameFromYaml(content: string): string | undefined {
  const match = /^name:\s*["']?([^"'\n#]+)["']?\s*(?:#.*)?$/m.exec(content);
  return match?.[1]?.trim() || undefined;
}

function topologyFiles(fs: BrowserSandboxFileSystem): TopologyFileEntry[] {
  return Object.entries(fs.readFiles())
    .filter(([pathValue]) => isTopologyPath(pathValue))
    .map(([pathValue, content]) => topologyFileEntry(pathValue, content))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function fileExplorerEntries(
  fs: BrowserSandboxFileSystem,
  endpointId: string,
  parentPath: string,
): FileExplorerEntry[] {
  const parent = normalizeSandboxPath(parentPath);
  const files = fs.readFiles();
  const directories = fs.readDirectories();
  const childDirectories = new Set<string>();
  const entries: FileExplorerEntry[] = [];

  const maybeAddDirectory = (pathValue: string): void => {
    const normalized = normalizeSandboxPath(pathValue);
    if (!normalized || normalized === parent) {
      return;
    }
    const directParent = dirname(normalized);
    if ((parent || ".") === (directParent || ".")) {
      childDirectories.add(normalized);
      return;
    }
    if (parent && normalized.startsWith(`${parent}/`)) {
      const childName = normalized.slice(parent.length + 1).split("/")[0];
      if (childName) {
        childDirectories.add(joinPath(parent, childName));
      }
    } else if (!parent) {
      const childName = normalized.split("/")[0];
      if (childName) {
        childDirectories.add(childName);
      }
    }
  };

  for (const directoryPath of directories) {
    maybeAddDirectory(directoryPath);
  }

  for (const [pathValue, content] of Object.entries(files)) {
    const fileParent = dirname(pathValue);
    if ((parent || ".") === (fileParent || ".")) {
      const topologyRef = isTopologyPath(pathValue)
        ? topologyFileEntry(pathValue, content).topologyRef
        : undefined;
      entries.push({
        endpointId,
        name: safeFilename(pathValue),
        path: pathValue,
        kind: "file",
        size: content.length,
        labName: topologyRef?.labName,
        deploymentState: topologyRef ? "undeployed" : undefined,
        topologyRef,
      });
      continue;
    }
    maybeAddDirectory(fileParent);
  }

  for (const directoryPath of childDirectories) {
    entries.push({
      endpointId,
      name: safeFilename(directoryPath),
      path: directoryPath,
      kind: "directory",
      hasChildren: hasDirectoryChildren(files, directories, directoryPath),
    });
  }

  return entries.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function hasDirectoryChildren(
  files: Record<string, string>,
  directories: Set<string>,
  directoryPath: string,
): boolean {
  const prefix = `${normalizeSandboxPath(directoryPath)}/`;
  return (
    Object.keys(files).some((pathValue) => pathValue.startsWith(prefix)) ||
    [...directories].some((pathValue) => pathValue.startsWith(prefix))
  );
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

function notAvailable(message: string): Response {
  return jsonResponse({ error: message }, { status: 501, statusText: "Not Implemented" });
}

function notFound(message: string): Response {
  return jsonResponse({ error: message }, { status: 404, statusText: "Not Found" });
}

function successResponse(body: unknown = { success: true }): Response {
  return jsonResponse(body);
}

async function requestPayload(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const body = init?.body;
  if (body instanceof FormData) {
    return body;
  }
  if (typeof body === "string") {
    return JSON.parse(body || "{}") as unknown;
  }
  if (input instanceof Request) {
    const contentType = input.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      return await input.clone().formData();
    }
    return await input.clone().json().catch(() => ({}));
  }
  return {};
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(String(input), window.location.origin);
}

function endpointIdFromHeaders(input: RequestInfo | URL, init?: RequestInit): string | undefined {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  return headers.get("x-endpoint-id") ?? undefined;
}

function firstCustomNodeName(customNodes: unknown[]): string {
  const defaultTemplate = customNodes.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { name?: unknown }).name === "string" &&
      (entry as { name: string }).name.trim().length > 0 &&
      (entry as { setDefault?: unknown }).setDefault === true,
  );
  if (defaultTemplate) {
    return (defaultTemplate as { name: string }).name;
  }

  const first = customNodes.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { name?: unknown }).name === "string" &&
      (entry as { name: string }).name.trim().length > 0,
  );
  return first ? (first as { name: string }).name : "";
}

function currentCustomNodes(storage: StorageLike): { customNodes: unknown[]; defaultNode: string } {
  const hasStoredCustomNodes = storage.getItem(SANDBOX_STORAGE_CUSTOM_NODES) !== null;
  const storedCustomNodes = hasStoredCustomNodes
    ? readJson<unknown[]>(storage, SANDBOX_STORAGE_CUSTOM_NODES, [...DEFAULT_PAGES_CUSTOM_NODES])
    : [...DEFAULT_PAGES_CUSTOM_NODES];
  const customNodes = storedCustomNodes.length > 0
    ? storedCustomNodes
    : [...DEFAULT_PAGES_CUSTOM_NODES];

  return {
    customNodes,
    defaultNode: storage.getItem(SANDBOX_STORAGE_DEFAULT_NODE) ?? firstCustomNodeName(customNodes),
  };
}

function writeCustomNodes(
  storage: StorageLike,
  customNodes: unknown[],
  defaultNode: string,
): { customNodes: unknown[]; defaultNode: string } {
  writeJson(storage, SANDBOX_STORAGE_CUSTOM_NODES, customNodes);
  storage.setItem(SANDBOX_STORAGE_DEFAULT_NODE, defaultNode);
  return { customNodes, defaultNode };
}

function currentIcons(storage: StorageLike): IconInfo[] {
  return readJson<IconInfo[]>(storage, SANDBOX_STORAGE_ICONS, []);
}

function writeIcons(storage: StorageLike, icons: IconInfo[]): void {
  writeJson(storage, SANDBOX_STORAGE_ICONS, icons);
}

function iconInfoFromUploadPayload(payload: {
  fileName?: unknown;
  contentType?: unknown;
  dataBase64?: unknown;
}): IconInfo {
  const fileName = typeof payload.fileName === "string" ? safeFilename(payload.fileName) : "icon.svg";
  const dotIndex = fileName.lastIndexOf(".");
  const rawName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "svg";
  const format = ext === "png" ? "png" : "svg";
  let contentType = format === "png" ? "image/png" : "image/svg+xml";
  if (typeof payload.contentType === "string" && payload.contentType.length > 0) {
    contentType = payload.contentType;
  }
  const dataBase64 = typeof payload.dataBase64 === "string" ? payload.dataBase64 : "";

  return {
    name: rawName || "icon",
    source: "global",
    dataUri: `data:${contentType};base64,${dataBase64}`,
    format,
  };
}

function fakeHealthMetrics(): EndpointHealthMetrics {
  return {
    serverInfo: {
      version: "browser sandbox",
      uptime: "local",
      startTime: "browser",
    },
    metrics: {
      cpu: { usagePercent: 0, numCPU: 1 },
      mem: { totalMem: 1, usedMem: 0, availableMem: 1, usagePercent: 0 },
      disk: { path: "localStorage", totalDisk: 1, usedDisk: 0, freeDisk: 1, usagePercent: 0 },
    },
  };
}

function createEmptySnapshot(
  mode: "edit" | "view",
  deploymentState: "deployed" | "undeployed" | "unknown",
): TopologySnapshot {
  return {
    revision: 1,
    nodes: [],
    edges: [],
    annotations: {},
    yamlFileName: "",
    annotationsFileName: "",
    yamlContent: "",
    annotationsContent: "{}",
    labName: "",
    mode,
    deploymentState,
    canUndo: false,
    canRedo: false,
  };
}

function updateSessionContext(
  session: TopologySessionRecord,
  request: TopologySessionRequest,
): void {
  const deploymentState = request.deploymentState ?? "undeployed";
  const mode = request.mode ?? (deploymentState === "deployed" ? "view" : "edit");
  const containerDataProvider = createRuntimeContainerDataProvider(
    (request.runtimeContainers ?? []) as Parameters<typeof createRuntimeContainerDataProvider>[0],
  );
  session.host.updateContext({ mode, deploymentState, containerDataProvider });
}

class PagesSandboxApi {
  private readonly fs: BrowserSandboxFileSystem;
  private readonly sessions = new Map<string, TopologySessionRecord>();
  private readonly storage: StorageLike;

  constructor(storage: StorageLike = browserStorage()) {
    this.storage = storage;
    this.fs = new BrowserSandboxFileSystem(storage);
  }

  shouldHandle(url: URL): boolean {
    return url.origin === window.location.origin &&
      (url.pathname === "/files" ||
        url.pathname.startsWith("/auth/") ||
        url.pathname.startsWith("/api/"));
  }

  async handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const path = url.pathname;

    if (path === "/api/config" && method === "GET") {
      return successResponse({ defaultClabApiUrl: "", endpoints: [sandboxEndpoint] });
    }

    if (path === "/auth/me" && method === "GET") {
      return successResponse({ authenticated: true, endpoints: [sandboxEndpoint] });
    }

    if (path === "/auth/endpoints" && method === "GET") {
      return successResponse({ endpoints: [sandboxEndpoint] });
    }

    if (path === "/auth/endpoints/add" && method === "POST") {
      return successResponse(sandboxEndpoint);
    }

    if (/^\/auth\/endpoints\/[^/]+\/(?:reconnect|preferences|metrics)$/.test(path)) {
      if (path.endsWith("/metrics")) {
        return successResponse(fakeHealthMetrics());
      }
      return successResponse(sandboxEndpoint);
    }

    if (/^\/auth\/endpoints\/[^/]+$/.test(path)) {
      return method === "DELETE" ? successResponse() : successResponse(sandboxEndpoint);
    }

    if (path === "/auth/logout" && method === "POST") {
      return successResponse();
    }

    if (path === "/files" && method === "GET") {
      return successResponse(topologyFiles(this.fs));
    }

    if (path === "/api/topology/sessions" && method === "POST") {
      return this.createTopologySession(await requestPayload(input, init));
    }

    if (path.startsWith("/api/topology/sessions/") && method === "DELETE") {
      const sessionId = decodeURIComponent(path.slice("/api/topology/sessions/".length));
      this.sessions.get(sessionId)?.host.dispose();
      this.sessions.delete(sessionId);
      return successResponse();
    }

    if (path === "/api/topology/snapshot" && method === "POST") {
      return await this.topologySnapshot(await requestPayload(input, init));
    }

    if (path === "/api/topology/command" && method === "POST") {
      return await this.topologyCommand(await requestPayload(input, init));
    }

    if (path === "/api/runtime/inspect/all") {
      return successResponse({});
    }

    if (path === "/api/runtime/inspect/lab") {
      return successResponse([]);
    }

    if (path === "/api/runtime/file-explorer/tree" && method === "GET") {
      const endpointId = endpointIdFromHeaders(input, init) ?? SANDBOX_ENDPOINT_ID;
      return successResponse(fileExplorerEntries(this.fs, endpointId, url.searchParams.get("path") ?? ""));
    }

    if (path === "/api/runtime/file-explorer/file" && method === "GET") {
      const endpointId = endpointIdFromHeaders(input, init) ?? SANDBOX_ENDPOINT_ID;
      const pathValue = normalizeSandboxPath(url.searchParams.get("path") ?? "");
      return successResponse({
        endpointId,
        path: pathValue,
        content: await this.fs.readFile(pathValue),
      });
    }

    if (path === "/api/runtime/file-explorer/file" && method === "PUT") {
      const payload = await requestPayload(input, init) as { content?: unknown; path?: unknown };
      const pathValue = normalizeSandboxPath(String(payload.path ?? url.searchParams.get("path") ?? ""));
      await this.fs.writeFile(pathValue, typeof payload.content === "string" ? payload.content : "");
      return successResponse();
    }

    if (path === "/api/runtime/file-explorer/file" && method === "DELETE") {
      const pathValue = normalizeSandboxPath(url.searchParams.get("path") ?? "");
      await this.deletePath(pathValue, url.searchParams.get("recursive") === "true");
      return successResponse();
    }

    if (path === "/api/runtime/file-explorer/file/rename" && method === "POST") {
      const payload = await requestPayload(input, init) as { oldPath?: unknown; newPath?: unknown };
      await this.renamePath(
        normalizeSandboxPath(String(payload.oldPath ?? "")),
        normalizeSandboxPath(String(payload.newPath ?? "")),
      );
      return successResponse();
    }

    if (path === "/api/runtime/file-explorer/directory" && method === "POST") {
      const payload = await requestPayload(input, init) as { path?: unknown };
      const directories = this.fs.readDirectories();
      addDirectoryAncestors(directories, normalizeSandboxPath(String(payload.path ?? "")));
      this.fs.writeDirectories(directories);
      return successResponse();
    }

    if (path === "/api/runtime/file-explorer/download" && method === "GET") {
      const pathValue = normalizeSandboxPath(url.searchParams.get("path") ?? "");
      const content = await this.fs.readFile(pathValue);
      return textResponse(content, {
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
          "Content-Disposition": `attachment; filename="${safeFilename(pathValue)}"`,
        },
      });
    }

    if (path === "/api/runtime/file-explorer/upload" && method === "POST") {
      return await this.uploadFile(input, init);
    }

    if (path === "/api/runtime/topology-file/create" && method === "POST") {
      return await this.createTopologyFile(await requestPayload(input, init));
    }

    if (path === "/api/runtime/topology-file/delete" && method === "POST") {
      const payload = await requestPayload(input, init) as { topologyRef?: TopologyRef };
      const pathValue = normalizeSandboxPath(payload.topologyRef?.yamlPath ?? "");
      await this.fs.unlink(pathValue);
      await this.fs.unlink(`${pathValue}.annotations.json`);
      return successResponse({ success: true, path: pathValue });
    }

    if (path === "/api/runtime/ui/custom-nodes" && method === "GET") {
      return successResponse(currentCustomNodes(this.storage));
    }

    if (path === "/api/runtime/ui/custom-nodes" && method === "PUT") {
      const payload = await requestPayload(input, init) as { customNodes?: unknown };
      const customNodes = Array.isArray(payload.customNodes) ? payload.customNodes : [];
      return successResponse(writeCustomNodes(
        this.storage,
        customNodes,
        firstCustomNodeName(customNodes),
      ));
    }

    if (path === "/api/runtime/ui/custom-nodes" && method === "POST") {
      const payload = await requestPayload(input, init) as Record<string, unknown>;
      const current = currentCustomNodes(this.storage);
      const name = typeof payload.name === "string" ? payload.name : "";
      const customNodes = name
        ? [...current.customNodes.filter((entry) => !sameCustomNodeName(entry, name)), payload]
        : current.customNodes;
      return successResponse(writeCustomNodes(this.storage, customNodes, current.defaultNode));
    }

    if (path.startsWith("/api/runtime/ui/custom-nodes/") && method === "DELETE") {
      const name = decodeURIComponent(path.slice("/api/runtime/ui/custom-nodes/".length));
      const current = currentCustomNodes(this.storage);
      return successResponse(writeCustomNodes(
        this.storage,
        current.customNodes.filter((entry) => !sameCustomNodeName(entry, name)),
        current.defaultNode === name ? "" : current.defaultNode,
      ));
    }

    if (path === "/api/runtime/ui/custom-nodes/default" && method === "POST") {
      const payload = await requestPayload(input, init) as { name?: unknown };
      const current = currentCustomNodes(this.storage);
      return successResponse(writeCustomNodes(
        this.storage,
        current.customNodes,
        typeof payload.name === "string" ? payload.name : "",
      ));
    }

    if (path === "/api/runtime/ui/icons/list") {
      return successResponse({ icons: currentIcons(this.storage) });
    }

    if (path === "/api/runtime/ui/icons" && method === "POST") {
      const payload = await requestPayload(input, init) as { fileName?: unknown; dataBase64?: unknown };
      const uploadedIcon = iconInfoFromUploadPayload(payload);
      const icons = currentIcons(this.storage).filter((icon) => icon.name !== uploadedIcon.name);
      icons.push(uploadedIcon);
      writeIcons(this.storage, icons);
      return successResponse({ success: true, iconName: uploadedIcon.name });
    }

    if (path.startsWith("/api/runtime/ui/icons/") && method === "DELETE") {
      const iconName = decodeURIComponent(path.slice("/api/runtime/ui/icons/".length));
      writeIcons(this.storage, currentIcons(this.storage).filter((icon) => icon.name !== iconName));
      return successResponse();
    }

    if (path === "/api/runtime/ui/icons/reconcile") {
      return successResponse();
    }

    if (path === "/api/runtime/images") {
      return successResponse({ runtime: "browser", images: [] });
    }

    if (path === "/api/runtime/version") {
      return successResponse({ versionInfo: "containerlab browser sandbox" });
    }

    if (path === "/api/runtime/version/check") {
      return successResponse({ checkResult: "Updates are not checked in the browser sandbox." });
    }

    if (path === "/api/runtime/capture/edgeshark/status") {
      return successResponse({ running: false, packetflixPort: 0, runtime: "browser" });
    }

    if (path === "/api/runtime/popular-repos") {
      return successResponse({ items: [] });
    }

    if (path.startsWith("/api/lab/") || path.startsWith("/api/runtime/")) {
      return notAvailable("This action is not available in the browser sandbox.");
    }

    return notFound("No browser sandbox handler matched this request.");
  }

  private createTopologySession(payload: unknown): Response {
    const request = payload as TopologySessionRequest;
    if (!request.topologyRef) {
      return jsonResponse({ error: "Missing topologyRef" }, { status: 400 });
    }

    const topologyRef = buildStandaloneTopologyRefFromPath(
      request.topologyRef.yamlPath,
      request.topologyRef.labName,
      SANDBOX_ENDPOINT_ID,
    );
    const deploymentState = request.deploymentState ?? "undeployed";
    const mode = request.mode ?? (deploymentState === "deployed" ? "view" : "edit");
    const host = new TopologySessionCore({
      fs: this.fs,
      yamlFilePath: topologyRef.yamlPath,
      mode,
      deploymentState,
      containerDataProvider: createRuntimeContainerDataProvider([]),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: console.error,
      },
    });
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      endpointId: SANDBOX_ENDPOINT_ID,
      host,
      sessionId,
      topologyRef,
    });
    return successResponse({ sessionId, topologyRef });
  }

  private async topologySnapshot(payload: unknown): Promise<Response> {
    const request = payload as TopologySessionRequest;
    const sessionId = request.sessionId?.trim() ?? "";
    if (!sessionId) {
      return successResponse({
        snapshot: createEmptySnapshot(
          request.mode ?? "edit",
          request.deploymentState ?? "unknown",
        ),
      });
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      return notFound("Topology session not found");
    }
    updateSessionContext(session, request);
    const snapshot = request.deploymentState === "deployed"
      ? await session.host.onExternalChange()
      : await session.host.getSnapshot();
    return successResponse({ snapshot });
  }

  private async topologyCommand(payload: unknown): Promise<Response> {
    const request = payload as TopologyCommandRequest;
    const sessionId = request.sessionId?.trim() ?? "";
    if (!sessionId || !request.command) {
      return jsonResponse(
        { type: "topology-host:error", error: "Missing sessionId or command" },
        { status: 400 },
      );
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      return jsonResponse(
        { type: "topology-host:error", error: "Topology session not found" },
        { status: 404 },
      );
    }
    updateSessionContext(session, request);
    const response: TopologyHostResponseMessage = await session.host.applyCommand(
      request.command,
      request.baseRevision ?? 1,
    );
    return successResponse(response);
  }

  private async createTopologyFile(payload: unknown): Promise<Response> {
    const request = payload as { content?: unknown; fileName?: unknown };
    const fileName = normalizeSandboxPath(String(request.fileName ?? "new-lab.clab.yml"));
    if (!fileName) {
      return jsonResponse({ error: "Missing fileName" }, { status: 400 });
    }
    if (await this.fs.exists(fileName)) {
      return jsonResponse({ error: `${fileName} already exists` }, { status: 409 });
    }
    const content = typeof request.content === "string"
      ? request.content
      : defaultTopologyContent(fileName);
    await this.fs.writeFile(fileName, content);
    return successResponse({
      success: true,
      topologyRef: topologyFileEntry(fileName, content).topologyRef,
    });
  }

  private async deletePath(pathValue: string, recursive: boolean): Promise<void> {
    if (recursive) {
      const files = this.fs.readFiles();
      for (const key of Object.keys(files)) {
        if (key === pathValue || key.startsWith(`${pathValue}/`)) {
          delete files[key];
        }
      }
      this.fs.writeFiles(files);
      const directories = this.fs.readDirectories();
      const directoriesToDelete: string[] = [];
      for (const directoryPath of directories) {
        if (directoryPath === pathValue || directoryPath.startsWith(`${pathValue}/`)) {
          directoriesToDelete.push(directoryPath);
        }
      }
      for (const directoryPath of directoriesToDelete) {
        directories.delete(directoryPath);
      }
      this.fs.writeDirectories(directories);
      return;
    }
    await this.fs.unlink(pathValue);
  }

  private async renamePath(oldPath: string, newPath: string): Promise<void> {
    if (await this.fs.exists(oldPath)) {
      await this.fs.rename(oldPath, newPath);
      return;
    }

    const files = this.fs.readFiles();
    const prefix = `${oldPath}/`;
    let changed = false;
    for (const [pathValue, content] of Object.entries(files)) {
      if (!pathValue.startsWith(prefix)) {
        continue;
      }
      delete files[pathValue];
      files[`${newPath}/${pathValue.slice(prefix.length)}`] = content;
      changed = true;
    }
    if (changed) {
      this.fs.writeFiles(files);
    }
  }

  private async uploadFile(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const payload = await requestPayload(input, init);
    if (!(payload instanceof FormData)) {
      return jsonResponse({ error: "Upload payload must be multipart form data" }, { status: 400 });
    }
    const targetPath = normalizeSandboxPath(String(payload.get("path") ?? ""));
    const targetKind = String(payload.get("targetKind") ?? "directory");
    const files = payload.getAll("file").filter((entry): entry is File => entry instanceof File);
    if (files.length === 0) {
      return jsonResponse({ error: "Select at least one file to upload." }, { status: 400 });
    }
    if (targetKind === "file") {
      await this.fs.writeFile(targetPath, await files[0].text());
      return successResponse();
    }
    for (const file of files) {
      await this.fs.writeFile(joinPath(targetPath, file.name), await file.text());
    }
    return successResponse();
  }
}

function sameCustomNodeName(entry: unknown, name: string): boolean {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as { name?: unknown }).name === "string" &&
    (entry as { name: string }).name === name
  );
}

function shouldMockEventSource(url: string | URL): boolean {
  const parsed = new URL(String(url), window.location.origin);
  return parsed.origin === window.location.origin &&
    (
      parsed.pathname === "/api/events" ||
      parsed.pathname === "/api/topology/events" ||
      parsed.pathname === "/api/runtime/file-explorer/events"
    );
}

function installEventSourceShim(): void {
  const NativeEventSource = window.EventSource;

  class PagesSandboxEventSource extends EventTarget {
    static readonly CLOSED = 2;
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;

    onerror: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: ((event: Event) => void) | null = null;
    readyState = PagesSandboxEventSource.CONNECTING;
    readonly url: string = "";
    readonly withCredentials: boolean = false;

    constructor(url: string | URL, init?: EventSourceInit) {
      super();
      if (!shouldMockEventSource(url)) {
        return new NativeEventSource(url, init) as unknown as PagesSandboxEventSource;
      }
      this.url = String(url);
      this.withCredentials = init?.withCredentials ?? false;
      window.setTimeout(() => {
        if (this.readyState === PagesSandboxEventSource.CLOSED) {
          return;
        }
        this.readyState = PagesSandboxEventSource.OPEN;
        const event = new Event("open");
        this.onopen?.(event);
        this.dispatchEvent(event);
      }, 0);
    }

    close(): void {
      this.readyState = PagesSandboxEventSource.CLOSED;
    }
  }

  window.EventSource = PagesSandboxEventSource as unknown as typeof EventSource;
}

export function installPagesSandboxRuntime(): void {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;

  const api = new PagesSandboxApi();
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (api.shouldHandle(url)) {
      return await api.handle(input, init);
    }
    return await nativeFetch(input, init);
  };

  installEventSourceShim();
}
