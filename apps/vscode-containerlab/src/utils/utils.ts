import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as net from "net";

import * as vscode from "vscode";
import { detectLocalUser } from "@srl-labs/containerlab-lab-backend/local";

import { ClabLabTreeNode } from "../treeView/common";
import { outputChannel } from "../globals";
import { getLocalBackend, isUriString, labPathOf } from "../backend/labBackends";

export function stripAnsi(input: string): string {
  const esc = String.fromCharCode(27);
  const escapeSeq = new RegExp(esc + String.fromCharCode(91) + "[0-?]*[ -/]*[@-~]", "g");
  const controlSeq = new RegExp(`${esc}[@-Z\\-_]`, "g");
  return input.replace(escapeSeq, "").replace(controlSeq, "");
}

function stripFileName(p: string): string {
  return p.substring(0, p.lastIndexOf("/"));
}

export function getRelativeFolderPath(targetPath: string): string {
  if (isUriString(targetPath)) {
    // A lab server file: its path in the server's workspace.
    return vscode.Uri.parse(targetPath).path.replace(/^\/+/, "");
  }
  const workspacePath = vscode.workspace.workspaceFolders
    ? vscode.workspace.workspaceFolders[0].uri.path
    : "";
  return path.relative(workspacePath, targetPath);
}

export function getRelLabFolderPath(labPath: string): string {
  return stripFileName(getRelativeFolderPath(labPath));
}

/**
 * Normalize a lab path by:
 *   1) Handling empty input
 *   2) Normalizing slashes
 *   3) Expanding ~ if present
 *   4) Handling relative paths
 *   5) Using realpathSync if exists
 */
export function normalizeLabPath(labPath: string, singleFolderBase?: string): string {
  if (!labPath || isUriString(labPath)) {
    return labPath;
  }
  labPath = path.normalize(labPath);

  if (labPath.startsWith("~")) {
    const homedir = os.homedir();
    const sub = labPath.replace(/^~[/\\]?/, "");
    labPath = path.normalize(path.join(homedir, sub));
  }

  let candidatePaths: string[] = [];
  if (!path.isAbsolute(labPath)) {
    if (singleFolderBase !== undefined && singleFolderBase.length > 0) {
      candidatePaths.push(path.resolve(singleFolderBase, labPath));
    }
    candidatePaths.push(path.resolve(process.cwd(), labPath));
  } else {
    candidatePaths.push(labPath);
  }

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      try {
        return fs.realpathSync(candidate);
      } catch {
        return candidate;
      }
    }
  }
  return candidatePaths[0];
}

export function titleCase(str: string) {
  return str[0].toLocaleUpperCase() + str.slice(1);
}

/**
 * Who runs the extension, and whether they may run containerlab without sudo:
 * root, or a member of clab_admins and (for Docker) the docker group.
 */
export async function getUserInfo(): Promise<{
  hasPermission: boolean;
  isRoot: boolean;
  userGroups: string[];
  username: string;
  uid: number;
}> {
  try {
    const access = await detectLocalUser({ runtime: getConfig<string>("runtime", "docker") });
    return {
      hasPermission: access.canRunLabs,
      isRoot: access.isRoot,
      userGroups: access.groups,
      username: access.username,
      uid: access.uid
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    outputChannel.error(`User info check failed: ${errorMessage}`);
    return {
      hasPermission: false,
      isRoot: false,
      userGroups: [],
      username: "",
      uid: -1
    };
  }
}

/**
 * Detect OrbStack by checking the kernel version from `uname -r` for "orbstack".
 * (No longer relying on `/.orbstack` existence.)
 */
export function isOrbstack(): boolean {
  try {
    const kernel = os.release().toLowerCase();
    // If "orbstack" is in the kernel, assume OrbStack environment
    return kernel.includes("orbstack");
  } catch {
    return false;
  }
}

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1");
    server.on("listening", () => {
      const address = server.address();
      server.close();
      if (address !== null && typeof address === "object" && typeof address.port === "number") {
        resolve(address.port);
      } else {
        reject(new Error("Could not get free port"));
      }
    });
    server.on("error", reject);
  });
}

// Get the config, set the default to undefined as all defaults **SHOULD** be set in package.json
export function getConfig<T = unknown>(relCfgPath: string): T | undefined;
export function getConfig<T>(relCfgPath: string, defaultValue: T): T;
export function getConfig<T = unknown>(relCfgPath: string, defaultValue?: T): T | undefined {
  const config = vscode.workspace.getConfiguration("containerlab");
  return defaultValue === undefined
    ? config.get<T>(relCfgPath)
    : config.get<T>(relCfgPath, defaultValue);
}

// ----------------------------------------------------------
// Containerlab helper functions
// ----------------------------------------------------------

// Launch clab install script in a terminal. Let the shell handle sudo passwords.
export function installContainerlab(): void {
  const terminal = vscode.window.createTerminal("Containerlab Installation");
  terminal.show();
  terminal.sendText('curl -sL https://containerlab.dev/setup | sudo bash -s "all"');
}

/**
 * Log info messages to the output channel.
 */
function log(message: string, channel: vscode.LogOutputChannel) {
  channel.info(message);
}

/**
 * Checks if containerlab is up to date, and if not, prompts the user to update it.
 * Handled in a terminal to let the shell handle sudo passwords
 */
export async function checkAndUpdateClabIfNeeded(
  outputChannel: vscode.LogOutputChannel,
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    const versionOutput = (await getLocalBackend().versionCheck()).checkResult.trim();
    if (!versionOutput || versionOutput === "Failed fetching latest version information") {
      throw new Error(versionOutput || "No output from containerlab version check.");
    }

    if (versionOutput.includes("Version check timed out")) {
      log("Version check timed out. Skipping update check.", outputChannel);
      return;
    }

    // Register update command if there's a new version
    if (
      versionOutput.includes("newer containerlab version") ||
      versionOutput.includes("version:")
    ) {
      // Register command for performing the update
      const updateCommandId = "containerlab.updateClab";
      context.subscriptions.push(
        vscode.commands.registerCommand(updateCommandId, () => {
          const terminal = vscode.window.createTerminal("Containerlab Update");
          terminal.show();
          terminal.sendText(getLocalBackend().commandLine(["version", "upgrade"]));
          vscode.window.showInformationMessage(
            `Containerlab update started in terminal 'Containerlab Update'. Please follow the prompts.`
          );
        })
      );

      // Show non-modal notification with options
      vscode.window
        .showInformationMessage(versionOutput, "Update Now", "View Release Notes", "Dismiss")
        .then((selection) => {
          if (selection === "Update Now") {
            vscode.commands.executeCommand(updateCommandId);
          } else if (selection === "View Release Notes") {
            const urlRegex = /(https?:\/\/\S+)/;
            const m = urlRegex.exec(versionOutput);
            if (m) {
              vscode.env.openExternal(vscode.Uri.parse(m[1]));
            } else {
              vscode.window.showInformationMessage("No release notes URL found.");
            }
          }
          // For 'Dismiss' we do nothing
        });
    } else {
      log("Containerlab is up to date.", outputChannel);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`containerlab version check failed: ${errorMessage}`, outputChannel);
    vscode.window.showErrorMessage(
      "Unable to detect containerlab version. Please check your installation."
    );
  }
}

// ----------------------------------------------------------
// Command helper functions
// ----------------------------------------------------------

export async function getSelectedLabNode(
  node?: ClabLabTreeNode | vscode.Uri
): Promise<ClabLabTreeNode | undefined> {
  if (node instanceof ClabLabTreeNode) {
    return node;
  }

  // Editor title buttons and explorer/context menus pass the resource Uri
  // instead of a tree node. Fall back to the active editor when no Uri is given.
  let labPath: string | undefined;
  if (node instanceof vscode.Uri) {
    labPath = labPathOf(node);
  } else {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    labPath = activeUri ? labPathOf(activeUri) : undefined;
  }

  if (labPath === undefined || labPath === "" || !/\.clab\.(yml|yaml)$/i.test(labPath)) {
    return undefined;
  }

  const fileName = isUriString(labPath)
    ? path.posix.basename(vscode.Uri.parse(labPath).path)
    : path.basename(labPath);
  return new ClabLabTreeNode(fileName, vscode.TreeItemCollapsibleState.None, {
    absolute: labPath,
    relative: fileName
  });
}

// Sanitizes a string to a Docker-safe container name.
// Rules: only [A-Za-z0-9_.-], must start with alnum, no trailing '.'/'-'.
export function sanitize(
  raw: string,
  { maxLen = 128, lower = false }: { maxLen?: number; lower?: boolean } = {}
): string {
  if (!raw) return "container";

  // Replace all disallowed characters (including "/") with "-"
  let out = raw.replace(/[^A-Za-z0-9_.-]+/g, "-");

  // Remove leading or trailing separators
  while (out.startsWith("-") || out.startsWith(".")) out = out.substring(1);
  while (out.endsWith("-") || out.endsWith(".")) out = out.slice(0, -1);

  // Ensure the name starts with an alphanumeric character
  if (!/^[A-Za-z0-9]/.test(out)) {
    out = `c-${out}`;
  }

  // Enforce maximum length and trim any trailing separators again
  if (out.length > maxLen) {
    out = out.slice(0, maxLen);
    while (out.endsWith("-") || out.endsWith(".")) out = out.slice(0, -1);
  }

  if (!out) out = "container";
  return lower ? out.toLowerCase() : out;
}
