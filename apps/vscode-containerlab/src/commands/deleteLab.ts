import * as fs from "fs";
import * as path from "path";

import * as vscode from "vscode";

import type { ClabLabTreeNode } from "../treeView/common";
import { favoriteLabs, extensionContext } from "../globals";
import { isUriString, labUri } from "../backend/labBackends";

export async function deleteLab(node: ClabLabTreeNode) {
  const filePath = node.labPath.absolute;
  if (filePath.length === 0) {
    vscode.window.showErrorMessage("No lab file found.");
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete lab "${isUriString(filePath) ? path.posix.basename(labUri(filePath).path) : path.basename(filePath)}"? This action cannot be undone.`,
    { modal: true },
    "Delete"
  );
  if (confirm !== "Delete") {
    return;
  }

  try {
    if (isUriString(filePath)) {
      await vscode.workspace.fs.delete(labUri(filePath), { useTrash: false });
    } else {
      await fs.promises.unlink(filePath);
    }
    favoriteLabs.delete(filePath);
    await extensionContext.globalState.update("favoriteLabs", Array.from(favoriteLabs));
    vscode.window.showInformationMessage(`Deleted lab file ${node.label}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to delete lab: ${msg}`);
  }
}
