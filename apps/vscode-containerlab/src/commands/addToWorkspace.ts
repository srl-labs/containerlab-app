import * as path from "path";

import * as vscode from "vscode";

import type { ClabLabTreeNode } from "../treeView/common";
import { isUriString, labUri } from "../backend/labBackends";

export async function addLabFolderToWorkspace(node: ClabLabTreeNode): Promise<void> {
  if (!node.labPath.absolute) {
    vscode.window.showErrorMessage("No lab path found for this lab");
    return;
  }

  // Get the folder that contains the .clab.yaml
  const labPath = node.labPath.absolute;
  const folderUri = isUriString(labPath)
    ? vscode.Uri.joinPath(labUri(labPath), "..")
    : vscode.Uri.file(path.dirname(labPath));

  // Add it to the current workspace
  const existingCount = vscode.workspace.workspaceFolders
    ? vscode.workspace.workspaceFolders.length
    : 0;

  vscode.workspace.updateWorkspaceFolders(existingCount, null, {
    uri: folderUri,
    name: node.label // or any other display name
  });

  vscode.window.showInformationMessage(`Added "${node.name}" to your workspace.`);
}
