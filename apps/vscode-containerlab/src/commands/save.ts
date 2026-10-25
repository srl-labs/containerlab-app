// src/commands/save.ts
import * as vscode from "vscode";

import type { ClabContainerTreeNode, ClabLabTreeNode } from "../treeView/common";
import { labNameForPath, resolveLab } from "../backend/labBackends";

import { runWithProgress } from "./command";

async function saveConfiguration(
  labPath: string,
  labName: string,
  connectionId: string | undefined,
  nodeFilter?: string,
  copyDir?: string
): Promise<void> {
  const target = nodeFilter ? `node ${nodeFilter}` : `lab ${labName}`;
  const copied = copyDir ? ` and copied it to ${copyDir}` : "";
  await runWithProgress(
    async ({ output }) => {
      const lab = await resolveLab(labPath, labName, connectionId);
      const result = await lab.backend.save(lab.target, {
        ...(nodeFilter ? { nodeFilter } : {}),
        ...(copyDir ? { copyDir } : {})
      });
      for (const line of result.output.split("\n")) output(line, "stdout");
    },
    {
      spinnerMsg: {
        progressMsg: `Saving the configuration of ${target}...`,
        successMsg: `Saved the configuration of ${target}${copied}`
      },
      actionName: "save"
    }
  );
}

/**
 * Save the entire lab configuration (containerlab save).
 */
export async function saveLab(node: ClabLabTreeNode) {
  const labPath = node.labPath.absolute;
  if (labPath.length === 0) {
    vscode.window.showErrorMessage("No labPath found for the lab.");
    return;
  }
  void saveConfiguration(labPath, node.name ?? labNameForPath(labPath), node.connectionId);
}

/**
 * Save the configuration for a specific container node
 * (containerlab save --node-filter <shortNodeName>).
 */
export async function saveNode(node: ClabContainerTreeNode) {
  if (node.labPath.absolute.length === 0) {
    vscode.window.showErrorMessage("Error: Could not determine lab path for this node.");
    return;
  }
  // The short node name supports custom container name prefixes.
  const labPath = node.labPath.absolute;
  void saveConfiguration(
    labPath,
    node.labName ?? labNameForPath(labPath),
    node.connectionId,
    node.name_short
  );
}

/**
 * Save the lab configuration and copy the saved configs to a directory
 * (containerlab save --copy), relative to the topology file.
 */
export async function saveLabCopy(node: ClabLabTreeNode) {
  const labPath = node.labPath.absolute;
  if (labPath.length === 0) {
    vscode.window.showErrorMessage("No labPath found for the lab.");
    return;
  }
  const copyDir = await vscode.window.showInputBox({
    title: "Save configs to",
    prompt:
      "Directory for copies of the saved configs, relative to the topology file. Each save adds timestamped files per node.",
    value: "configs",
    validateInput: (value) => (value.trim() ? undefined : "Enter a directory")
  });
  if (!copyDir?.trim()) return;
  void saveConfiguration(
    labPath,
    node.name ?? labNameForPath(labPath),
    node.connectionId,
    undefined,
    copyDir.trim()
  );
}
