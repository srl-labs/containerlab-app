import * as path from "path";
import * as os from "os";
import * as fs from "fs";

import * as vscode from "vscode";

import { outputChannel } from "../globals";
import { backendFor, connectionOf, getLocalBackend, pickConnection } from "../backend/labBackends";
import type { LabConnection } from "../backend/connections";

/**
 * Clones a repository with lab topologies: into this workspace, or into the
 * workspace of a lab host. `target` is a tree node of the connection to use;
 * without one the user picks.
 */
export async function cloneRepoFromUrl(repoUrl?: string, target?: unknown) {
  const connection =
    target !== undefined ? connectionOf(target) : await pickConnection("Clone repository to");
  if (!connection) {
    return;
  }
  if (repoUrl === undefined || repoUrl.length === 0) {
    const input = await vscode.window.showInputBox({
      title: "Git repository URL",
      placeHolder: "https://github.com/user/repo.git",
      prompt: "Enter the repository to clone"
    });
    if (input === undefined || input.length === 0) {
      return;
    }
    repoUrl = input;
  }

  if (connection.kind === "api") {
    await importOnLabHost(connection, repoUrl);
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const destBase = workspaceRoot ?? path.join(os.homedir(), ".clab");

  if (!fs.existsSync(destBase)) {
    fs.mkdirSync(destBase, { recursive: true });
  }

  const repoName = path.basename(repoUrl.replace(/\.git$/, ""));
  const dest = path.join(destBase, repoName);

  outputChannel.info(`git clone ${repoUrl} ${dest}`);

  try {
    await getLocalBackend().cloneRepository(repoUrl, dest);
    vscode.window.showInformationMessage(`Repository cloned to ${dest}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Git clone failed: ${message}`);
    outputChannel.error(`git clone failed: ${message}`);
  }
}

/** The lab host clones the repository into its workspace. */
async function importOnLabHost(connection: LabConnection, repoUrl: string): Promise<void> {
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Cloning ${repoUrl} on ${connection.label}`
      },
      () => backendFor(connection).importTopologyFromUrl({ url: repoUrl })
    );
    vscode.window.showInformationMessage(
      `Repository cloned on ${connection.label}: ${result.topology.yamlFileName}`
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Git clone failed: ${message}`);
  }
}
