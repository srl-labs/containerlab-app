import * as vscode from "vscode";
import { DEFAULT_EXEC_COMMANDS_BY_KIND } from "@containerlab/clab-ui/host";

import type { ClabContainerTreeNode } from "../treeView/common";
import { DEFAULT_ATTACH_SHELL_CMD, DEFAULT_ATTACH_TELNET_PORT } from "../utils";
import { isRemoteNode, openRemoteTerminal } from "../backend/remoteNode";

import { execCommandInTerminal } from "./command";

interface NodeContext {
  containerId: string;
  containerKind: string;
  container: string;
}

function getNodeContext(node: ClabContainerTreeNode | undefined): NodeContext | undefined {
  if (!node) {
    vscode.window.showErrorMessage("No container node selected.");
    return undefined;
  }
  const containerId = node.cID;
  const containerKind = node.kind;
  if (!containerId) {
    vscode.window.showErrorMessage("No containerId for shell attach.");
    return undefined;
  }
  if (!containerKind) {
    vscode.window.showErrorMessage("No container kind for shell attach.");
    return undefined;
  }
  const container = node.name || containerId;
  return { containerId, containerKind, container };
}

/** The VS Code terminal Attach Shell opens for a node, and focuses when it is open. */
export function shellTerminalName(node: Pick<ClabContainerTreeNode, "name" | "cID">): string {
  return `Shell - ${node.name || node.cID}`;
}

/** Names the launcher of a node's shell among a terminal's arguments. */
const NODE_SHELL_ARG0 = "clab-node-shell";

/**
 * Runs the node's shell and ends with it, so the terminal closes instead of
 * falling back to a shell on this machine. The command is read as a shell
 * reads a typed line, quotes included, as when it was typed into a terminal.
 * A shell that fails within moments could not start: its message stays until
 * Enter, or it would go with the terminal.
 */
const NODE_SHELL_SCRIPT = [
  "start=$(date +%s)",
  'eval "$1"',
  "code=$?",
  'if [ "$code" -ne 0 ] && [ $(($(date +%s) - start)) -lt 3 ]; then',
  '  printf "\\nNo shell on the node (exit code %s). Press Enter to close this terminal." "$code"',
  "  read -r _",
  "fi",
  "exit 0"
].join("\n");

/**
 * How a local node's shell terminal starts: with the node's shell as its own
 * process. Typed into a terminal's shell instead, as it once was, the terminal
 * outlived the node's shell and took what came next on this machine.
 */
function nodeShellLaunch(
  runtime: string,
  containerId: string,
  execCmd: string
): Pick<vscode.TerminalOptions, "shellPath" | "shellArgs"> {
  if (process.platform === "win32") {
    return {
      shellPath: runtime,
      shellArgs: ["exec", "-it", containerId, ...execCmd.trim().split(/\s+/)]
    };
  }
  return {
    shellPath: "/bin/sh",
    shellArgs: [
      "-c",
      NODE_SHELL_SCRIPT,
      NODE_SHELL_ARG0,
      `${runtime} exec -it ${containerId} ${execCmd}`
    ]
  };
}

/**
 * Whether the terminal's process is a node's shell: one Attach Shell started,
 * or a lab host's terminal session. What is typed into any other terminal is
 * run by whatever shell it has.
 */
export function isNodeShellTerminal(terminal: Pick<vscode.Terminal, "creationOptions">): boolean {
  const options: Partial<vscode.TerminalOptions & vscode.ExtensionTerminalOptions> =
    terminal.creationOptions;
  if (options.pty !== undefined) return true;
  const args = Array.isArray(options.shellArgs) ? options.shellArgs : [];
  return (
    (args[0] === "-c" && args[2] === NODE_SHELL_ARG0) || (args[0] === "exec" && args[1] === "-it")
  );
}

export function attachShell(node: ClabContainerTreeNode | undefined): void {
  const ctx = getNodeContext(node);
  if (!ctx || !node) return;
  if (isRemoteNode(node)) {
    void openRemoteTerminal(node, "shell", shellTerminalName(node));
    return;
  }

  const defaultMapping: Partial<Record<string, string>> = DEFAULT_EXEC_COMMANDS_BY_KIND;
  let execCmd = defaultMapping[ctx.containerKind] ?? DEFAULT_ATTACH_SHELL_CMD;
  const config = vscode.workspace.getConfiguration("containerlab");
  const userExecMapping = config.get<Record<string, string>>("node.execCommandMapping", {});
  const runtime = config.get<string>("runtime", "docker");

  execCmd = userExecMapping[ctx.containerKind] ?? execCmd;

  const name = shellTerminalName(node);
  const open = vscode.window.terminals.find(
    (terminal) => terminal.name === name && terminal.exitStatus === undefined
  );
  if (open) {
    open.show();
    return;
  }
  vscode.window
    .createTerminal({ name, ...nodeShellLaunch(runtime, ctx.containerId, execCmd) })
    .show();
}

export function telnetToNode(node: ClabContainerTreeNode | undefined): void {
  const ctx = getNodeContext(node);
  if (!ctx || !node) return;
  const config = vscode.workspace.getConfiguration("containerlab");
  const port = config.get<number>("node.telnetPort", DEFAULT_ATTACH_TELNET_PORT);
  if (isRemoteNode(node)) {
    void openRemoteTerminal(node, "telnet", `Telnet - ${ctx.container}`, { telnetPort: port });
    return;
  }
  const runtime = config.get<string>("runtime", "docker");
  execCommandInTerminal(
    `${runtime} exec -it ${ctx.containerId} telnet 127.0.0.1 ${port}`,
    `Telnet - ${ctx.container}`,
    true // If terminal exists, just focus it
  );
}
