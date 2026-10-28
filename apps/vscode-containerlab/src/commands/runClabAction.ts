import * as vscode from "vscode";
import { isPartialDestroy, type LabLifecycleOptions } from "@containerlab/clab-ui/host";

import { isClusterConnection, LOCAL_CONNECTION, type LabConnection } from "../backend/connections";
import { connectionById, isLabSourceUrl, labNameForPath } from "../backend/labBackends";
import { labHostInfo } from "../backend/labHostSupport";
import { lifecycleOptionsWithLabSettings } from "../backend/labSettings";
import { topologyHostFor } from "../backend/topologyHost";
import type { ClabLabTreeNode } from "../treeView/common";
import { getSelectedLabNode } from "../utils/utils";

import { ClabCommand } from "./clabCommand";
import {
  createTopoViewerLifecycleHandlers,
  notifyCurrentTopoViewerOfCommandFailure,
  type LifecycleCommandType
} from "./graph";

export type LabLifecycleAction = LifecycleCommandType;

/** How the prompts and notifications name each action. */
const ACTION_VERBS: Record<LabLifecycleAction, { title: string; progress: string; done: string }> =
  {
    deploy: { title: "Deploy", progress: "Deploying", done: "Deployed" },
    destroy: { title: "Destroy", progress: "Destroying", done: "Destroyed" },
    redeploy: { title: "Redeploy", progress: "Redeploying", done: "Redeployed" },
    apply: { title: "Apply", progress: "Applying", done: "Applied" },
    start: { title: "Start", progress: "Starting", done: "Started" },
    stop: { title: "Stop", progress: "Stopping", done: "Stopped" },
    restart: { title: "Restart", progress: "Restarting", done: "Restarted" }
  };

/** Without options of its own, deploy, redeploy, destroy and apply use the lab's settings on the host. */
async function withLabSettings(
  action: LabLifecycleAction,
  lifecycleOptions: LabLifecycleOptions | undefined,
  host: LabConnection,
  labPath: string
): Promise<LabLifecycleOptions | undefined> {
  if (action !== "deploy" && action !== "redeploy" && action !== "destroy" && action !== "apply") {
    return lifecycleOptions;
  }
  const runtime =
    (await labHostInfo(host))?.profile.runtime ?? (isClusterConnection(host) ? "c9s" : "docker");
  return lifecycleOptionsWithLabSettings(action, lifecycleOptions, {
    connectionId: host.id,
    labPath,
    runtime
  });
}

export async function runClabAction(
  action: LabLifecycleAction,
  node?: ClabLabTreeNode,
  cleanup = false,
  lifecycleOptions?: LabLifecycleOptions
): Promise<void> {
  node = await getSelectedLabNode(node);
  if (!node) {
    await notifyCurrentTopoViewerOfCommandFailure(action, new Error("No lab node selected"));
    return;
  }
  // A topology runs on the host whose section it came from, or the one it was
  // opened from or deployed to; without one, the user picks when clusters exist.
  const labPath = node.labPath.absolute;
  const labName = node.name ?? labNameForPath(labPath);
  const host = isLabSourceUrl(labPath)
    ? (connectionById(node.connectionId) ?? LOCAL_CONNECTION)
    : await topologyHostFor(labPath, labName, ACTION_VERBS[action].title, node.connectionId);
  if (!host) {
    await notifyCurrentTopoViewerOfCommandFailure(
      action,
      new Error("Operation cancelled by user"),
      labPath
    );
    return;
  }
  const options = await withLabSettings(action, lifecycleOptions, host, labPath);
  const where = isLabSourceUrl(labPath) ? labPath : labName;
  const spinnerMsg = {
    progressMsg: `${ACTION_VERBS[action].progress} ${where} on ${host.label}...`,
    successMsg: `${ACTION_VERBS[action].done} ${where} on ${host.label}`
  };

  const execute = async () => {
    const handlers = createTopoViewerLifecycleHandlers(action, {
      // Destroying some nodes leaves the rest of the lab running.
      labKeepsRunning: action === "destroy" && isPartialDestroy(options),
      labPath
    });
    const cmd = new ClabCommand(
      action,
      node,
      spinnerMsg,
      handlers.onSuccess,
      handlers.onFailure,
      handlers.onOutputLine
    );
    if (cleanup || options) {
      await cmd.run({
        connectionId: host.id,
        ...(cleanup ? { cleanup } : {}),
        ...(options ? { lifecycleOptions: options } : {})
      });
    } else {
      await cmd.run({ connectionId: host.id });
    }
  };

  if (cleanup) {
    const config = vscode.workspace.getConfiguration("containerlab");
    const skipWarning = config.get<boolean>("skipCleanupWarning", false);
    if (!skipWarning) {
      const selection = await vscode.window.showWarningMessage(
        `WARNING: ${ACTION_VERBS[action].title} (cleanup) of ${where} on ${host.label} will remove all configuration artifacts. Are you sure you want to proceed?`,
        { modal: true },
        "Yes",
        "Don't warn me again"
      );
      if (!selection) {
        await notifyCurrentTopoViewerOfCommandFailure(
          action,
          new Error("Operation cancelled by user"),
          labPath
        );
        return;
      }
      if (selection === "Don't warn me again") {
        await config.update("skipCleanupWarning", true, vscode.ConfigurationTarget.Global);
      }
    }
  }

  await execute();
}
