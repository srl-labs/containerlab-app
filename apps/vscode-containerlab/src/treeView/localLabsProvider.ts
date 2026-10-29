import * as path from "path";

import * as vscode from "vscode";

import * as utils from "../utils/utils";
import { favoriteLabs, outputChannel } from "../globals";
import { FilterUtils } from "../helpers/filterUtils";
import { getConnections, remoteUri } from "../backend/labBackends";
import { LOCAL_CONNECTION, type LabConnection } from "../backend/connections";

import * as c from "./common";
import * as ins from "./inspector";

const WATCHER_GLOB_PATTERN = "**/*.clab.{yaml,yml,gotmpl}";
const CLAB_GLOB_PATTERN = "{**/*.clab.yml,**/*.clab.yaml,**/*.clab.gotmpl}";
const IGNORE_GLOB_PATTERN = "**/node_modules/**";
const SCAN_TIMEOUT_MS = 120_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class LocalLabTreeDataProvider implements vscode.TreeDataProvider<
  c.ClabLabTreeNode | c.ClabFolderTreeNode | undefined
> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    void | c.ClabLabTreeNode | c.ClabFolderTreeNode | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private watcher = vscode.workspace.createFileSystemWatcher(
    WATCHER_GLOB_PATTERN,
    false,
    false,
    false
  );
  // match on subdirs. deletion events only.
  private delSubdirWatcher = vscode.workspace.createFileSystemWatcher("**/", true, true, false);
  private treeFilter: string = "";

  private cachedUris: Map<string, vscode.Uri> | undefined;
  private scanPromise: Promise<void> | undefined;
  private scanRequested = false;
  /**
   * Resolved lab paths by path. Resolving checks the file system; every
   * snapshot resolves each lab once per folder, so it is cached until files change.
   */
  private normalizedPaths = new Map<string, string>();

  constructor() {
    this.watcher.onDidCreate((uri) => {
      if (!uri.scheme || uri.scheme === "file") {
        this.normalizedPaths.clear();
        this.cachedUris?.set(uri.fsPath, uri);
        this.refresh();
      }
    });
    this.watcher.onDidDelete((uri) => {
      if (!uri.scheme || uri.scheme === "file") {
        this.normalizedPaths.clear();
        this.cachedUris?.delete(uri.fsPath);
        this.refresh();
      }
    });
    this.watcher.onDidChange((uri) => {
      if (!uri.scheme || uri.scheme === "file") {
        this.refresh();
      }
    });
    // refresh when a subdir is deleted so we can check if any
    // clab.yaml/yml files have been also deleted as a result
    // of the subdir deletion.
    this.delSubdirWatcher.onDidDelete((uri) => {
      if (!uri.scheme || uri.scheme === "file") {
        this.normalizedPaths.clear();
        if (this.cachedUris) {
          const prefix = uri.fsPath + path.sep;
          for (const fsPath of this.cachedUris.keys()) {
            if (fsPath.startsWith(prefix)) {
              this.cachedUris.delete(fsPath);
            }
          }
        }
        this.refresh();
      }
    });
  }

  private performScan(): Promise<void> {
    // Only one scan at a time – if a scan is already running, return its promise.
    if (this.scanPromise) {
      return this.scanPromise;
    }

    const scan = (async () => {
      try {
        outputChannel.debug("[LocalTreeDataProvider] Performing file discovery scan");
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("File scan timed out after 120s")), SCAN_TIMEOUT_MS)
        );
        const uris = (
          await Promise.race([
            vscode.workspace.findFiles(CLAB_GLOB_PATTERN, IGNORE_GLOB_PATTERN),
            timeout
          ])
        ).filter((u) => !u.scheme || u.scheme === "file");
        this.cachedUris = new Map(uris.map((u) => [u.fsPath, u]));
        this.normalizedPaths.clear();
        outputChannel.debug(`[LocalTreeDataProvider] Scan found ${this.cachedUris.size} lab files`);
        this.refresh();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        outputChannel.error(`[LocalTreeDataProvider] File scan failed: ${message}`);
        this.cachedUris ??= new Map();
      } finally {
        this.scanPromise = undefined;
      }
    })();

    this.scanPromise = scan;
    return scan;
  }

  /** Starts looking for topology files before the explorer asks for them. */
  prefetch(): void {
    if (!this.scanRequested) {
      this.scanRequested = true;
      void this.performScan();
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  private normalize(filePath: string): string {
    let normalized = this.normalizedPaths.get(filePath);
    if (normalized === undefined) {
      normalized = utils.normalizeLabPath(filePath);
      this.normalizedPaths.set(filePath, normalized);
    }
    return normalized;
  }

  // Force refresh
  forceRefresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setTreeFilter(filterText: string) {
    this.treeFilter = filterText;
    this.refresh();
  }

  clearTreeFilter() {
    this.treeFilter = "";
    this.refresh();
  }

  getTreeItem(element: c.ClabLabTreeNode | c.ClabFolderTreeNode): vscode.TreeItem {
    return element;
  }

  // Populate the tree
  async getChildren(
    element: c.ClabLabTreeNode | c.ClabFolderTreeNode | undefined
  ): Promise<(c.ClabFolderTreeNode | c.ClabLabTreeNode)[] | undefined> {
    if (element instanceof c.ClabFolderTreeNode) {
      return this.discoverLabs(element.fullPath, element.connectionId);
    }
    if (element instanceof c.ClabConnectionTreeNode) {
      return element.children as (c.ClabFolderTreeNode | c.ClabLabTreeNode)[];
    }
    if (element) {
      return undefined;
    }
    const manager = getConnections();
    if (!manager?.grouped) {
      return manager && manager.list().length === 0 ? undefined : this.discoverLabs();
    }
    // With lab hosts, each connection is a root with its own topologies.
    const roots = await Promise.all(
      manager.list().map(async (connection) => {
        const status = manager.status(connection);
        let children: vscode.TreeItem[];
        if (connection.kind === "local") {
          // This machine and each cluster list the topology files here; a
          // file opened or run from a host's section runs on that host.
          children = (await this.discoverLabs(undefined, connection.id)) ?? [
            new c.ClabConnectionMessageNode(
              connection.id,
              "undeployed",
              "No topology files in this workspace"
            )
          ];
        } else if (status === "connected") {
          children = (await this.discoverRemoteLabs(connection)) ?? [
            new c.ClabConnectionMessageNode(connection.id, "undeployed", "No undeployed labs")
          ];
        } else {
          children = [
            new c.ClabConnectionMessageNode(
              connection.id,
              "undeployed",
              status === "offline" ? "Not reachable" : "Sign in to see its labs"
            )
          ];
        }
        return new c.ClabConnectionTreeNode(
          connection,
          "undeployed",
          status,
          children,
          manager.problem(connection)
        );
      })
    );
    return roots as unknown as c.ClabLabTreeNode[];
  }

  /** Topologies in the lab host's workspace that are not running. */
  private async discoverRemoteLabs(
    connection: LabConnection
  ): Promise<c.ClabLabTreeNode[] | undefined> {
    const manager = getConnections();
    if (!manager?.apiBackend(connection)) {
      return undefined;
    }
    let entries;
    try {
      entries = await manager.remoteTopologies(connection);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      outputChannel.warn(
        `[LocalTreeDataProvider] Listing labs on ${connection.label} failed: ${message}`
      );
      return undefined;
    }
    const running = new Set(Object.keys(ins.labsOf(connection.id) ?? {}));
    const filter = this.treeFilter ? FilterUtils.createFilter(this.treeFilter) : undefined;
    const nodes = entries
      // Dot files, like the temp files of a save in progress, as on this machine.
      .filter((entry) => !path.posix.basename(entry.yamlFileName).startsWith("."))
      .filter((entry) => !running.has(entry.labName))
      .map((entry) => {
        const folder = path.posix.dirname(entry.yamlFileName);
        const node = new c.ClabLabTreeNode(
          path.posix.basename(entry.yamlFileName),
          vscode.TreeItemCollapsibleState.None,
          {
            relative: entry.yamlFileName,
            absolute: remoteUri(connection, entry.yamlFileName).toString()
          },
          entry.labName,
          undefined,
          undefined,
          "containerlabLabUndeployed"
        );
        c.onConnection(node, connection.id);
        node.description = folder === "." ? "" : folder;
        node.tooltip = `${entry.labName} on ${connection.label}\n${entry.absolutePath ?? entry.yamlFileName}`;
        return node;
      })
      .filter((node) => !filter || filter(String(node.label)) || filter(node.labPath.relative))
      .sort((a, b) => a.labPath.relative.localeCompare(b.labPath.relative));
    return nodes.length > 0 ? nodes : undefined;
  }

  private async discoverLabs(
    dir?: string,
    connectionId?: string
  ): Promise<(c.ClabFolderTreeNode | c.ClabLabTreeNode)[] | undefined> {
    outputChannel.debug("[LocalTreeDataProvider] Discovering labs...");

    const uris = await this.getLabUris();
    const labs: Record<string, c.ClabLabTreeNode> = {};
    const labPaths = this.getLabPaths(connectionId ?? LOCAL_CONNECTION.id);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

    uris.forEach((uri) =>
      this.addLab(labs, labPaths, uri.fsPath, favoriteLabs.has(this.normalize(uri.fsPath)))
    );
    this.includeFavoriteLabs(uris, labs, labPaths);
    this.applyTreeFilter(labs, workspaceRoot);

    const dirPath = dir ?? workspaceRoot;
    const { labNodes, folderNodes } = this.collectNodes(labs, dirPath, workspaceRoot);

    labNodes.sort((a, b) => LocalLabTreeDataProvider.compareLabs(a, b));
    if (connectionId !== undefined) {
      for (const node of [...labNodes, ...folderNodes]) c.onConnection(node, connectionId);
    }

    const result: (c.ClabFolderTreeNode | c.ClabLabTreeNode)[] = [...labNodes, ...folderNodes];
    const isEmpty = result.length === 0 && dirPath === workspaceRoot;
    return isEmpty ? undefined : result;
  }

  private async getLabUris(): Promise<vscode.Uri[]> {
    if (!this.scanRequested) {
      this.scanRequested = true;
      await this.performScan();
    } else if (this.scanPromise) {
      await this.scanPromise;
    }
    if (this.cachedUris) {
      return Array.from(this.cachedUris.values());
    }
    return [];
  }

  private addLab(
    labs: Record<string, c.ClabLabTreeNode>,
    labPaths: Set<string>,
    filePath: string,
    isFavorite: boolean
  ): void {
    const normPath = this.normalize(filePath);
    if (path.basename(filePath).startsWith(".") || labPaths.has(normPath)) {
      return;
    }

    const contextVal = isFavorite
      ? "containerlabLabUndeployedFavorite"
      : "containerlabLabUndeployed";

    const labNode = new c.ClabLabTreeNode(
      path.basename(filePath),
      vscode.TreeItemCollapsibleState.None,
      {
        relative: filePath,
        absolute: normPath
      },
      undefined,
      undefined,
      undefined,
      contextVal,
      isFavorite
    );
    labNode.description = utils.getRelLabFolderPath(normPath);
    labs[normPath] = labNode;
  }

  private includeFavoriteLabs(
    uris: vscode.Uri[],
    labs: Record<string, c.ClabLabTreeNode>,
    labPaths: Set<string>
  ): void {
    const found = new Set(uris.map((u) => this.normalize(u.fsPath)));
    favoriteLabs.forEach((p) => {
      if (!found.has(this.normalize(p))) {
        this.addLab(labs, labPaths, p, true);
      }
    });
  }

  private applyTreeFilter(labs: Record<string, c.ClabLabTreeNode>, workspaceRoot: string): void {
    if (!this.treeFilter) {
      return;
    }
    const filter = FilterUtils.createFilter(this.treeFilter);
    for (const [p, node] of Object.entries(labs)) {
      const rel = path.relative(workspaceRoot, p);
      const lbl = node.label;
      if (!filter(lbl) && !filter(rel)) {
        delete labs[p];
      }
    }
  }

  private collectNodes(
    labs: Record<string, c.ClabLabTreeNode>,
    dirPath: string,
    workspaceRoot: string
  ): { labNodes: c.ClabLabTreeNode[]; folderNodes: c.ClabFolderTreeNode[] } {
    const folderSet = new Set<string>();
    const labNodes: c.ClabLabTreeNode[] = [];

    Object.values(labs).forEach((lab) => {
      const labDir = path.dirname(lab.labPath.absolute);
      if (labDir === dirPath) {
        labNodes.push(lab);
      } else if (dirPath === workspaceRoot && !labDir.startsWith(workspaceRoot)) {
        labNodes.push(lab);
      } else if (
        labDir.startsWith(dirPath + path.sep) ||
        (dirPath === workspaceRoot && labDir !== workspaceRoot && labDir.startsWith(dirPath))
      ) {
        const relative = path.relative(dirPath, labDir).split(path.sep)[0];
        folderSet.add(path.join(dirPath, relative));
      }
    });

    const folderNodes = Array.from(folderSet)
      .sort()
      .map((p) => new c.ClabFolderTreeNode(path.basename(p), p));
    return { labNodes, folderNodes };
  }

  private static compareLabs(a: c.ClabLabTreeNode, b: c.ClabLabTreeNode): number {
    if (a.favorite && !b.favorite) {
      return -1;
    }
    if (!a.favorite && b.favorite) {
      return 1;
    }
    const aPath = a.labPath.absolute;
    const bPath = b.labPath.absolute;
    return aPath.localeCompare(bPath);
  }

  // Parse clab inspect data and return a set of absolute labPaths.
  // Used to check if a locally discovered lab is deployed on a connection or not.
  private getLabPaths(connectionId: string) {
    const labPaths = new Set<string>();

    const data = ins.labsOf(connectionId);

    if (Array.isArray(data)) {
      // Old format: flat array of containers (for backward compatibility)
      data.forEach((container: unknown) => {
        if (!isRecord(container) || !isRecord(container.Labels)) {
          return;
        }
        const p = container.Labels["clab-topo-file"];
        if (typeof p === "string" && p.length > 0) {
          labPaths.add(p);
        }
      });
    } else if (data !== undefined && typeof data === "object") {
      // New format: object with lab names as keys
      Object.values(data).forEach((containers: c.ClabDetailedJSON[]) => {
        if (Array.isArray(containers) && containers.length > 0) {
          const p = containers[0].Labels["clab-topo-file"];
          if (typeof p === "string" && p.length > 0) {
            labPaths.add(p);
          }
        }
      });
    }

    return labPaths;
  }
}
