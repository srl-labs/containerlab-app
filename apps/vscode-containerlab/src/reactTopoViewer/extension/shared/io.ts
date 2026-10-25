import * as fs from "fs";
import * as path from "path";

import * as vscode from "vscode";
import type { FileSystemAdapter } from "@containerlab/clab-ui/session";

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

class NodeFsAdapter implements FileSystemAdapter {
  async readFile(filePath: string): Promise<string> {
    return fs.promises.readFile(filePath, "utf8");
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.promises.writeFile(filePath, content, "utf8");
  }

  async unlink(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      if (!isErrnoException(err) || err.code !== "ENOENT") {
        throw err;
      }
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.promises.rename(oldPath, newPath);
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  dirname(filePath: string): string {
    return path.dirname(filePath);
  }

  basename(filePath: string): string {
    return path.basename(filePath);
  }

  join(...segments: string[]): string {
    return path.join(...segments);
  }
}

const nodeFsAdapter = new NodeFsAdapter();

function isUriString(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

/** VS Code file system errors as the ENOENT errors the topology core expects. */
function toNodeError(error: unknown, target: string): Error {
  if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
    return Object.assign(new Error(`ENOENT: no such file ${target}`), { code: "ENOENT" });
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Files given as URIs, such as `clab-api://<connection>/<path>`, through the
 * file systems VS Code knows, so open editors see the same content.
 */
class WorkspaceFsAdapter implements FileSystemAdapter {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  async readFile(target: string): Promise<string> {
    try {
      return this.decoder.decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(target)));
    } catch (error) {
      throw toNodeError(error, target);
    }
  }

  async writeFile(target: string, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.parse(target), this.encoder.encode(content));
  }

  async unlink(target: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.parse(target), { useTrash: false });
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError && error.code === "FileNotFound")) {
        throw error;
      }
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await vscode.workspace.fs.rename(vscode.Uri.parse(oldPath), vscode.Uri.parse(newPath), {
      overwrite: true
    });
  }

  async exists(target: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.parse(target));
      return true;
    } catch {
      return false;
    }
  }

  dirname(target: string): string {
    const uri = vscode.Uri.parse(target);
    return uri.with({ path: path.posix.dirname(uri.path) }).toString();
  }

  basename(target: string): string {
    return path.posix.basename(vscode.Uri.parse(target).path);
  }

  join(...segments: string[]): string {
    const [first = "", ...rest] = segments;
    if (!isUriString(first)) {
      return path.join(...segments);
    }
    const uri = vscode.Uri.parse(first);
    return uri.with({ path: path.posix.join(uri.path, ...rest) }).toString();
  }
}

const workspaceFsAdapter = new WorkspaceFsAdapter();

/** Paths on this machine go to the disk; URIs through VS Code's file systems. */
export function fsAdapterFor(filePath: string): FileSystemAdapter {
  return isUriString(filePath) ? workspaceFsAdapter : nodeFsAdapter;
}
