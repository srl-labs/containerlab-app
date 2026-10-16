import * as vscode from "vscode";

import { outputChannel } from "../globals";
import * as utils from "../utils";

/**
 * Run a shell command in a named VS Code terminal.
 * @param command The command to execute
 * @param terminalName The name for the terminal
 * @param reuseOnly If true, just focus existing terminal without sending command again.
 *                  If false (default), reuses existing terminal with Ctrl+C and resends command.
 */
export function execCommandInTerminal(
  command: string,
  terminalName: string,
  reuseOnly: boolean = false
) {
  for (const term of vscode.window.terminals) {
    if (term.name === terminalName) {
      if (reuseOnly) {
        // Terminal already exists - just focus it
        term.show();
        return;
      }
      // Send Ctrl+C & enter to stop any previous command, then resend
      term.sendText("\x03\r");
      term.sendText(command);
      term.show();
      return;
    }
  }

  // Terminal doesn't exist - create new one
  const terminal = vscode.window.createTerminal({ name: terminalName });
  terminal.sendText(command);
  terminal.show();
}

export type SpinnerMsg = {
  progressMsg: string;
  successMsg: string;
  failMsg?: string;
};

export type OutputLineStream = "stdout" | "stderr";
export type OutputLineHandler = (line: string, stream: OutputLineStream) => void;
export type CommandFailureHandler = (error: unknown) => Promise<void>;

/** What a long-running lab task reports while it runs. */
export interface ProgressTaskContext {
  /** Logs a line of output, shows stdout lines in the notification, and forwards it. */
  output(line: string, stream: OutputLineStream): void;
  signal: AbortSignal;
}

export interface ProgressTaskOptions {
  spinnerMsg: SpinnerMsg;
  /** Name of the action in failure messages, e.g. "deploy". */
  actionName: string;
  onSuccess?: () => Promise<void>;
  onFailure?: CommandFailureHandler;
  onOutputLine?: OutputLineHandler;
}

let activeTask: { controller: AbortController; name: string } | null = null;

/** Cancels the lab task that runs with a progress notification, if any. */
export function cancelActiveCommand(): boolean {
  if (!activeTask || activeTask.controller.signal.aborted) {
    return false;
  }
  outputChannel.info(`[command] Cancellation requested for ${activeTask.name}`);
  activeTask.controller.abort();
  return true;
}

/**
 * Runs a lab task with a cancellable progress notification, logs its output,
 * and reports success or failure like every containerlab command does.
 */
export async function runWithProgress(
  task: (context: ProgressTaskContext) => Promise<void>,
  options: ProgressTaskOptions
): Promise<void> {
  const controller = new AbortController();
  const current = { controller, name: options.actionName };
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: options.spinnerMsg.progressMsg,
        cancellable: true
      },
      async (progress, token) => {
        progress.report({ message: " [View Logs](command:containerlab.viewLogs)" });
        activeTask = current;
        token.onCancellationRequested(() => controller.abort());
        const cancelled = new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new Error(`User cancelled the '${options.actionName.toLowerCase()}' command.`))
          );
        });
        cancelled.catch(() => {});
        const output = (rawLine: string, stream: OutputLineStream) => {
          const line = utils.stripAnsi(rawLine).trim();
          if (!line) return;
          if (stream === "stdout") progress.report({ message: line });
          outputChannel.info(line);
          options.onOutputLine?.(line, stream);
        };
        await Promise.race([task({ output, signal: controller.signal }), cancelled]);
      }
    );

    if (options.onSuccess) {
      await options.onSuccess();
    }
    const successMsg = options.spinnerMsg.successMsg;
    if (successMsg.length > 0) {
      vscode.window.showInformationMessage(successMsg, "Show Logs").then((choice) => {
        if (choice === "Show Logs") {
          outputChannel.show(true);
        }
      });
    }
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    outputChannel.error(errMessage);
    const customFailMsg = options.spinnerMsg.failMsg;
    const failMsg =
      customFailMsg !== undefined && customFailMsg.length > 0
        ? `${customFailMsg}. Err: ${errMessage}`
        : `${utils.titleCase(options.actionName)} failed: ${errMessage}`;
    const viewOutputBtn = await vscode.window.showErrorMessage(failMsg, "View logs");
    if (viewOutputBtn === "View logs") {
      outputChannel.show();
    }
    if (options.onFailure) {
      await options.onFailure(err);
    }
  } finally {
    if (activeTask === current) {
      activeTask = null;
    }
  }
}
