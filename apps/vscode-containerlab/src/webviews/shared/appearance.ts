import * as vscode from "vscode";

const webviews = new Set<WeakRef<vscode.Webview>>();
const tracked = new WeakSet<vscode.Webview>();
function readAppearance(): Record<string, unknown> {
  const config = vscode.workspace.getConfiguration("containerlab.appearance");
  return {
    colorScheme: config.get("colorScheme", "vscode"),
    fontSize: config.get("fontSize", 0),
    fontFamily: config.get("fontFamily", ""),
    reduceMotion: config.get("reduceMotion", false)
  };
}
export function appearanceBootstrap(webview: vscode.Webview): string {
  if (!tracked.has(webview)) {
    tracked.add(webview);
    webviews.add(new WeakRef(webview));
  }
  return `window.__CLAB_APPEARANCE__ = ${JSON.stringify(readAppearance()).replaceAll("<", "\\u003c")};`;
}
export function registerAppearanceUpdates(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("containerlab.appearance")) return;
      const appearance = readAppearance();
      for (const reference of webviews) {
        const webview = reference.deref();
        if (!webview) {
          webviews.delete(reference);
          continue;
        }
        void Promise.resolve(
          webview.postMessage({ type: "containerlab:appearance", appearance })
        ).catch(() => webviews.delete(reference));
      }
    })
  );
}
