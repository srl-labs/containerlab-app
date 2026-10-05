import * as vscode from "vscode";

export function openTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap((group) => group.tabs);
}

function describeTabs(): string {
  return openTabs()
    .map((tab) => {
      const input = tab.input instanceof vscode.TabInputWebview ? tab.input.viewType : "other";
      return `${tab.label}:${input}`;
    })
    .join(", ");
}

/** Resolves with the first tab matching the predicate, re-checking on every tab change. */
export function waitForTab(
  predicate: (tab: vscode.Tab) => boolean,
  description: string,
  timeoutMs = 30000
): Promise<vscode.Tab> {
  const existing = openTabs().find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve, reject) => {
    const subscription = vscode.window.tabGroups.onDidChangeTabs(() => {
      const tab = openTabs().find(predicate);
      if (tab) {
        clearTimeout(timer);
        subscription.dispose();
        resolve(tab);
      }
    });
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error(`Timed out waiting for ${description}. Open tabs: ${describeTabs()}`));
    }, timeoutMs);
  });
}
