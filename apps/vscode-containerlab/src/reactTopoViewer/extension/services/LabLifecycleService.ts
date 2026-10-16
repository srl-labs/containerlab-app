/**
 * Lab lifecycle service for React TopoViewer.
 * Handles deploy, destroy, and redeploy operations via VS Code commands.
 */

import { execFile } from "child_process";
import { promisify } from "util";

import * as vscode from "vscode";

import type { EndpointResult } from "@containerlab/clab-ui/session";
import {
  createLifecycleCommandController,
  LIFECYCLE_ACTION_OPTION_KIND,
  normalizeLabLifecycleOptions
} from "@containerlab/clab-ui/host";

import { log } from "./logger";

const execFileAsync = promisify(execFile);

/** A dry run reads the whole lab from the runtime, which can take a while on big labs. */
const APPLY_PLAN_TIMEOUT_MS = 120_000;

/**
 * containerlab prints errors as a box: an "ERROR" header followed by the
 * message, wrapped over several lines. Fall back to the last stderr line.
 */
function clabErrorMessage(error: unknown, stripAnsi: (input: string) => string): string {
  const stderr =
    typeof error === "object" && error !== null && "stderr" in error
      ? String((error as { stderr: unknown }).stderr)
      : "";
  const lines = stripAnsi(stderr)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const errorAt = lines.lastIndexOf("ERROR");
  const message = errorAt >= 0 ? lines.slice(errorAt + 1).join(" ") : lines.at(-1);
  return message || (error instanceof Error ? error.message : String(error));
}

/**
 * Action configuration for lab lifecycle commands.
 */
interface LabAction {
  command: string;
  resultMsg: string;
  errorMsg: string;
  noLabPath: string;
}

/**
 * Map of available lab lifecycle actions.
 */
const LAB_ACTIONS = {
  deployLab: {
    command: "containerlab.lab.deploy",
    resultMsg: "Lab deployment initiated",
    errorMsg: "Error deploying lab",
    noLabPath: "No lab path provided for deployment"
  },
  destroyLab: {
    command: "containerlab.lab.destroy",
    resultMsg: "Lab destruction initiated",
    errorMsg: "Error destroying lab",
    noLabPath: "No lab path provided for destruction"
  },
  deployLabCleanup: {
    command: "containerlab.lab.deploy.cleanup",
    resultMsg: "Lab deployment with cleanup initiated",
    errorMsg: "Error deploying lab with cleanup",
    noLabPath: "No lab path provided for deployment with cleanup"
  },
  destroyLabCleanup: {
    command: "containerlab.lab.destroy.cleanup",
    resultMsg: "Lab destruction with cleanup initiated",
    errorMsg: "Error destroying lab with cleanup",
    noLabPath: "No lab path provided for destruction with cleanup"
  },
  redeployLab: {
    command: "containerlab.lab.redeploy",
    resultMsg: "Lab redeploy initiated",
    errorMsg: "Error redeploying lab",
    noLabPath: "No lab path provided for redeploy"
  },
  redeployLabCleanup: {
    command: "containerlab.lab.redeploy.cleanup",
    resultMsg: "Lab redeploy with cleanup initiated",
    errorMsg: "Error redeploying lab with cleanup",
    noLabPath: "No lab path provided for redeploy with cleanup"
  },
  applyLab: {
    command: "containerlab.lab.apply",
    resultMsg: "Lab apply initiated",
    errorMsg: "Error applying lab topology",
    noLabPath: "No lab path provided for apply"
  },
  startLab: {
    command: "containerlab.lab.start",
    resultMsg: "Lab node start initiated",
    errorMsg: "Error starting lab nodes",
    noLabPath: "No lab path provided for node start"
  },
  stopLab: {
    command: "containerlab.lab.stop",
    resultMsg: "Lab node stop initiated",
    errorMsg: "Error stopping lab nodes",
    noLabPath: "No lab path provided for node stop"
  },
  restartLab: {
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
          const { ClabLabTreeNode } = await import("../../../treeView/common");
          const tempNode = new ClabLabTreeNode("", vscode.TreeItemCollapsibleState.None, {
            absolute: labPath,
            relative: ""
          });
          const optionKind = LIFECYCLE_ACTION_OPTION_KIND[endpointName];
          const lifecycleOptions = optionKind
            ? normalizeLabLifecycleOptions(optionKind, rawOptions)
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

  /** Run `containerlab apply --dry-run` and return the JSON plan it prints. */
  async planApply(labPath: string): Promise<unknown> {
    const runtime = vscode.workspace
      .getConfiguration("containerlab")
      .get<string>("runtime", "docker");
    const args = ["apply", "-r", runtime, "--dry-run", "--format", "json", "-t", labPath];
    const { containerlabBinaryPath } = await import("../../../globals");
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(containerlabBinaryPath || "containerlab", args, {
        timeout: APPLY_PLAN_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024
      }));
    } catch (error) {
      const { stripAnsi } = await import("../../../utils/utils");
      throw new Error(clabErrorMessage(error, stripAnsi));
    }
    try {
      return JSON.parse(stdout) as unknown;
    } catch {
      throw new Error("containerlab did not print a JSON plan");
    }
  }
}

// Export a singleton instance
export const labLifecycleService = new LabLifecycleService();
