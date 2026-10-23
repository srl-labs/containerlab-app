import * as vscode from "vscode";

import { pickPopularRepo } from "../helpers/popularLabs";
import { ClabLabTreeNode, onConnection } from "../treeView/common";
import { connectionOf } from "../backend/labBackends";
import { LOCAL_CONNECTION } from "../backend/connections";

import { runClabAction } from "./runClabAction";

/** Deploys a popular lab repository, where `target` (a tree node) runs; Local without one. */
export async function deployPopularLab(target?: unknown) {
  const connectionId = target === undefined ? LOCAL_CONNECTION.id : connectionOf(target).id;
  const pick = await pickPopularRepo("Deploy popular lab", "Select a repository to deploy");
  if (!pick) {
    return;
  }
  const node = onConnection(
    new ClabLabTreeNode("", vscode.TreeItemCollapsibleState.None, {
      absolute: pick.repo,
      relative: ""
    }),
    connectionId
  );
  // Call runClabAction directly to avoid circular dependency with deploy.ts
  await runClabAction("deploy", node);
}
