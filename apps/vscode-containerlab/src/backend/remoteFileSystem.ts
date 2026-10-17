import * as path from "path";

import * as vscode from "vscode";
import { errorStatus, type LabBackend } from "@srl-labs/containerlab-lab-backend";

import { REMOTE_SCHEME, type ConnectionManager } from "./connections";

function workspacePath(uri: vscode.Uri): string {
  return uri.path.replace(/^\/+/, "").replace(/\/+$/, "");
}

function toFileSystemError(error: unknown, uri: vscode.Uri): Error {
  switch (errorStatus(error)) {
    case 404:
      return vscode.FileSystemError.FileNotFound(uri);
    case 401:
    case 403:
      return vscode.FileSystemError.NoPermissions(uri);
    default:
      return error instanceof Error ? error : new Error(String(error));
  }
}

interface ConnectionWatch {
  count: number;
  controller: AbortController;
}

/**
 * Files of a clab-api-server workspace as `clab-api://<connection>/<path>`,
 * so remote topologies open in the normal editors and the topology viewer.
 */
export class RemoteLabFileSystem implements vscode.FileSystemProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changeEmitter.event;
  private readonly watches = new Map<string, ConnectionWatch>();

  constructor(private readonly connections: ConnectionManager) {}

  static register(connections: ConnectionManager): vscode.Disposable {
    return vscode.workspace.registerFileSystemProvider(
      REMOTE_SCHEME,
      new RemoteLabFileSystem(connections),
      {
        isCaseSensitive: true
      }
    );
  }

  private async backend(uri: vscode.Uri): Promise<LabBackend> {
    const connection = this.connections.get(uri.authority);
    if (!connection) {
      throw vscode.FileSystemError.Unavailable(`No lab host ${uri.authority} is configured`);
    }
    const backend = await this.connections.ensureBackend(connection);
    if (!backend) {
      throw vscode.FileSystemError.NoPermissions(
        `Sign in to ${connection.label} to open its files.`
      );
    }
    return backend;
  }

  watch(uri: vscode.Uri): vscode.Disposable {
    const key = uri.authority;
    let watch = this.watches.get(key);
    if (!watch) {
      const controller = new AbortController();
      watch = { count: 0, controller };
      this.watches.set(key, watch);
      void this.streamChanges(uri, controller.signal);
    }
    watch.count += 1;
    const current = watch;
    return new vscode.Disposable(() => {
      current.count -= 1;
      if (current.count <= 0) {
        current.controller.abort();
        this.watches.delete(key);
      }
    });
  }

  private async streamChanges(uri: vscode.Uri, signal: AbortSignal): Promise<void> {
    try {
      const backend = await this.backend(uri);
      const events = await backend.fs.watch(signal);
      for await (const event of events) {
        const changed = uri.with({ path: `/${event.path}` });
        let type = vscode.FileChangeType.Changed;
        if (event.action === "create") type = vscode.FileChangeType.Created;
        else if (event.action === "delete" || event.action === "rename")
          type = vscode.FileChangeType.Deleted;
        this.changeEmitter.fire([{ type, uri: changed }]);
      }
    } catch {
      // The server stopped streaming; editors keep their last content.
    } finally {
      const watch = this.watches.get(uri.authority);
      if (watch && !signal.aborted) {
        this.watches.delete(uri.authority);
      }
    }
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const target = workspacePath(uri);
    if (!target) {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }
    const backend = await this.backend(uri);
    const parent = path.posix.dirname(target);
    let entries;
    try {
      entries = await backend.fs.list(parent === "." ? "" : parent);
    } catch (error) {
      throw toFileSystemError(error, uri);
    }
    const entry = entries.find((candidate) => candidate.path === target);
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    const mtime = entry.modifiedAt === undefined ? 0 : Date.parse(entry.modifiedAt);
    return {
      type: entry.kind === "directory" ? vscode.FileType.Directory : vscode.FileType.File,
      ctime: mtime,
      mtime,
      size: entry.size ?? 0
    };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const backend = await this.backend(uri);
    try {
      return (await backend.fs.list(workspacePath(uri))).map((entry) => [
        entry.name,
        entry.kind === "directory" ? vscode.FileType.Directory : vscode.FileType.File
      ]);
    } catch (error) {
      throw toFileSystemError(error, uri);
    }
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const backend = await this.backend(uri);
    try {
      return (await backend.fs.read(workspacePath(uri))).data;
    } catch (error) {
      throw toFileSystemError(error, uri);
    }
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const backend = await this.backend(uri);
    try {
      await backend.fs.write(workspacePath(uri), content);
    } catch (error) {
      throw toFileSystemError(error, uri);
    }
    this.changeEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const backend = await this.backend(uri);
    try {
      await backend.fs.mkdir(workspacePath(uri));
    } catch (error) {
      throw toFileSystemError(error, uri);
    }
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    const backend = await this.backend(uri);
    try {
      await backend.fs.delete(workspacePath(uri), { recursive: options.recursive });
    } catch (error) {
      throw toFileSystemError(error, uri);
    }
    this.changeEmitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  async rename(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
    const backend = await this.backend(oldUri);
    try {
      await backend.fs.rename(workspacePath(oldUri), workspacePath(newUri));
    } catch (error) {
      throw toFileSystemError(error, oldUri);
    }
    this.changeEmitter.fire([
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri }
    ]);
  }
}
