import { watch as watchFiles, type Dirent } from "node:fs";
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
  constructor(readonly root: string) {}

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
    let watcher: ReturnType<typeof watchFiles> | undefined;
    const queue = createAsyncQueue<WorkspaceFileEvent>(signal, () => watcher?.close());
    watcher = watchFiles(this.root, { recursive: true, signal }, (eventType, fileName) => {
      if (!fileName) return;
      const relativePath = String(fileName).split(path.sep).join("/");
      void this.describeChange(eventType, relativePath).then((event) => {
        if (!event) return;
        const key = `${event.action}:${event.path}`;
        const now = Date.now();
        if ((recent.get(key) ?? 0) > now - EVENT_DEDUPE_MS) return;
        recent.set(key, now);
        if (recent.size > 1000) recent.clear();
        queue.push(event);
      });
    });
    watcher.on("error", (error) => queue.fail(error));
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
