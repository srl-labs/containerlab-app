import * as path from "path";

import * as vscode from "vscode";

import type { ClabLabTreeNode } from "../treeView/common";
import { isUriString, labUri } from "../backend/labBackends";

export async function openFolderInNewWindow(node: ClabLabTreeNode) {
  if (!node.labPath.absolute) {
    vscode.window.showErrorMessage("No lab path found for this lab.");
    return;
  }

  // The folder that contains the .clab.(yml|yaml)
  const labPath = node.labPath.absolute;
  const uri = isUriString(labPath)
    ? vscode.Uri.joinPath(labUri(labPath), "..")
    : vscode.Uri.file(path.dirname(labPath));

  // Force opening that folder in a brand-new window
  await vscode.commands.executeCommand("vscode.openFolder", uri, {
    forceNewWindow: true
  });
}
