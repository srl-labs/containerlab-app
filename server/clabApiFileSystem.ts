/**
 * FileSystemAdapter backed by clab-api-server REST endpoints.
 * This allows TopologyHostCore to read/write topology files through the API.
 */

import type { ClabApiClient } from "./clabApiClient.js";
import { isNotFoundError } from "./clabApiClient.js";

export interface ClabApiFileSystemOptions {
  client: ClabApiClient;
  token: string;
  labName: string;
}

function toPosixPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function normalizePath(pathValue: string): string {
  return toPosixPath(pathValue).replace(/\/+/g, "/").replace(/^\.\//, "");
}

/**
 * FileSystemAdapter that delegates to clab-api-server topology file endpoints.
 *
 * Maps file operations as follows:
 * - All files: GET/PUT/DELETE/HEAD /api/v1/labs/{labName}/topology/file?path=
 */
export class ClabApiFileSystemAdapter {
  private readonly client: ClabApiClient;
  private readonly token: string;
  private readonly labName: string;

  constructor(options: ClabApiFileSystemOptions) {
    this.client = options.client;
    this.token = options.token;
    this.labName = options.labName;
  }

  async readFile(filePath: string): Promise<string> {
    const normalized = normalizePath(filePath);

    try {
      return await this.client.getFile(this.token, this.labName, normalized);
    } catch (error) {
      if (isNotFoundError(error)) {
        const err = new Error(`ENOENT: no such file ${normalized}`) as Error & { code?: string };
        err.code = "ENOENT";
        throw err;
      }
      throw error;
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const normalized = normalizePath(filePath);
    await this.client.putFile(this.token, this.labName, normalized, content);
  }

  async unlink(filePath: string): Promise<void> {
    const normalized = normalizePath(filePath);
    try {
      await this.client.deleteFile(this.token, this.labName, normalized);
    } catch (error) {
      // Swallow ENOENT-like errors per FileSystemAdapter contract
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.client.renameFile(this.token, this.labName, normalizePath(oldPath), normalizePath(newPath));
  }

  async exists(filePath: string): Promise<boolean> {
    const normalized = normalizePath(filePath);
    return this.client.headFile(this.token, this.labName, normalized);
  }

  dirname(filePath: string): string {
    const normalized = normalizePath(filePath);
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash <= 0) {
      return ".";
    }
    return normalized.slice(0, lastSlash);
  }

  basename(filePath: string): string {
    const normalized = normalizePath(filePath);
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash < 0) {
      return normalized;
    }
    return normalized.slice(lastSlash + 1);
  }

  join(...segments: string[]): string {
    return normalizePath(segments.filter((s) => s.length > 0).join("/"));
  }
}
