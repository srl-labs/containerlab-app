import * as vscode from "vscode";

import type { ClabLabTreeNode } from "../treeView/common";
import { backendOf, isRemote, isUriString, labUri, rememberHostOf } from "../backend/labBackends";

export function openLabFile(node?: ClabLabTreeNode) {
  if (node === undefined) {
    vscode.window.showErrorMessage("No lab node selected.");
    return;
  }

  const labPath = node.labPath.absolute;
  if (labPath.length === 0) {
    vscode.window.showErrorMessage("No labPath found.");
    return;
  }

  if (isRemote(node) && !isUriString(labPath) && node.name !== undefined) {
    // A running lab whose topology is outside the host's workspace: show what it runs.
    void openRunningTopology(node, node.name);
    return;
  }
  // Opened from a lab host's section: the editor's lab commands run on that host.
  void rememberHostOf(node);
  vscode.commands.executeCommand("vscode.open", labUri(labPath));
}

async function openRunningTopology(node: ClabLabTreeNode, labName: string): Promise<void> {
  try {
    const content = await backendOf(node).runningTopologyYaml(labName);
    const document = await vscode.workspace.openTextDocument({ content, language: "yaml" });
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Cannot open the topology of ${labName}: ${message}`);
  }
}
