import { watch as watchFiles, type Dirent, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { LabFileContent, LabFileSystem, WorkspaceFileEvent } from "../contract/backend.ts";
import type { WorkspaceFileEntry } from "../contract/dto.ts";
import { LabBackendError } from "../contract/errors.ts";
import { createAsyncQueue } from "../asyncQueue.ts";

const DIRECTORY_MODE = 0o750;
const FILE_MODE = 0o640;
const EVENT_DEDUPE_MS = 150;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** Resolves workspace-relative paths and keeps them inside the workspace root. */
export class WorkspacePaths {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** A clean relative POSIX path; "" is the root, which only `allowRoot` accepts. */
  clean(rawPath: string, allowRoot = false): string {
    const trimmed = rawPath.trim().replace(/\\/g, "/");
    if (trimmed.startsWith("@shared")) {
      throw new LabBackendError("Shared labs are not available on this computer", 400);
    }
    if (trimmed.startsWith("/") || trimmed.includes("\0")) {
      throw new LabBackendError("invalid file path", 400);
    }
    const normalized = path.posix.normalize(trimmed || ".").replace(/\/+$/, "");
    if (normalized === "." || normalized === "") {
      if (allowRoot) return "";
      throw new LabBackendError("invalid file path", 400);
    }
    if (normalized === ".." || normalized.startsWith("../")) {
      throw new LabBackendError("invalid file path", 400);
    }
    return normalized;
  }

  absolute(relativePath: string): string {
    return relativePath ? path.join(this.root, ...relativePath.split("/")) : this.root;
  }

  relative(absolutePath: string): string {
    return path.relative(this.root, absolutePath).split(path.sep).join("/");
  }

  /**
   * The absolute path for `rawPath`. Rejects paths whose existing part leaves
   * the root through a symbolic link.
   */
  async resolve(rawPath: string, allowRoot = false): Promise<string> {
    const relativePath = this.clean(rawPath, allowRoot);
    const absolutePath = this.absolute(relativePath);
    await this.assertInside(absolutePath);
    return absolutePath;
  }

  private async assertInside(absolutePath: string): Promise<void> {
    let realRoot: string;
    try {
      realRoot = await fs.realpath(this.root);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    let existing = absolutePath;
    while (true) {
      try {
        const real = await fs.realpath(existing);
        if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
          throw new LabBackendError("path escapes the workspace", 400);
        }
        return;
      } catch (error) {
        if (!isMissing(error)) throw error;
        const parent = path.dirname(existing);
        if (parent === existing) return;
        existing = parent;
      }
    }
  }
}

function modifiedAt(stat: { mtime: Date }): string {
  return stat.mtime.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function hasChildren(directory: string): Promise<boolean> {
  try {
    const handle = await fs.opendir(directory);
    try {
      return (await handle.read()) !== null;
    } finally {
      await handle.close().catch(() => {});
    }
  } catch {
    return false;
  }
}

/**
 * Watches `root` and every folder below it, one watcher per folder, and skips
 * folders it cannot read, as clab-api-server does. Node's recursive watcher on
 * Linux throws an uncaught EACCES for such folders, which ends the process;
 * containerlab creates them inside lab folders (root-owned node configs).
 * Reports paths relative to `root`, including the entries of new folders.
 */
async function watchFolders(
  root: string,
  signal: AbortSignal,
  onChange: (eventType: string, relativePath: string) => void,
  onError: (error: unknown) => void
): Promise<{ close(): void }> {
  const watchers = new Map<string, FSWatcher>();
  let closed = false;

  const forget = (folder: string) => {
    const prefix = folder + path.sep;
    for (const [watched, watcher] of watchers) {
      if (watched === folder || watched.startsWith(prefix)) {
        watcher.close();
        watchers.delete(watched);
      }
    }
  };

  const add = async (folder: string, initial: boolean): Promise<void> => {
    if (closed || watchers.has(folder)) return;
    let watcher: FSWatcher;
    try {
      watcher = watchFiles(folder, (eventType, fileName) => {
        if (fileName === null) return;
        const file = path.join(folder, String(fileName));
        onChange(eventType, path.relative(root, file));
        if (eventType === "rename") void update(file);
      });
    } catch (error) {
      if (folder === root) throw error;
      return;
    }
    watcher.on("error", (error) => {
      if (folder === root) onError(error);
      else forget(folder);
    });
    watchers.set(folder, watcher);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path.join(folder, entry.name);
      if (!initial) onChange("rename", path.relative(root, file));
      if (entry.isDirectory()) await add(file, initial);
    }
  };

  const update = async (file: string): Promise<void> => {
    let stat;
    try {
      stat = await fs.lstat(file);
    } catch {
      forget(file);
      return;
    }
    if (stat.isDirectory()) await add(file, false);
  };

  const close = () => {
    closed = true;
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    await add(root, true);
  } catch (error) {
    close();
    throw error;
  }
  if (signal.aborted) close();
  return { close };
}

/** The workspace on the local disk, with clab-api-server's semantics. */
export class LocalWorkspace implements LabFileSystem {
  readonly paths: WorkspacePaths;

  constructor(root: string) {
    this.paths = new WorkspacePaths(root);
  }

  get root(): string {
    return this.paths.root;
  }

  async list(rawPath = ""): Promise<WorkspaceFileEntry[]> {
    const relativeDir = this.paths.clean(rawPath, true);
    const directory = await this.paths.resolve(rawPath, true);
    let entries: Dirent[];
    try {
      const stat = await fs.stat(directory);
      if (!stat.isDirectory()) throw new LabBackendError("Path is not a directory", 400);
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) {
        if (!relativeDir) return [];
        throw new LabBackendError("Directory not found", 404);
      }
      throw error;
    }
    const result: WorkspaceFileEntry[] = [];
    for (const entry of entries) {
      const entryPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      try {
        if (entry.isSymbolicLink()) await this.paths.resolve(entryPath);
        const stat = await fs.stat(absolutePath);
        const kind = stat.isDirectory() ? "directory" : "file";
        result.push({
          name: entry.name,
          path: entryPath,
          kind,
          size: stat.size,
          modifiedAt: modifiedAt(stat),
          hasChildren: kind === "directory" ? await hasChildren(absolutePath) : false
        });
      } catch {
        // Dangling or escaping link.
      }
    }
    return result.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });
  }

  async read(rawPath: string, options: { maxBytes?: number } = {}): Promise<LabFileContent> {
    const filePath = await this.paths.resolve(rawPath);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (error) {
      if (isMissing(error)) throw new LabBackendError("File not found", 404);
      throw error;
    }
    if (stat.isDirectory()) throw new LabBackendError("Path is not a file", 400);
    if (options.maxBytes !== undefined && stat.size > options.maxBytes) {
      throw new LabBackendError("File is too large to edit in the browser.", 413);
    }
    return { data: await fs.readFile(filePath), contentType: "application/octet-stream" };
  }

  async write(rawPath: string, content: string | Uint8Array): Promise<void> {
    const filePath = await this.paths.resolve(rawPath);
    await fs.mkdir(this.root, { recursive: true, mode: DIRECTORY_MODE });
    try {
      const parent = await fs.stat(path.dirname(filePath));
      if (!parent.isDirectory()) throw new LabBackendError("Parent is not a directory", 400);
    } catch (error) {
      if (isMissing(error)) throw new LabBackendError("Parent directory does not exist", 400);
      throw error;
    }
    await fs.writeFile(filePath, content, { mode: FILE_MODE });
  }

  async delete(rawPath: string, options: { recursive?: boolean } = {}): Promise<void> {
    const relativePath = this.paths.clean(rawPath);
    const filePath = this.paths.absolute(relativePath);
    let stat;
    try {
      stat = await fs.lstat(filePath);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    await this.paths.resolve(path.posix.dirname(relativePath), true);
    if (stat.isDirectory()) {
      if (!options.recursive && (await hasChildren(filePath))) {
        throw new LabBackendError("Directory is not empty", 400);
      }
      await fs.rm(filePath, { recursive: true, force: true });
      return;
    }
    await fs.unlink(filePath);
  }

  async rename(oldRawPath: string, newRawPath: string): Promise<void> {
    const oldPath = await this.paths.resolve(oldRawPath);
    const newPath = await this.paths.resolve(newRawPath);
    try {
      await fs.lstat(oldPath);
    } catch (error) {
      if (isMissing(error)) throw new LabBackendError("Source file not found", 404);
      throw error;
    }
    try {
      await fs.stat(path.dirname(newPath));
    } catch (error) {
      if (isMissing(error)) throw new LabBackendError("Destination directory does not exist", 400);
      throw error;
    }
    await fs.rename(oldPath, newPath);
  }

  async mkdir(rawPath: string): Promise<void> {
    const directory = await this.paths.resolve(rawPath);
    await fs.mkdir(this.root, { recursive: true, mode: DIRECTORY_MODE });
    try {
      await fs.stat(path.dirname(directory));
    } catch (error) {
      if (isMissing(error)) throw new LabBackendError("Parent directory does not exist", 400);
      throw error;
    }
    await fs.mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
  }

  async watch(signal: AbortSignal): Promise<AsyncIterable<WorkspaceFileEvent>> {
    await fs.mkdir(this.root, { recursive: true, mode: DIRECTORY_MODE });
    const recent = new Map<string, number>();
    let watcher: { close(): void } | undefined;
    const queue = createAsyncQueue<WorkspaceFileEvent>(signal, () => watcher?.close());
    const onChange = (eventType: string, fileName: string) => {
      const relativePath = fileName.split(path.sep).join("/");
      void this.describeChange(eventType, relativePath).then((event) => {
        if (!event) return;
        const key = `${event.action}:${event.path}`;
        const now = Date.now();
        if ((recent.get(key) ?? 0) > now - EVENT_DEDUPE_MS) return;
        recent.set(key, now);
        if (recent.size > 1000) recent.clear();
        queue.push(event);
      });
    };
    const onError = (error: unknown) => queue.fail(error);
    if (process.platform === "linux") {
      watcher = await watchFolders(this.root, signal, onChange, onError);
    } else {
      const native = watchFiles(this.root, { recursive: true, signal }, (eventType, fileName) => {
        if (fileName) onChange(eventType, String(fileName));
      });
      native.on("error", onError);
      watcher = native;
    }
    return queue.iterable;
  }

  private async describeChange(
    eventType: string,
    relativePath: string
  ): Promise<WorkspaceFileEvent | undefined> {
    if (!relativePath || relativePath === ".") return undefined;
    const parentPath = path.posix.dirname(relativePath);
    const base = {
      type: "workspace-file" as const,
      path: relativePath,
      parentPath: parentPath === "." ? "" : parentPath
    };
    let kind: "file" | "directory" | undefined;
    try {
      kind = (await fs.stat(this.paths.absolute(relativePath))).isDirectory() ? "directory" : "file";
    } catch {
      kind = undefined;
    }
    if (eventType === "change") {
      return kind ? { ...base, action: "change", kind } : undefined;
    }
    return kind ? { ...base, action: "create", kind } : { ...base, action: "delete" };
  }
}
