import * as vscode from "vscode";
import type { NodeLifecycleAction } from "@srl-labs/containerlab-lab-backend";

import type { ClabContainerTreeNode } from "../treeView/common";
import { connectionOf, labNameForPath, resolveLab } from "../backend/labBackends";
import { outputChannel } from "../globals";

import { runWithProgress } from "./command";
import {
  createTopoViewerLifecycleHandlers,
  notifyCurrentTopoViewerOfCommandFailure
} from "./graph";
import { ensureHostSupports } from "../backend/labHostSupport";

type TopologyNodeLifecycleAction = "start" | "stop" | "restart";

async function runNodeAction(
  action: Extract<NodeLifecycleAction, "pause" | "unpause">,
  node?: ClabContainerTreeNode
): Promise<void> {
  if (node === undefined) {
    vscode.window.showErrorMessage("No container node selected.");
    return;
  }

  if (!node.cID || !node.labPath.absolute) {
    vscode.window.showErrorMessage("No containerId found.");
    return;
  }
  if (!(await ensureHostSupports(connectionOf(node), "nodePause", "Pausing nodes"))) return;

  try {
    const { backend } = await resolveLab(node.labPath.absolute, node.labName, node.connectionId);
    await backend.nodeAction(
      node.labName ?? labNameForPath(node.labPath.absolute),
      node.name,
      action
    );
    vscode.window.showInformationMessage(
      `${action === "pause" ? "Paused" : "Unpaused"} ${node.name}`
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.error(`Failed to ${action} ${node.name}: ${message}`);
    vscode.window.showErrorMessage(`Failed to ${action} container: ${message}`);
  }
}

export async function startNode(node?: ClabContainerTreeNode): Promise<void> {
  await runTopologyNodeLifecycleAction("start", node);
}

export async function stopNode(node?: ClabContainerTreeNode): Promise<void> {
  await runTopologyNodeLifecycleAction("stop", node);
}

export async function restartNode(node?: ClabContainerTreeNode): Promise<void> {
  await runTopologyNodeLifecycleAction("restart", node);
}

export async function pauseNode(node?: ClabContainerTreeNode): Promise<void> {
  await runNodeAction("pause", node);
}

export async function unpauseNode(node?: ClabContainerTreeNode): Promise<void> {
  await runNodeAction("unpause", node);
}

function resolveTopologyNodeName(node: ClabContainerTreeNode): string {
  if (typeof node.rootNodeName === "string" && node.rootNodeName.trim().length > 0) {
    return node.rootNodeName;
  }

  if (node.name_short.trim().length > 0) {
    return node.name_short;
  }

  return node.name;
}

async function runTopologyNodeLifecycleAction(
  action: TopologyNodeLifecycleAction,
  node?: ClabContainerTreeNode
): Promise<void> {
  if (node === undefined) {
    const error = new Error("No container node selected.");
    vscode.window.showErrorMessage(error.message);
    await notifyCurrentTopoViewerOfCommandFailure(action, error);
    return;
  }

  const nodeName = resolveTopologyNodeName(node).trim();
  if (!nodeName) {
    const error = new Error("No topology node name found.");
    vscode.window.showErrorMessage(error.message);
    await notifyCurrentTopoViewerOfCommandFailure(action, error, node.labPath.absolute);
    return;
  }

  if (!node.labPath.absolute) {
    const error = new Error("No lab path found.");
    vscode.window.showErrorMessage(error.message);
    await notifyCurrentTopoViewerOfCommandFailure(action, error);
    return;
  }

  const labPath = node.labPath.absolute;
  const handlers = createTopoViewerLifecycleHandlers(action, { labPath });
  const labName = node.labName ?? labNameForPath(labPath);
  const containerName = node.name;
  await runWithProgress(
    async () => {
      const { backend } = await resolveLab(labPath, labName, node.connectionId);
      await backend.nodeAction(labName, containerName, action);
    },
    {
      spinnerMsg: {
        progressMsg: `Running ${action} on ${nodeName}...`,
        successMsg: `${action} of ${nodeName} completed successfully`
      },
      actionName: action,
      onSuccess: handlers.onSuccess,
      onFailure: handlers.onFailure,
      onOutputLine: handlers.onOutputLine
    }
  );
}
