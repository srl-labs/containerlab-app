import * as vscode from "vscode";

import type { ClabLabTreeNode } from "../treeView/common";
import { outputChannel, sshxSessions, runningLabsProvider } from "../globals";
import { backendOf, connectionOf } from "../backend/labBackends";
import { refreshSshxSessions, refreshRunningLabsProvider } from "../services/sessionRefresh";
import { ensureHostSupports } from "../backend/labHostSupport";

/** Whether to also create a read-only link; undefined when cancelled. */
async function askForReaders(node: ClabLabTreeNode): Promise<boolean | undefined> {
  const features = await backendOf(node)
    .features()
    .catch(() => undefined);
  if (features?.sshxReaders !== true) return false;
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: "Shared terminal link",
        description: "Anyone with the link can type",
        readers: false
      },
      {
        label: "Shared terminal and read-only links",
        description: "Also a link that can only watch",
        readers: true
      }
    ],
    { title: "Share the lab with sshx" }
  );
  return picked?.readers;
}

async function sshxStart(action: "attach" | "reattach", node: ClabLabTreeNode) {
  if (node.name === undefined || node.name.length === 0) {
    vscode.window.showErrorMessage(`No lab selected for SSHX ${action}.`);
    return;
  }
  if (!(await ensureHostSupports(connectionOf(node), "shareTools", "SSHX"))) return;
  const enableReaders = await askForReaders(node);
  if (enableReaders === undefined) return;
  try {
    const result = await backendOf(node).shareTool("sshx", node.name, action, { enableReaders });
    if (result.output) outputChannel.info(result.output);
    const link = result.link;
    if (link !== undefined && link.length > 0) {
      sshxSessions.set(node.name, link);
      await vscode.env.clipboard.writeText(link);
      const readOnlyLink = result.readOnlyLink;
      const actions =
        readOnlyLink !== undefined ? ["Open Link", "Copy Read-Only Link"] : ["Open Link"];
      const choice = await vscode.window.showInformationMessage(
        readOnlyLink !== undefined
          ? `SSHX link copied to clipboard. Read-only link: ${readOnlyLink}`
          : "SSHX link copied to clipboard.",
        ...actions
      );
      if (choice === "Open Link") {
        vscode.env.openExternal(vscode.Uri.parse(link));
      } else if (choice === "Copy Read-Only Link" && readOnlyLink !== undefined) {
        await vscode.env.clipboard.writeText(readOnlyLink);
        vscode.window.showInformationMessage("Read-only SSHX link copied to clipboard.");
      }
    } else {
      const msg =
        action === "attach" ? "SSHX session started but no link found." : "SSHX session reattached";
      vscode.window.showInformationMessage(msg);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to ${action} SSHX: ${message}`);
  }
  await refreshSshxSessions();
  await refreshRunningLabsProvider(action);
}

export async function sshxAttach(node: ClabLabTreeNode) {
  await sshxStart("attach", node);
}

export async function sshxDetach(node: ClabLabTreeNode) {
  if (node.name === undefined || node.name.length === 0) {
    vscode.window.showErrorMessage("No lab selected for SSHX detach.");
    return;
  }
  try {
    await backendOf(node).shareTool("sshx", node.name, "detach");
    sshxSessions.delete(node.name);
    vscode.window.showInformationMessage("SSHX session detached");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to detach SSHX: ${message}`);
  }
  await refreshSshxSessions();
  try {
    await runningLabsProvider.refresh();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.warn(`Failed to refresh running labs after SSHX detach: ${message}`);
  }
}

export async function sshxReattach(node: ClabLabTreeNode) {
  await sshxStart("reattach", node);
}

export function sshxCopyLink(link: string) {
  vscode.env.clipboard.writeText(link);
  vscode.window.showInformationMessage("SSHX link copied to clipboard");
}
