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
  sourcePreference?: "api-file" | "running-lab-doc";
  yamlPath?: string;
  annotationsPath?: string;
}

type RunningTopologyDocumentKind = "yaml" | "annotations";

const EMPTY_ANNOTATIONS_FILE_CONTENT = "{}\n";
const FILE_CACHE_TTL_MS = 350;

interface CachedFileContentEntry {
  content: string;
  expiresAt: number;
}

interface CachedExistsEntry {
  exists: boolean;
  expiresAt: number;
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
  private readonly sourcePreference: "api-file" | "running-lab-doc";
  private readonly yamlPath?: string;
  private readonly annotationsPath?: string;
  private readonly transientFileContents = new Map<string, string>();
  private readonly pendingRunningDocDeletes = new Set<RunningTopologyDocumentKind>();
  private readonly fileContentCache = new Map<string, CachedFileContentEntry>();
  private readonly fileExistsCache = new Map<string, CachedExistsEntry>();

  constructor(options: ClabApiFileSystemOptions) {
    this.client = options.client;
    this.token = options.token;
    this.labName = options.labName;
    this.sourcePreference = options.sourcePreference ?? "api-file";
    this.yamlPath = options.yamlPath ? normalizePath(options.yamlPath) : undefined;
    this.annotationsPath = options.annotationsPath
      ? normalizePath(options.annotationsPath)
      : this.yamlPath
        ? `${this.yamlPath}.annotations.json`
        : undefined;
  }

  private matchesConfiguredPath(pathValue: string, configuredPath: string | undefined): boolean {
    if (!configuredPath) {
      return false;
    }
    return pathValue === configuredPath || pathValue === this.basename(configuredPath);
  }

  private createNotFoundError(pathValue: string): Error & { code?: string } {
    const err = new Error(`ENOENT: no such file ${pathValue}`) as Error & { code?: string };
    err.code = "ENOENT";
    return err;
  }

  private resolveRunningDocPath(pathValue: string): RunningTopologyDocumentKind | null {
    if (this.sourcePreference !== "running-lab-doc") {
      return null;
    }
    if (this.matchesConfiguredPath(pathValue, this.yamlPath)) {
      return "yaml";
    }
    if (this.matchesConfiguredPath(pathValue, this.annotationsPath)) {
      return "annotations";
    }
    return null;
  }

  private resolveRunningDocAliasPath(pathValue: string): RunningTopologyDocumentKind | null {
    if (this.sourcePreference !== "running-lab-doc") {
      return null;
    }

    const aliasBaseName = this.basename(pathValue);
    if (!(aliasBaseName.startsWith(".tmp-") || aliasBaseName.startsWith(".bak-"))) {
      return null;
    }

    const yamlBaseName = this.yamlPath ? this.basename(this.yamlPath) : "";
    if (yamlBaseName && aliasBaseName.endsWith(`-${yamlBaseName}`)) {
      return "yaml";
    }

    const annotationsBaseName = this.annotationsPath ? this.basename(this.annotationsPath) : "";
    if (annotationsBaseName && aliasBaseName.endsWith(`-${annotationsBaseName}`)) {
      return "annotations";
    }

    return null;
  }

  private isRunningDocBackupAliasPath(pathValue: string): boolean {
    return this.basename(pathValue).startsWith(".bak-");
  }

  private async readRunningDoc(kind: RunningTopologyDocumentKind): Promise<string> {
    if (kind === "yaml") {
      return await this.client.getLabTopologyYaml(this.token, this.labName);
    }
    return await this.client.getLabTopologyAnnotations(this.token, this.labName);
  }

  private async writeRunningDoc(kind: RunningTopologyDocumentKind, content: string): Promise<void> {
    if (kind === "yaml") {
      await this.client.putLabTopologyYaml(this.token, this.labName, content);
      return;
    }
    await this.client.putLabTopologyAnnotations(this.token, this.labName, content);
  }

  private async deleteRunningDoc(kind: RunningTopologyDocumentKind): Promise<void> {
    if (kind === "annotations") {
      await this.client.putLabTopologyAnnotations(
        this.token,
        this.labName,
        EMPTY_ANNOTATIONS_FILE_CONTENT
      );
      return;
    }

    // Topology host commands should never delete the running YAML document.
    throw new Error(`Deleting running topology YAML is not supported for lab "${this.labName}"`);
  }

  private now(): number {
    return Date.now();
  }

  private clearFileCache(pathValue: string): void {
    this.fileContentCache.delete(pathValue);
    this.fileExistsCache.delete(pathValue);
  }

  private setCachedContent(pathValue: string, content: string): void {
    const expiresAt = this.now() + FILE_CACHE_TTL_MS;
    this.fileContentCache.set(pathValue, { content, expiresAt });
    this.fileExistsCache.set(pathValue, { exists: true, expiresAt });
  }

  private getCachedContent(pathValue: string): string | undefined {
    const cached = this.fileContentCache.get(pathValue);
    if (!cached) {
      return undefined;
    }
    if (cached.expiresAt <= this.now()) {
      this.fileContentCache.delete(pathValue);
      return undefined;
    }
    return cached.content;
  }

  private setCachedExists(pathValue: string, exists: boolean): void {
    this.fileExistsCache.set(pathValue, { exists, expiresAt: this.now() + FILE_CACHE_TTL_MS });
    if (!exists) {
      this.fileContentCache.delete(pathValue);
    }
  }

  private getCachedExists(pathValue: string): boolean | undefined {
    const cached = this.fileExistsCache.get(pathValue);
    if (!cached) {
      return undefined;
    }
    if (cached.expiresAt <= this.now()) {
      this.fileExistsCache.delete(pathValue);
      return undefined;
    }
    return cached.exists;
  }

  async readFile(filePath: string): Promise<string> {
    const normalized = normalizePath(filePath);
    const transient = this.transientFileContents.get(normalized);
    if (transient !== undefined) {
      return transient;
    }

    const cachedContent = this.getCachedContent(normalized);
    if (cachedContent !== undefined) {
      return cachedContent;
    }

    const runningDocPath = this.resolveRunningDocPath(normalized);
    if (runningDocPath && this.pendingRunningDocDeletes.has(runningDocPath)) {
      throw this.createNotFoundError(normalized);
    }

    if (runningDocPath === "yaml") {
      const content = await this.readRunningDoc("yaml");
      this.setCachedContent(normalized, content);
      return content;
    }

    if (runningDocPath === "annotations") {
      const content = await this.readRunningDoc("annotations");
      this.setCachedContent(normalized, content);
      return content;
    }

    if (this.resolveRunningDocAliasPath(normalized)) {
      throw this.createNotFoundError(normalized);
    }

    try {
      const content = await this.client.getFile(this.token, this.labName, normalized);
      this.setCachedContent(normalized, content);
      return content;
    } catch (error) {
      if (isNotFoundError(error)) {
        this.setCachedExists(normalized, false);
        throw this.createNotFoundError(normalized);
      }
      throw error;
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const normalized = normalizePath(filePath);
    const runningDocAliasPath = this.resolveRunningDocAliasPath(normalized);
    if (runningDocAliasPath) {
      this.transientFileContents.set(normalized, content);
      this.setCachedContent(normalized, content);
      return;
    }

    const runningDocPath = this.resolveRunningDocPath(normalized);

    if (runningDocPath === "yaml") {
      await this.writeRunningDoc("yaml", content);
      this.pendingRunningDocDeletes.delete("yaml");
      this.setCachedContent(normalized, content);
      return;
    }

    if (runningDocPath === "annotations") {
      await this.writeRunningDoc("annotations", content);
      this.pendingRunningDocDeletes.delete("annotations");
      this.setCachedContent(normalized, content);
      return;
    }

    await this.client.putFile(this.token, this.labName, normalized, content);
    this.setCachedContent(normalized, content);
  }

  async unlink(filePath: string): Promise<void> {
    const normalized = normalizePath(filePath);

    const runningDocAliasPath = this.resolveRunningDocAliasPath(normalized);
    if (runningDocAliasPath) {
      this.transientFileContents.delete(normalized);
      this.clearFileCache(normalized);
      if (
        this.isRunningDocBackupAliasPath(normalized) &&
        this.pendingRunningDocDeletes.has(runningDocAliasPath)
      ) {
        await this.deleteRunningDoc(runningDocAliasPath);
        this.pendingRunningDocDeletes.delete(runningDocAliasPath);
        if (runningDocAliasPath === "yaml" && this.yamlPath) {
          this.setCachedExists(this.yamlPath, false);
        }
        if (runningDocAliasPath === "annotations" && this.annotationsPath) {
          this.setCachedExists(this.annotationsPath, false);
        }
      }
      return;
    }

    const runningDocPath = this.resolveRunningDocPath(normalized);
    if (runningDocPath) {
      await this.deleteRunningDoc(runningDocPath);
      this.pendingRunningDocDeletes.delete(runningDocPath);
      this.setCachedExists(normalized, false);
      return;
    }

    try {
      await this.client.deleteFile(this.token, this.labName, normalized);
      this.setCachedExists(normalized, false);
    } catch (error) {
      // Swallow ENOENT-like errors per FileSystemAdapter contract
      if (!isNotFoundError(error)) {
        throw error;
      }
      this.setCachedExists(normalized, false);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const normalizedOldPath = normalizePath(oldPath);
    const normalizedNewPath = normalizePath(newPath);
    const oldRunningDocPath = this.resolveRunningDocPath(normalizedOldPath);
    const newRunningDocPath = this.resolveRunningDocPath(normalizedNewPath);
    const oldRunningDocAliasPath = this.resolveRunningDocAliasPath(normalizedOldPath);
    const newRunningDocAliasPath = this.resolveRunningDocAliasPath(normalizedNewPath);

    if (oldRunningDocPath && newRunningDocAliasPath) {
      if (oldRunningDocPath !== newRunningDocAliasPath) {
        throw new Error(
          `Invalid running topology rename from ${normalizedOldPath} to ${normalizedNewPath}`
        );
      }
      const content = await this.readRunningDoc(oldRunningDocPath);
      this.transientFileContents.set(normalizedNewPath, content);
      this.setCachedContent(normalizedNewPath, content);
      if (this.isRunningDocBackupAliasPath(normalizedNewPath)) {
        this.pendingRunningDocDeletes.add(oldRunningDocPath);
      }
      return;
    }

    if (oldRunningDocAliasPath && newRunningDocPath) {
      if (oldRunningDocAliasPath !== newRunningDocPath) {
        throw new Error(
          `Invalid running topology rename from ${normalizedOldPath} to ${normalizedNewPath}`
        );
      }
      const content = this.transientFileContents.get(normalizedOldPath);
      if (content === undefined) {
        throw this.createNotFoundError(normalizedOldPath);
      }
      await this.writeRunningDoc(newRunningDocPath, content);
      this.pendingRunningDocDeletes.delete(newRunningDocPath);
      this.transientFileContents.delete(normalizedOldPath);
      this.clearFileCache(normalizedOldPath);
      this.setCachedContent(normalizedNewPath, content);
      return;
    }

    if (oldRunningDocAliasPath && newRunningDocAliasPath) {
      if (oldRunningDocAliasPath !== newRunningDocAliasPath) {
        throw new Error(
          `Invalid running topology rename from ${normalizedOldPath} to ${normalizedNewPath}`
        );
      }
      const content = this.transientFileContents.get(normalizedOldPath);
      if (content === undefined) {
        throw this.createNotFoundError(normalizedOldPath);
      }
      this.transientFileContents.set(normalizedNewPath, content);
      this.transientFileContents.delete(normalizedOldPath);
      this.clearFileCache(normalizedOldPath);
      this.setCachedContent(normalizedNewPath, content);
      return;
    }

    await this.client.renameFile(this.token, this.labName, normalizedOldPath, normalizedNewPath);
    const previousContent = this.getCachedContent(normalizedOldPath);
    this.clearFileCache(normalizedOldPath);
    if (previousContent !== undefined) {
      this.setCachedContent(normalizedNewPath, previousContent);
    } else {
      this.setCachedExists(normalizedNewPath, true);
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const normalized = normalizePath(filePath);
    if (this.transientFileContents.has(normalized)) {
      return true;
    }

    if (this.resolveRunningDocAliasPath(normalized)) {
      return false;
    }

    const cachedExists = this.getCachedExists(normalized);
    if (cachedExists !== undefined) {
      return cachedExists;
    }

    if (this.getCachedContent(normalized) !== undefined) {
      this.setCachedExists(normalized, true);
      return true;
    }

    const runningDocPath = this.resolveRunningDocPath(normalized);
    if (runningDocPath && this.pendingRunningDocDeletes.has(runningDocPath)) {
      return false;
    }
    if (runningDocPath === "yaml") {
      try {
        const content = await this.readRunningDoc("yaml");
        this.setCachedContent(normalized, content);
        return true;
      } catch (error) {
        if (isNotFoundError(error)) {
          this.setCachedExists(normalized, false);
          return false;
        }
        throw error;
      }
    }

    if (runningDocPath === "annotations") {
      try {
        const content = await this.readRunningDoc("annotations");
        this.setCachedContent(normalized, content);
        return true;
      } catch (error) {
        if (isNotFoundError(error)) {
          this.setCachedExists(normalized, false);
          return false;
        }
        throw error;
      }
    }

    const exists = await this.client.headFile(this.token, this.labName, normalized);
    this.setCachedExists(normalized, exists);
    return exists;
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
