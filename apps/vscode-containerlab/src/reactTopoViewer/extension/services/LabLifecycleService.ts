/**
 * Lab lifecycle service for React TopoViewer.
 * Handles deploy, destroy, and redeploy operations via VS Code commands.
 */

import * as vscode from "vscode";

import type { EndpointResult } from "@containerlab/clab-ui/session";
import {
  createLifecycleCommandController,
  LIFECYCLE_ACTION_OPTION_KIND,
  normalizeLabLifecycleOptions,
  type TailscaleStatus
} from "@containerlab/clab-ui/host";

import { effectiveSupport } from "@srl-labs/containerlab-lab-backend";

import type { LabConnection } from "../../../backend/connections";
import { labNameForPath, resolveLab } from "../../../backend/labBackends";
import { topologyHostFor } from "../../../backend/topologyHost";
import type { LifecycleCommandType } from "../../../commands/graph";

import { log } from "./logger";

/**
 * Action configuration for lab lifecycle commands.
 */
interface LabAction {
  command: string;
  /** The lifecycle action, as runClabAction names it. */
  action: LifecycleCommandType;
  resultMsg: string;
  errorMsg: string;
  noLabPath: string;
}

/**
 * Map of available lab lifecycle actions.
 */
const LAB_ACTIONS = {
  deployLab: {
    action: "deploy",
    command: "containerlab.lab.deploy",
    resultMsg: "Lab deployment initiated",
    errorMsg: "Error deploying lab",
    noLabPath: "No lab path provided for deployment"
  },
  destroyLab: {
    action: "destroy",
    command: "containerlab.lab.destroy",
    resultMsg: "Lab destruction initiated",
    errorMsg: "Error destroying lab",
    noLabPath: "No lab path provided for destruction"
  },
  deployLabCleanup: {
    action: "deploy",
    command: "containerlab.lab.deploy.cleanup",
    resultMsg: "Lab deployment with cleanup initiated",
    errorMsg: "Error deploying lab with cleanup",
    noLabPath: "No lab path provided for deployment with cleanup"
  },
  destroyLabCleanup: {
    action: "destroy",
    command: "containerlab.lab.destroy.cleanup",
    resultMsg: "Lab destruction with cleanup initiated",
    errorMsg: "Error destroying lab with cleanup",
    noLabPath: "No lab path provided for destruction with cleanup"
  },
  redeployLab: {
    action: "redeploy",
    command: "containerlab.lab.redeploy",
    resultMsg: "Lab redeploy initiated",
    errorMsg: "Error redeploying lab",
    noLabPath: "No lab path provided for redeploy"
  },
  redeployLabCleanup: {
    action: "redeploy",
    command: "containerlab.lab.redeploy.cleanup",
    resultMsg: "Lab redeploy with cleanup initiated",
    errorMsg: "Error redeploying lab with cleanup",
    noLabPath: "No lab path provided for redeploy with cleanup"
  },
  applyLab: {
    action: "apply",
    command: "containerlab.lab.apply",
    resultMsg: "Lab apply initiated",
    errorMsg: "Error applying lab topology",
    noLabPath: "No lab path provided for apply"
  },
  startLab: {
    action: "start",
    command: "containerlab.lab.start",
    resultMsg: "Lab node start initiated",
    errorMsg: "Error starting lab nodes",
    noLabPath: "No lab path provided for node start"
  },
  stopLab: {
    action: "stop",
    command: "containerlab.lab.stop",
    resultMsg: "Lab node stop initiated",
    errorMsg: "Error stopping lab nodes",
    noLabPath: "No lab path provided for node stop"
  },
  restartLab: {
    action: "restart",
    command: "containerlab.lab.restart",
    resultMsg: "Lab node restart initiated",
    errorMsg: "Error restarting lab nodes",
    noLabPath: "No lab path provided for node restart"
  }
} satisfies Record<string, LabAction>;

type LabActionName = keyof typeof LAB_ACTIONS;
const lifecycleController = createLifecycleCommandController<LabActionName>();

function isLabActionName(value: string): value is LabActionName {
  return value in LAB_ACTIONS;
}

/**
 * The lab host a lifecycle action of the viewer runs on; asks where when the
 * topology has none yet. Undefined, and the viewer told, when the user cancels.
 */
async function hostOfAction(
  labPath: string,
  action: LifecycleCommandType
): Promise<LabConnection | undefined> {
  const verb = action.charAt(0).toUpperCase() + action.slice(1);
  const host = await topologyHostFor(labPath, labNameForPath(labPath), verb);
  if (!host) {
    const { notifyCurrentTopoViewerOfCommandFailure } = await import("../../../commands/graph");
    await notifyCurrentTopoViewerOfCommandFailure(
      action,
      new Error("Operation cancelled by user"),
      labPath
    );
  }
  return host;
}

/**
 * Service for handling lab lifecycle operations (deploy, destroy, redeploy).
 * Executes containerlab commands via VS Code command palette.
 */
class LabLifecycleService {
  /**
   * Handles lab lifecycle endpoint requests.
   * @param endpointName The action to perform (deployLab, destroyLab, etc.)
   * @param labPath The path to the lab topology file
   * @param rawOptions Extra containerlab options sent by the webview (deploy, redeploy, destroy)
   */
  async handleLabLifecycleEndpoint(
    endpointName: string,
    labPath: string,
    rawOptions?: unknown
  ): Promise<EndpointResult> {
    if (!isLabActionName(endpointName)) {
      const error = `Unknown endpoint "${endpointName}".`;
      log.error(error);
      return { result: null, error };
    }
    const action = LAB_ACTIONS[endpointName];

    if (!labPath) {
      return { result: null, error: action.noLabPath };
    }

    return (
      (await lifecycleController.run(endpointName, async () => {
        try {
          const host = await hostOfAction(labPath, action.action);
          if (!host) return { result: null, error: null };
          const { ClabLabTreeNode, onConnection } = await import("../../../treeView/common");
          const tempNode = onConnection(
            new ClabLabTreeNode("", vscode.TreeItemCollapsibleState.None, {
              absolute: labPath,
              relative: ""
            }),
            host.id
          );
          const optionKind = LIFECYCLE_ACTION_OPTION_KIND[endpointName];
          // Options the lab host's runtime does not take are dropped.
          const runtime = optionKind
            ? (await (await resolveLab(labPath, undefined, host.id)).backend.hostProfile()).runtime
            : undefined;
          const lifecycleOptions = optionKind
            ? normalizeLabLifecycleOptions(optionKind, rawOptions, runtime)
            : undefined;
          if (optionKind && lifecycleOptions) {
            const { runClabAction } = await import("../../../commands/runClabAction");
            void runClabAction(
              optionKind,
              tempNode,
              endpointName.endsWith("Cleanup"),
              lifecycleOptions
            );
          } else {
            vscode.commands.executeCommand(action.command, tempNode);
          }
          return { result: `${action.resultMsg} for ${labPath}`, error: null };
        } catch (innerError) {
          const error = `${action.errorMsg}: ${String(innerError)}`;
          log.error(`${action.errorMsg}: ${JSON.stringify(innerError, null, 2)}`);
          return { result: null, error };
        }
      })) ?? { result: null, error: null }
    );
  }

  /** Plan `containerlab apply` without changing the lab; the plan's JSON. */
  async planApply(labPath: string): Promise<unknown> {
    const host = await topologyHostFor(labPath, labNameForPath(labPath), "Apply");
    if (!host) throw new Error("Operation cancelled by user");
    const { backend, target } = await resolveLab(labPath, undefined, host.id);
    const plan = await backend.runLifecycle("apply", target, { dryRun: true });
    return plan.result;
  }

  /** Tailscale devices of the running lab; undefined when its lab host cannot report them. */
  async tailscaleStatus(labPath: string): Promise<TailscaleStatus | undefined> {
    const { backend, target } = await resolveLab(labPath);
    if (!effectiveSupport(backend.capabilities, await backend.features()).tailscaleStatus)
      return undefined;
    return backend.tailscaleStatus(target.labName);
  }
}

// Export a singleton instance
export const labLifecycleService = new LabLifecycleService();
