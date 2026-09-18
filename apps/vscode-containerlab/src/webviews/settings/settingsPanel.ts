import * as vscode from "vscode";
import { isSettingsRecord, type SettingsTarget } from "@containerlab/clab-ui/settings/schema";
import { createReactWebviewHtml } from "../shared/reactWebviewHtml";
import { SettingsService } from "./settingsService";

export function registerSettings(context: vscode.ExtensionContext): void {
  const service = new SettingsService(context);
  let panel: vscode.WebviewPanel | undefined;
  let target: SettingsTarget = "user";
  let pending: Promise<void> = Promise.resolve();
  const publish = () =>
    panel?.webview.postMessage({ type: "settings:snapshot", snapshot: service.snapshot(target) });
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("containerlab")) void publish();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (!vscode.workspace.workspaceFolders?.length && !vscode.workspace.workspaceFile)
        target = "user";
      void publish();
    }),
    vscode.commands.registerCommand("containerlab.settings.open", () => {
      if (panel) {
        panel.reveal();
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
      current.webview.html = createReactWebviewHtml({
        webview: current.webview,
        extensionUri: context.extensionUri,
        scriptFile: "settingsWebview.js",
        title: "Containerlab Settings",
        initialData: service.snapshot(target),
        webviewKind: "containerlab-settings"
      });
    }),
    { dispose: () => panel?.dispose() }
  );
}
