/**
 * The labs overview as an editor tab: a card per running lab and per topology
 * file nobody deployed, with thumbnails and live CPU and memory. The cards
 * follow the explorer's labs; the webview asks for topology files and usage.
 */
import * as path from "path";

import * as vscode from "vscode";
import type {
  LabOverviewCard,
  LabThumbnailSources,
  LabsOverviewIncomingMessage,
  LabsOverviewOutgoingMessage
} from "@containerlab/clab-ui/labs-overview/cards";
import { errorStatus } from "@srl-labs/containerlab-lab-backend";

import { LOCAL_CONNECTION, type LabConnection } from "../backend/connections";
import { backendFor, connectionById, getConnections, labUri } from "../backend/labBackends";
import { outputChannel } from "../globals";
import * as c from "../treeView/common";
import {
  buildOverviewCards,
  overviewCardId,
  overviewHostMetrics,
  overviewLabHosts,
  type OverviewContainer,
  type OverviewRunningLab,
  type OverviewTopologyFile
} from "../webviews/labsOverview/labsOverviewCards";
import { LABS_OVERVIEW_PANEL, createPanelWebviewHtml } from "../webviews/shared/webviewPanels";

/** The explorer's lab trees. */
interface LabTreeProvider {
  getChildren(element?: vscode.TreeItem): unknown;
  readonly onDidChangeTreeData: vscode.Event<unknown>;
}

export interface LabsOverviewProviders {
  runningProvider: LabTreeProvider;
  localProvider: LabTreeProvider;
}

const REFRESH_DELAY_MS = 300;
const NO_STATS =
  "This lab host does not report node CPU and memory usage. Update clab-api-server to see it.";

let current: LabsOverviewPanel | undefined;

export function openLabsOverview(
  context: vscode.ExtensionContext,
  providers: LabsOverviewProviders
): void {
  if (current) {
    current.reveal();
    return;
  }
  current = new LabsOverviewPanel(context.extensionUri, providers, () => {
    current = undefined;
  });
}

/** Labs in a tree, through connection roots and folders, not into the labs' nodes. */
async function collectLabNodes(
  provider: LabTreeProvider,
  element?: vscode.TreeItem
): Promise<c.ClabLabTreeNode[]> {
  const children: unknown = await provider.getChildren(element);
  const labs: c.ClabLabTreeNode[] = [];
  for (const child of Array.isArray(children) ? (children as unknown[]) : []) {
    if (child instanceof c.ClabLabTreeNode) labs.push(child);
    else if (child instanceof c.ClabConnectionTreeNode || child instanceof c.ClabFolderTreeNode) {
      labs.push(...(await collectLabNodes(provider, child)));
    }
  }
  return labs;
}

function connectionOfNode(node: c.ClabLabTreeNode): LabConnection {
  return connectionById(node.connectionId) ?? LOCAL_CONNECTION;
}

function containersOf(node: c.ClabLabTreeNode): OverviewContainer[] {
  const containers: OverviewContainer[] = [];
  for (const entry of node.containers ?? []) {
    const nodes = entry instanceof c.ClabContainerGroupTreeNode ? entry.children : [entry];
    for (const container of nodes) {
      containers.push({
        nodeName: container.name_short || container.name,
        state: container.state,
        status: container.status ?? ""
      });
    }
  }
  return containers;
}

function topologyName(node: c.ClabLabTreeNode): string {
  return node.name ?? path.posix.basename(node.labPath.relative).replace(/\.clab\.ya?ml$/i, "");
}

async function readText(pathOrUri: string): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(labUri(pathOrUri)));
}

class LabsOverviewPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly nodes = new Map<string, c.ClabLabTreeNode>();
  private readonly streams = new Map<number, AbortController>();
  private readonly disposables: vscode.Disposable[] = [];
  private cards: LabOverviewCard[] = [];
  private loaded = false;
  private sourcesRevision = 0;
  private lastSent = "";
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  /** Listing files can ask a lab host, so it waits for the file tree to change. */
  private fileNodes: Promise<c.ClabLabTreeNode[]> | undefined;

  constructor(
    extensionUri: vscode.Uri,
    private readonly providers: LabsOverviewProviders,
    private readonly onDispose: () => void
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "clabLabsOverview",
      "Labs Overview",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "dist"),
          vscode.Uri.joinPath(extensionUri, "resources")
        ]
      }
    );
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, "resources", "containerlab.svg");
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: LabsOverviewOutgoingMessage) =>
        this.onMessage(message)
      ),
      // A hidden tab drops its page, and with it the usage streams it watched.
      this.panel.onDidChangeViewState(() => {
        if (!this.panel.visible) this.stopStreams();
      }),
      this.panel.onDidDispose(() => this.dispose()),
      providers.runningProvider.onDidChangeTreeData(() => this.scheduleRefresh()),
      // Signing in or out of a lab host changes what its tile shows.
      getConnections()?.onDidChange(() => this.postState()) ??
        new vscode.Disposable(() => undefined),
      providers.localProvider.onDidChangeTreeData(() => {
        this.sourcesRevision += 1;
        this.fileNodes = undefined;
        this.scheduleRefresh();
      })
    );
    this.panel.webview.html = createPanelWebviewHtml(
      LABS_OVERVIEW_PANEL,
      this.panel.webview,
      extensionUri,
      {}
    );
    void this.refresh();
  }

  reveal(): void {
    this.panel.reveal();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, REFRESH_DELAY_MS);
  }

  private async refresh(): Promise<void> {
    try {
      this.fileNodes ??= collectLabNodes(this.providers.localProvider);
      const [runningNodes, fileNodes] = await Promise.all([
        collectLabNodes(this.providers.runningProvider),
        this.fileNodes
      ]);
      this.nodes.clear();
      const running: OverviewRunningLab[] = runningNodes.map((node) => {
        const connection = connectionOfNode(node);
        const lab: OverviewRunningLab = {
          connection,
          labName: node.name ?? String(node.label),
          path: node.labPath.absolute || undefined,
          owner: node.owner,
          containers: containersOf(node)
        };
        this.nodes.set(overviewCardId(connection.id, lab.path ?? `lab:${lab.labName}`), node);
        return lab;
      });
      const files: OverviewTopologyFile[] = fileNodes.map((node) => {
        const connection = connectionOfNode(node);
        const id = overviewCardId(connection.id, node.labPath.absolute);
        if (!this.nodes.has(id)) this.nodes.set(id, node);
        return { connection, name: topologyName(node), path: node.labPath.absolute };
      });
      this.cards = buildOverviewCards(running, files, Date.now());
      this.loaded = true;
      this.postState();
    } catch (error) {
      this.fileNodes = undefined;
      outputChannel.warn(
        `[Labs overview] Listing labs failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private post(message: LabsOverviewIncomingMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private postState(force = false): void {
    const message: LabsOverviewIncomingMessage = {
      type: "labs-overview:state",
      cards: this.cards,
      loading: !this.loaded,
      showEndpoints: getConnections()?.grouped === true,
      labHosts: overviewLabHosts(getConnections(), LOCAL_CONNECTION),
      sourcesRevision: this.sourcesRevision
    };
    // Uptimes move with the clock; compare without them so a quiet refresh sends nothing.
    const key = JSON.stringify(message, (field, value: unknown) =>
      field === "startedAt" ? undefined : value
    );
    if (!force && key === this.lastSent) return;
    this.lastSent = key;
    this.post(message);
  }

  private onMessage(message: LabsOverviewOutgoingMessage): void {
    switch (message.type) {
      case "labs-overview:ready":
        // A new page: the old one's streams are gone.
        this.stopStreams();
        this.postState(true);
        break;
      case "labs-overview:action":
        this.runAction(message.action, message.cardId);
        break;
      case "labs-overview:create-lab":
        void vscode.commands.executeCommand("containerlab.editor.topoViewerEditor");
        break;
      case "labs-overview:load-sources":
        void this.loadSources(message.cardId).then((sources) =>
          this.post({ type: "labs-overview:sources", requestId: message.requestId, sources })
        );
        break;
      case "labs-overview:host-metrics":
        void overviewHostMetrics(() =>
          backendFor(connectionById(message.endpointId) ?? LOCAL_CONNECTION)
        ).then((result) =>
          this.post({ type: "labs-overview:host-metrics", requestId: message.requestId, ...result })
        );
        break;
      case "labs-overview:usage-start":
        this.startStream(
          message.streamId,
          message.endpointId,
          message.labName,
          message.intervalSeconds
        );
        break;
      case "labs-overview:usage-stop":
        this.streams.get(message.streamId)?.abort();
        this.streams.delete(message.streamId);
        break;
      default:
        break;
    }
  }

  private runAction(action: "open" | "deploy" | "destroy", cardId: string): void {
    const node = this.nodes.get(cardId);
    if (!node) return;
    const command = {
      open: "containerlab.lab.graph.topoViewer",
      deploy: "containerlab.lab.deploy",
      destroy: "containerlab.lab.destroy"
    }[action];
    void vscode.commands.executeCommand(command, node);
  }

  private async loadSources(cardId: string): Promise<LabThumbnailSources | undefined> {
    const filePath = this.cards.find((card) => card.id === cardId)?.path;
    if (filePath === undefined) return undefined;
    try {
      const yaml = await readText(filePath);
      const annotations = await readText(`${filePath}.annotations.json`).catch(() => undefined);
      return { yaml, annotations };
    } catch {
      return undefined;
    }
  }

  private startStream(
    streamId: number,
    connectionId: string,
    labName: string,
    intervalSeconds: number
  ): void {
    const controller = new AbortController();
    this.streams.set(streamId, controller);
    const { signal } = controller;
    const end = (error?: string, status?: number) => {
      if (signal.aborted) return;
      this.streams.delete(streamId);
      this.post({ type: "labs-overview:usage", streamId, end: true, error, status });
    };
    void (async () => {
      try {
        const connection = connectionById(connectionId) ?? LOCAL_CONNECTION;
        const backend = backendFor(connection);
        if (!(await backend.features()).nodeStats) {
          end(NO_STATS, 501);
          return;
        }
        const samples = await backend.streamLabStats(labName, { intervalSeconds, signal });
        for await (const sample of samples) {
          if (signal.aborted) return;
          this.post({ type: "labs-overview:usage", streamId, sample });
        }
        end();
      } catch (error) {
        end(error instanceof Error ? error.message : String(error), errorStatus(error));
      }
    })();
  }

  private stopStreams(): void {
    for (const controller of this.streams.values()) controller.abort();
    this.streams.clear();
  }

  private dispose(): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.stopStreams();
    for (const disposable of this.disposables) disposable.dispose();
    this.onDispose();
  }
}
