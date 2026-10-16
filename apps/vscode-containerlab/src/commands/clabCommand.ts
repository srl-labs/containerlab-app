import * as vscode from "vscode";
import type { LabLifecycleAction } from "@srl-labs/containerlab-lab-backend";
import type { LabLifecycleOptions } from "@containerlab/clab-ui/host";

import { ClabLabTreeNode } from "../treeView/common";
import { getLabBackend, labTargetForPath } from "../backend/labBackends";

import * as cmd from "./command";

export interface LabLifecycleRequest {
  /** Remove configuration artifacts (`-c`). */
  cleanup?: boolean;
  /** Extra containerlab options of deploy, redeploy and destroy. */
  lifecycleOptions?: LabLifecycleOptions;
}

/**
 * Runs a containerlab lifecycle action on a lab through the lab backend, with
 * a progress notification and the lab's output in the Output channel.
 */
export class ClabCommand {
  private readonly node?: ClabLabTreeNode;
  private readonly action: LabLifecycleAction;
  private readonly spinnerMsg: cmd.SpinnerMsg;
  private readonly onSuccess?: () => Promise<void>;
  private readonly onFailure?: cmd.CommandFailureHandler;
  private readonly onOutputLine?: cmd.OutputLineHandler;

  constructor(
    action: LabLifecycleAction,
    node: ClabLabTreeNode | undefined,
    spinnerMsg?: cmd.SpinnerMsg,
    onSuccess?: () => Promise<void>,
    onFailure?: cmd.CommandFailureHandler,
    onOutputLine?: cmd.OutputLineHandler
  ) {
    this.action = action;
    this.node = node instanceof ClabLabTreeNode ? node : undefined;
    this.spinnerMsg = spinnerMsg ?? {
      progressMsg: `Running ${action}...`,
      successMsg: `${action} completed successfully`
    };
    this.onSuccess = onSuccess;
    this.onFailure = onFailure;
    this.onOutputLine = onOutputLine;
  }

  public async run(request: LabLifecycleRequest = {}): Promise<void> {
    // Try node.details -> fallback to active editor
    let labPath: string;
    if (!this.node) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No lab node or topology file selected");
        return;
      }
      labPath = editor.document.uri.fsPath;
    } else {
      labPath = this.node.labPath.absolute;
    }

    if (!labPath) {
      vscode.window.showErrorMessage(`No labPath found for command "${this.action}".`);
      return;
    }

    const backend = getLabBackend();
    const action = this.action;
    await cmd.runWithProgress(
      async ({ output, signal }) => {
        const events = await backend.streamLifecycle(action, labTargetForPath(labPath), {
          cleanup: request.cleanup,
          lifecycleOptions: request.lifecycleOptions,
          signal
        });
        for await (const event of events) {
          if (event.type === "log") {
            output(event.line, event.stream ?? "stdout");
          } else if (event.type === "error") {
            throw new Error(event.error);
          }
        }
      },
      {
        spinnerMsg: this.spinnerMsg,
        actionName: action,
        onSuccess: this.onSuccess,
        onFailure: this.onFailure,
        onOutputLine: this.onOutputLine
      }
    );
  }
}
