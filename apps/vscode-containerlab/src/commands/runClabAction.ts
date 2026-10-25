import * as vscode from "vscode";
import { isPartialDestroy, type LabLifecycleOptions } from "@containerlab/clab-ui/host";

import type { ClabLabTreeNode } from "../treeView/common";
import { getSelectedLabNode } from "../utils/utils";

import { ClabCommand } from "./clabCommand";
import {
  createTopoViewerLifecycleHandlers,
  notifyCurrentTopoViewerOfCommandFailure,
  type LifecycleCommandType
} from "./graph";

export type LabLifecycleAction = LifecycleCommandType;

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

  const execute = async () => {
    const handlers = createTopoViewerLifecycleHandlers(action, {
      // Destroying some nodes leaves the rest of the lab running.
      labKeepsRunning: action === "destroy" && isPartialDestroy(lifecycleOptions),
      labPath: node.labPath.absolute
    });
    const cmd = new ClabCommand(
      action,
      node,
      undefined,
      handlers.onSuccess,
      handlers.onFailure,
      handlers.onOutputLine
    );
    if (cleanup || lifecycleOptions) {
      await cmd.run({
        ...(cleanup ? { cleanup } : {}),
        ...(lifecycleOptions ? { lifecycleOptions } : {})
      });
    } else {
      await cmd.run();
    }
  };

  if (cleanup) {
    const config = vscode.workspace.getConfiguration("containerlab");
    const skipWarning = config.get<boolean>("skipCleanupWarning", false);
    if (!skipWarning) {
      const selection = await vscode.window.showWarningMessage(
        `WARNING: ${action.charAt(0).toUpperCase() + action.slice(1)} (cleanup) will remove all configuration artifacts.. Are you sure you want to proceed?`,
        { modal: true },
        "Yes",
        "Don't warn me again"
      );
      if (!selection) {
        await notifyCurrentTopoViewerOfCommandFailure(
          action,
          new Error("Operation cancelled by user"),
          node.labPath.absolute
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
