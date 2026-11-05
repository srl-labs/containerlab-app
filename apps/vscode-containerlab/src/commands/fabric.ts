/**
 * The Fabric view of a lab, in an editor tab: incidents, history and reports
 * from the lab's fcling engine. The engine runs on the lab's host and keeps
 * running when the tab closes, so that the history goes on.
 */
import * as vscode from "vscode";
import type {
  FabricIncomingMessage,
  FabricOutgoingMessage,
  FabricWebviewRequest
} from "@containerlab/clab-ui/fabric/engine";
import { errorStatus, type LabBackend } from "@srl-labs/containerlab-lab-backend";

import { connectionOf, resolveLab, type ResolvedLab } from "../backend/labBackends";
import { ensureHostSupports } from "../backend/labHostSupport";
import type { ClabLabTreeNode } from "../treeView/common";
import { FABRIC_PANEL, createPanelWebviewHtml } from "../webviews/shared/webviewPanels";

const panels = new Map<string, FabricPanel>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the engine's error body says, or its status. */
function engineError(status: number, body: unknown): string {
  if (body !== null && typeof body === "object" && "error" in body) {
    return String((body as { error: unknown }).error);
  }
  return `The fabric engine answered ${status}.`;
}

class FabricPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly backend: LabBackend;
  private readonly target: ResolvedLab["target"];
  private readonly streams = new Map<number, AbortController>();

  constructor(
    extensionUri: vscode.Uri,
    lab: ResolvedLab,
    private readonly onDispose: () => void
  ) {
    this.backend = lab.backend;
    this.target = lab.target;
    const { labName } = lab.target;
    this.panel = vscode.window.createWebviewPanel(
      "clabFabric",
      `Fabric: ${labName}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        // A hidden tab keeps the view it was on, and its place in the event stream.
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "dist"),
          vscode.Uri.joinPath(extensionUri, "resources")
        ]
      }
    );
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, "resources", "containerlab.svg");
    this.panel.webview.onDidReceiveMessage((message: FabricOutgoingMessage) =>
      this.onMessage(message)
    );
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.html = createPanelWebviewHtml(
      FABRIC_PANEL,
      this.panel.webview,
      extensionUri,
      {
        labName
      }
    );
  }

  reveal(): void {
    this.panel.reveal();
  }

  private post(message: FabricIncomingMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private onMessage(message: FabricOutgoingMessage): void {
    switch (message.type) {
      case "fabric:request":
        void this.answer(message.requestId, message);
        break;
      case "fabric:events-start":
        void this.follow(message.streamId, message.after);
        break;
      case "fabric:events-stop":
        this.streams.get(message.streamId)?.abort();
        this.streams.delete(message.streamId);
        break;
    }
  }

  private perform(request: FabricWebviewRequest): Promise<unknown> {
    switch (request.op) {
      case "engine-status":
        return this.backend.fclingEngine(this.target);
      case "engine-start":
        return this.backend.startFclingEngine(this.target);
      case "engine-stop":
        return this.backend.stopFclingEngine(this.target);
      case "api":
        return this.backend.fclingApi(this.target, request.request).then(({ status, body }) => {
          if (status < 400) return body;
          throw Object.assign(new Error(engineError(status, body)), { status });
        });
    }
  }

  private async answer(requestId: number, request: FabricWebviewRequest): Promise<void> {
    try {
      this.post({ type: "fabric:response", requestId, result: await this.perform(request) });
    } catch (error) {
      const status = errorStatus(error);
      this.post({
        type: "fabric:response",
        requestId,
        error: errorMessage(error),
        ...(status === undefined ? {} : { status })
      });
    }
  }

  private async follow(streamId: number, after: number | undefined): Promise<void> {
    const controller = new AbortController();
    this.streams.set(streamId, controller);
    const { signal } = controller;
    let failure: string | undefined;
    try {
      const events = await this.backend.streamFclingEvents(this.target, {
        signal,
        ...(after === undefined ? {} : { after })
      });
      this.post({ type: "fabric:events-open", streamId });
      for await (const event of events) {
        if (signal.aborted) return;
        this.post({ type: "fabric:event", streamId, event });
      }
    } catch (error) {
      failure = errorMessage(error);
    }
    if (signal.aborted) return;
    this.streams.delete(streamId);
    this.post({
      type: "fabric:events-end",
      streamId,
      ...(failure === undefined ? {} : { error: failure })
    });
  }

  private dispose(): void {
    for (const stream of this.streams.values()) stream.abort();
    this.streams.clear();
    this.onDispose();
  }
}

export async function openFabricView(node: ClabLabTreeNode | undefined): Promise<void> {
  if (!node) {
    void vscode.window.showErrorMessage("No lab node selected.");
    return;
  }
  if (!(await ensureHostSupports(connectionOf(node), "fcling", "The Fabric view"))) return;
  const extensionUri = vscode.extensions.getExtension("srl-labs.vscode-containerlab")?.extensionUri;
  if (!extensionUri) {
    void vscode.window.showErrorMessage(
      "Unable to open the Fabric view because extension resources are unavailable."
    );
    return;
  }
  try {
    const resolved = await resolveLab(node.labPath.absolute, node.name, node.connectionId);
    // A lab on this machine resolves to its topology file; the tab goes by the name it runs under.
    const lab = {
      ...resolved,
      target: { ...resolved.target, labName: resolved.target.labName || (node.name ?? "") }
    };
    const key = `${node.connectionId ?? "local"}\0${lab.target.labName}`;
    const open = panels.get(key);
    if (open) {
      open.reveal();
      return;
    }
    panels.set(
      key,
      new FabricPanel(extensionUri, lab, () => {
        panels.delete(key);
      })
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not open the Fabric view: ${errorMessage(error)}`);
  }
}
