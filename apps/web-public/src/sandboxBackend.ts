import {
  TOPOLOGY_HOST_PROTOCOL_VERSION,
  TopologySessionCore,
  type CustomIconInfo,
  type TopologyHostCommand,
  type TopologyHostResponseMessage,
  type TopologyRef,
  type TopologySnapshot,
} from "@containerlab/clab-ui/session";

import type { EndpointConfig } from "@srl-labs/containerlab-standalone-runtime/endpoints";
import {
  buildStandaloneTopologyRefFromPath,
  normalizePathValue,
  safeFilename,
  stripTopologySuffix,
  type TopologyFileEntry,
} from "@srl-labs/containerlab-standalone-runtime/host";

const SANDBOX_ENDPOINT_ID = "pages-sandbox";
export const SANDBOX_FILES_CHANGED_EVENT = "clab-sandbox-files-changed";

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2);
}

function notifySandboxFilesChanged(): void {
  globalThis.dispatchEvent?.(new Event(SANDBOX_FILES_CHANGED_EVENT));
}
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

export interface StorageLike {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface SandboxFileExplorerEntry {
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

export interface SandboxFileDocument {
  endpointId: string;
  path: string;
  content: string;
}

export interface SandboxCustomNodes {
  customNodes: unknown[];
  defaultNode: string;
}

export interface SandboxUploadFile {
  name: string;
  content: string;
}

interface TopologySessionRecord {
  documentVersion?: string;
  host: TopologySessionCore;
  sessionId: string;
  topologyRef: TopologyRef;
}

const sandboxEndpoint: EndpointConfig = {
  id: SANDBOX_ENDPOINT_ID,
  url: "local://containerlab-sandbox",
  label: "Local workspace",
  username: "local",
  sessionDuration: "24h",
  status: "connected",
  connected: true,
};

export const SANDBOX_ENDPOINT: EndpointConfig = sandboxEndpoint;

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
  return [`name: ${labName}`, "topology:", "  nodes: {}", ""].join("\n");
}

export class BrowserSandboxFileSystem {
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
    const content = this.readFiles()[normalized];
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

function sameCustomNodeName(entry: unknown, name: string): boolean {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as { name?: unknown }).name === "string" &&
    (entry as { name: string }).name === name
  );
}

function iconInfoFromUploadPayload(payload: {
  fileName?: string;
  contentType?: string;
  dataBase64?: string;
}): CustomIconInfo {
  const fileName = payload.fileName ? safeFilename(payload.fileName) : "icon.svg";
  const dotIndex = fileName.lastIndexOf(".");
  const rawName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "svg";
  const format = ext === "png" ? "png" : "svg";
  let contentType = format === "png" ? "image/png" : "image/svg+xml";
  if (payload.contentType && payload.contentType.length > 0) {
    contentType = payload.contentType;
  }

  return {
    name: rawName || "icon",
    source: "global",
    dataUri: `data:${contentType};base64,${payload.dataBase64 ?? ""}`,
    format,
  };
}

function topologyError(error: string): TopologyHostResponseMessage {
  return {
    type: "topology-host:error",
    protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
    requestId: "",
    error,
  };
}

function emptySnapshot(): TopologySnapshot {
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
    mode: "edit",
    deploymentState: "undeployed",
    canUndo: false,
    canRedo: false,
  };
}

export class SandboxBackend {
  private readonly fs: BrowserSandboxFileSystem;
  private readonly sessions = new Map<string, TopologySessionRecord>();
  private readonly storage: StorageLike;

  constructor(storage: StorageLike = browserStorage()) {
    this.storage = storage;
    this.fs = new BrowserSandboxFileSystem(storage);
  }

  listTopologyFiles(): TopologyFileEntry[] {
    return Object.entries(this.fs.readFiles())
      .filter(([pathValue]) => isTopologyPath(pathValue))
      .map(([pathValue, content]) => topologyFileEntry(pathValue, content))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  listDirectory(parentPath = ""): SandboxFileExplorerEntry[] {
    const parent = normalizeSandboxPath(parentPath);
    const files = this.fs.readFiles();
    const directories = this.fs.readDirectories();
    const childDirectories = new Set<string>();
    const entries: SandboxFileExplorerEntry[] = [];

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
          endpointId: SANDBOX_ENDPOINT_ID,
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
        endpointId: SANDBOX_ENDPOINT_ID,
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

  async readFile(pathValue: string): Promise<SandboxFileDocument> {
    const path = normalizeSandboxPath(pathValue);
    return {
      endpointId: SANDBOX_ENDPOINT_ID,
      path,
      content: await this.fs.readFile(path),
    };
  }

  async writeFile(pathValue: string, content: string): Promise<void> {
    await this.fs.writeFile(normalizeSandboxPath(pathValue), content);
    notifySandboxFilesChanged();
  }

  async deletePath(pathValue: string, recursive = false): Promise<void> {
    const normalized = normalizeSandboxPath(pathValue);
    if (!recursive) {
      await this.fs.unlink(normalized);
      notifySandboxFilesChanged();
      return;
    }

    const files = this.fs.readFiles();
    for (const key of Object.keys(files)) {
      if (key === normalized || key.startsWith(`${normalized}/`)) {
        delete files[key];
      }
    }
    this.fs.writeFiles(files);

    const directories = this.fs.readDirectories();
    for (const directoryPath of directories) {
      if (directoryPath === normalized || directoryPath.startsWith(`${normalized}/`)) {
        directories.delete(directoryPath);
      }
    }
    this.fs.writeDirectories(directories);
    notifySandboxFilesChanged();
  }

  async renamePath(oldPath: string, newPath: string): Promise<void> {
    const from = normalizeSandboxPath(oldPath);
    const to = normalizeSandboxPath(newPath);
    if (await this.fs.exists(from)) {
      await this.fs.rename(from, to);
      notifySandboxFilesChanged();
      return;
    }

    const files = this.fs.readFiles();
    const prefix = `${from}/`;
    let changed = false;
    for (const [pathValue, content] of Object.entries(files)) {
      if (!pathValue.startsWith(prefix)) {
        continue;
      }
      delete files[pathValue];
      files[`${to}/${pathValue.slice(prefix.length)}`] = content;
      changed = true;
    }
    if (changed) {
      this.fs.writeFiles(files);
      notifySandboxFilesChanged();
    }
  }

  createDirectory(pathValue: string): void {
    const directories = this.fs.readDirectories();
    addDirectoryAncestors(directories, normalizeSandboxPath(pathValue));
    this.fs.writeDirectories(directories);
    notifySandboxFilesChanged();
  }

  async uploadFiles(
    targetPath: string,
    files: readonly SandboxUploadFile[],
    targetKind: "directory" | "file" = "directory",
  ): Promise<void> {
    if (files.length === 0) {
      throw new Error("Select at least one file to upload.");
    }
    const path = normalizeSandboxPath(targetPath);
    if (targetKind === "file") {
      await this.fs.writeFile(path, files[0].content);
      notifySandboxFilesChanged();
      return;
    }
    for (const file of files) {
      await this.fs.writeFile(joinPath(path, file.name), file.content);
    }
    notifySandboxFilesChanged();
  }

  async createTopologyFile(fileName: string, content?: string): Promise<TopologyRef> {
    const path = normalizeSandboxPath(fileName);
    if (!path) {
      throw new Error("Missing fileName");
    }
    if (await this.fs.exists(path)) {
      throw new Error(`${path} already exists`);
    }
    const yaml = content ?? defaultTopologyContent(path);
    await this.fs.writeFile(path, yaml);
    notifySandboxFilesChanged();
    return topologyFileEntry(path, yaml).topologyRef;
  }

  async deleteTopologyFile(topologyRef: TopologyRef): Promise<string> {
    const path = normalizeSandboxPath(topologyRef.yamlPath);
    await this.fs.unlink(path);
    await this.fs.unlink(`${path}.annotations.json`);
    notifySandboxFilesChanged();
    return path;
  }

  createSession(topologyRef: TopologyRef): { sessionId: string; topologyRef: TopologyRef } {
    const canonical = buildStandaloneTopologyRefFromPath(
      topologyRef.yamlPath,
      topologyRef.labName,
      SANDBOX_ENDPOINT_ID,
    );
    const host = new TopologySessionCore({
      fs: this.fs,
      yamlFilePath: canonical.yamlPath,
      mode: "edit",
      deploymentState: "undeployed",
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: console.error,
      },
    });
    const sessionId = newId();
    this.sessions.set(sessionId, { host, sessionId, topologyRef: canonical });
    return { sessionId, topologyRef: canonical };
  }

  disposeSession(sessionId: string): void {
    this.sessions.get(sessionId)?.host.dispose();
    this.sessions.delete(sessionId);
  }

  private documentVersion(topologyRef: TopologyRef): string {
    const files = this.fs.readFiles();
    return JSON.stringify([files[topologyRef.yamlPath], files[topologyRef.annotationsPath ?? `${topologyRef.yamlPath}.annotations.json`]]);
  }

  async getSnapshot(
    sessionId: string | undefined,
    options: { externalChange?: boolean } = {},
  ): Promise<TopologySnapshot> {
    const id = sessionId?.trim() ?? "";
    if (!id) {
      return emptySnapshot();
    }
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error("Topology session not found");
    }
    session.host.updateContext({ mode: "edit", deploymentState: "undeployed" });
    const externalChange = options.externalChange || (session.documentVersion !== undefined && session.documentVersion !== this.documentVersion(session.topologyRef));
    const snapshot = externalChange ? await session.host.onExternalChange() : await session.host.getSnapshot();
    session.documentVersion = this.documentVersion(session.topologyRef);
    return snapshot;
  }

  async dispatchCommand(
    sessionId: string | undefined,
    revision: number,
    command: TopologyHostCommand,
  ): Promise<TopologyHostResponseMessage> {
    const id = sessionId?.trim() ?? "";
    if (!id) {
      return topologyError("Missing sessionId or command");
    }
    const session = this.sessions.get(id);
    if (!session) {
      return topologyError("Topology session not found");
    }
    session.host.updateContext({ mode: "edit", deploymentState: "undeployed" });
    // Read external file edits before applying a revision-checked command. Own writes
    // advance the baseline so a later snapshot preserves the command undo history.
    await this.getSnapshot(id);
    const result = await session.host.applyCommand(command, revision);
    session.documentVersion = this.documentVersion(session.topologyRef);
    notifySandboxFilesChanged();
    return result;
  }

  getCustomNodes(): SandboxCustomNodes {
    const hasStoredCustomNodes = this.storage.getItem(SANDBOX_STORAGE_CUSTOM_NODES) !== null;
    const storedCustomNodes = hasStoredCustomNodes
      ? readJson<unknown[]>(this.storage, SANDBOX_STORAGE_CUSTOM_NODES, [...DEFAULT_PAGES_CUSTOM_NODES])
      : [...DEFAULT_PAGES_CUSTOM_NODES];
    const customNodes = storedCustomNodes.length > 0 ? storedCustomNodes : [...DEFAULT_PAGES_CUSTOM_NODES];
    return {
      customNodes,
      defaultNode: this.storage.getItem(SANDBOX_STORAGE_DEFAULT_NODE) ?? firstCustomNodeName(customNodes),
    };
  }

  replaceCustomNodes(customNodes: unknown[]): SandboxCustomNodes {
    return this.writeCustomNodes(customNodes, firstCustomNodeName(customNodes));
  }

  saveCustomNode(payload: Record<string, unknown>): SandboxCustomNodes {
    const current = this.getCustomNodes();
    const name = typeof payload.name === "string" ? payload.name : "";
    const customNodes = name
      ? [...current.customNodes.filter((entry) => !sameCustomNodeName(entry, name)), payload]
      : current.customNodes;
    return this.writeCustomNodes(customNodes, current.defaultNode);
  }

  deleteCustomNode(name: string): SandboxCustomNodes {
    const current = this.getCustomNodes();
    return this.writeCustomNodes(
      current.customNodes.filter((entry) => !sameCustomNodeName(entry, name)),
      current.defaultNode === name ? "" : current.defaultNode,
    );
  }

  setDefaultCustomNode(name: string): SandboxCustomNodes {
    const current = this.getCustomNodes();
    return this.writeCustomNodes(current.customNodes, name);
  }

  listIcons(): CustomIconInfo[] {
    return readJson<CustomIconInfo[]>(this.storage, SANDBOX_STORAGE_ICONS, []);
  }

  uploadIcon(payload: {
    fileName?: string;
    contentType?: string;
    dataBase64?: string;
  }): { iconName: string } {
    const uploadedIcon = iconInfoFromUploadPayload(payload);
    const icons = this.listIcons().filter((icon) => icon.name !== uploadedIcon.name);
    icons.push(uploadedIcon);
    writeJson(this.storage, SANDBOX_STORAGE_ICONS, icons);
    return { iconName: uploadedIcon.name };
  }

  deleteIcon(iconName: string): void {
    writeJson(
      this.storage,
      SANDBOX_STORAGE_ICONS,
      this.listIcons().filter((icon) => icon.name !== iconName),
    );
  }

  private writeCustomNodes(customNodes: unknown[], defaultNode: string): SandboxCustomNodes {
    writeJson(this.storage, SANDBOX_STORAGE_CUSTOM_NODES, customNodes);
    this.storage.setItem(SANDBOX_STORAGE_DEFAULT_NODE, defaultNode);
    return { customNodes, defaultNode };
  }
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

let defaultBackend: SandboxBackend | undefined;

export function getSandboxBackend(): SandboxBackend {
  defaultBackend ??= new SandboxBackend();
  return defaultBackend;
}

export function createMemorySandboxBackend(): SandboxBackend {
  return new SandboxBackend(new MemoryStorage());
}
