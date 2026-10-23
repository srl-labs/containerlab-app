import * as vscode from "vscode";

import { cloneRepoFromUrl } from "./cloneRepoCore";

/** Clones a lab repository; from a lab host's node in the explorer, onto that host. */
export async function cloneRepo(target?: unknown) {
  const choice = await vscode.window.showQuickPick(
    [
      { label: "Clone via Git URL", action: "url" },
      { label: "Clone popular lab", action: "popular" }
    ],
    { title: "Clone repository" }
  );

  if (!choice) {
    return;
  }

  if (choice.action === "url") {
    await cloneRepoFromUrl(undefined, target);
  } else if (choice.action === "popular") {
    const mod = await import("./clonePopularRepo");
    await mod.clonePopularRepo(target);
  }
}
