// src/commands/save.ts
import * as vscode from "vscode";

import type { ClabContainerTreeNode, ClabLabTreeNode } from "../treeView/common";
import { getLabBackend, labNameForPath, labTargetForPath } from "../backend/labBackends";

import { runWithProgress } from "./command";

async function saveConfiguration(
  labPath: string,
  labName: string,
  nodeFilter?: string
): Promise<void> {
  const backend = getLabBackend();
  const target = nodeFilter ? `node ${nodeFilter}` : `lab ${labName}`;
  await runWithProgress(
    async ({ output }) => {
      const result = await backend.save(
        labTargetForPath(labPath, labName),
        nodeFilter ? { nodeFilter } : {}
      );
      for (const line of result.output.split("\n")) output(line, "stdout");
    },
    {
      spinnerMsg: {
        progressMsg: `Saving the configuration of ${target}...`,
        successMsg: `Saved the configuration of ${target}`
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
  void saveConfiguration(labPath, node.name ?? labNameForPath(labPath));
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
  void saveConfiguration(labPath, labNameForPath(labPath), node.name_short);
}
