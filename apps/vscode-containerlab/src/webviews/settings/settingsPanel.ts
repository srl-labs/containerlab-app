import * as vscode from "vscode";
import { isSettingsRecord, type SettingsTarget } from "@containerlab/clab-ui/settings/schema";
import { SETTINGS_PANEL, createPanelWebviewHtml } from "../shared/webviewPanels";
import { SettingsService } from "./settingsService";
import { handleLabHostsAction, isLabHostsAction } from "./labHostsService";

/** Sends the open settings page the current settings, e.g. after a lab host signed in. */
let publishSettings: (() => void) | undefined;
export function refreshSettingsPanel(): void {
  publishSettings?.();
}

export function registerSettings(context: vscode.ExtensionContext): void {
  const service = new SettingsService(context);
  let panel: vscode.WebviewPanel | undefined;
  let target: SettingsTarget = "user";
  let pending: Promise<void> = Promise.resolve();
  const publish = (category?: string) =>
    panel?.webview.postMessage({
      type: "settings:snapshot",
      snapshot: { ...service.snapshot(target), ...(category !== undefined ? { category } : {}) }
    });
  publishSettings = () => void publish();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("containerlab")) void publish();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (!vscode.workspace.workspaceFolders?.length && !vscode.workspace.workspaceFile)
        target = "user";
      void publish();
    }),
    vscode.commands.registerCommand("containerlab.settings.open", (category?: unknown) => {
      const page = typeof category === "string" ? category : undefined;
      if (panel) {
        panel.reveal();
        if (page !== undefined) void publish(page);
        return;
      }
      const current = vscode.window.createWebviewPanel(
        "containerlabSettings",
        "Containerlab Settings",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")]
        }
      );
      panel = current;
      current.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "containerlab.png");
      const listener = current.webview.onDidReceiveMessage((message: unknown) => {
        if (
          !isSettingsRecord(message) ||
          message.type !== "settings:request" ||
          typeof message.id !== "string"
        )
          return;
        pending = pending.then(async () => {
          try {
            let result: unknown;
            // The Lab Hosts page: health stats, or the new settings after a change.
            if (isLabHostsAction(message.action)) {
              result = (await handleLabHostsAction(message)) ?? service.snapshot(target);
            } else {
              switch (message.action) {
                case "read": {
                  if (message.target !== "user" && message.target !== "workspace")
                    throw new Error("Invalid settings scope.");
                  result = service.snapshot(message.target);
                  target = message.target;
                  break;
                }
                case "change":
                  result = await service.change(message.change);
                  break;
                case "native":
                  await vscode.commands.executeCommand(
                    "workbench.action.openSettings",
                    "@ext:srl-labs.vscode-containerlab"
                  );
                  break;
                case "colorTheme":
                  await vscode.commands.executeCommand("workbench.action.selectTheme");
                  break;
                case "reload":
                  await vscode.commands.executeCommand("workbench.action.reloadWindow");
                  break;
                default:
                  throw new Error("Unsupported settings action.");
              }
            }
            await current.webview.postMessage({
              type: "settings:response",
              id: message.id,
              result
            });
          } catch (error) {
            await current.webview.postMessage({
              type: "settings:response",
              id: message.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        });
      });
      current.onDidDispose(() => {
        listener.dispose();
        if (panel === current) panel = undefined;
      });
      current.webview.html = createPanelWebviewHtml(
        SETTINGS_PANEL,
        current.webview,
        context.extensionUri,
        { ...service.snapshot(target), ...(page !== undefined ? { category: page } : {}) }
      );
    }),
    { dispose: () => panel?.dispose() }
  );
}
