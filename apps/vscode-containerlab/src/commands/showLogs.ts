import * as vscode from "vscode";

import type { ClabContainerTreeNode } from "../treeView/common";
import { isRemoteNode, showRemoteLogs } from "../backend/remoteNode";

import { execCommandInTerminal } from "./command";

export function showLogs(node?: ClabContainerTreeNode) {
  if (node === undefined) {
    vscode.window.showErrorMessage("No container node selected.");
    return;
  }
  const containerId = node.cID;

  if (!containerId) {
    vscode.window.showErrorMessage("No containerID for logs.");
    return;
  }

  const container = node.name || containerId;
  if (isRemoteNode()) {
    void showRemoteLogs(node);
    return;
  }

  const config = vscode.workspace.getConfiguration("containerlab");
  const runtime = config.get<string>("runtime", "docker");
  execCommandInTerminal(`${runtime} logs -f ${containerId}`, `Logs - ${container}`);
}
