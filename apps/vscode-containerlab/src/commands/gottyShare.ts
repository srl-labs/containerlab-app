import * as vscode from "vscode";

import { gottyOptionsError, type ShareToolOptions } from "@srl-labs/containerlab-lab-backend";

import type { ClabLabTreeNode } from "../treeView/common";
import { outputChannel, gottySessions, runningLabsProvider } from "../globals";
import { backendOf } from "../backend/labBackends";
import { isRemoteNode, remoteHostname } from "../backend/remoteNode";
import { refreshGottySessions, refreshRunningLabsProvider } from "../services/sessionRefresh";

import { getHostname } from "./capture";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

async function parseGottyLink(output: string, node: ClabLabTreeNode): Promise<string | undefined> {
  try {
    const bracketedHost = await getBracketedHostname(node);
    const fromJson = tryParseLinkFromJson(output, bracketedHost);
    if (fromJson !== undefined && fromJson.length > 0) return fromJson;
    const fromText = tryParseLinkFromText(output, bracketedHost);
    if (fromText !== undefined && fromText.length > 0) return fromText;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.error(`Failed to parse GoTTY link: ${message}`);
  }
  return undefined;
}

function tryParseLinkFromJson(output: string, bracketedHost?: string): string | undefined {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return undefined;
  try {
    const payload = output.slice(start, end + 1);
    const parsedSessions: unknown = JSON.parse(payload);
    if (!isUnknownArray(parsedSessions) || parsedSessions.length === 0) return undefined;
    const firstSession = parsedSessions[0];
    if (firstSession === undefined || !isRecord(firstSession)) return undefined;
    const port = firstSession.port;
    if (typeof port !== "number" || !Number.isFinite(port) || port <= 0) return undefined;
    if (bracketedHost === undefined || bracketedHost.length === 0) return undefined;
    return `http://${bracketedHost}:${port}`;
  } catch {
    return undefined;
  }
}

function tryParseLinkFromText(output: string, bracketedHost?: string): string | undefined {
  const urlMatch = /(https?:\/\/\S+)/.exec(output);
  if (!urlMatch) return undefined;
  const url = urlMatch[1];
  if (url.includes("HOST_IP") && bracketedHost !== undefined && bracketedHost.length > 0) {
    return url.replace("HOST_IP", bracketedHost);
  }
  return url;
}

async function getBracketedHostname(node: ClabLabTreeNode): Promise<string | undefined> {
  // GoTTY listens where the lab runs: this machine, or its lab host.
  const hostname = (isRemoteNode(node) ? remoteHostname(node) : undefined) ?? (await getHostname());
  if (hostname.length === 0) return undefined;
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}

/**
 * GoTTY sign-in and shell; containerlab's admin/admin and bash unless the
 * user sets them. Undefined when cancelled.
 */
async function askForGottyOptions(node: ClabLabTreeNode): Promise<ShareToolOptions | undefined> {
  const features = await backendOf(node)
    .features()
    .catch(() => undefined);
  if (features?.gottyOptions !== true) return {};
  const picked = await vscode.window.showQuickPick(
    [
      { label: "Default sign-in", description: "admin / admin, bash", custom: false },
      {
        label: "Custom sign-in and shell…",
        description: "Set username, password and shell",
        custom: true
      }
    ],
    { title: "Share the lab with GoTTY" }
  );
  if (!picked) return undefined;
  if (!picked.custom) return {};
  const username = await vscode.window.showInputBox({
    title: "GoTTY username",
    value: "admin",
    validateInput: (value) => gottyOptionsError({ username: value, password: "x" })
  });
  if (username === undefined) return undefined;
  const password = await vscode.window.showInputBox({
    title: "GoTTY password",
    password: true,
    validateInput: (value) => gottyOptionsError({ username, password: value })
  });
  if (password === undefined) return undefined;
  const shell = await vscode.window.showInputBox({
    title: "GoTTY shell",
    value: "bash",
    validateInput: (value) => gottyOptionsError({ shell: value.trim() || "bash" })
  });
  if (shell === undefined) return undefined;
  const chosenShell = shell.trim();
  return {
    username,
    password,
    ...(chosenShell && chosenShell !== "bash" ? { shell: chosenShell } : {})
  };
}

async function gottyStart(action: "attach" | "reattach", node: ClabLabTreeNode | undefined) {
  if (node === undefined || !isNonEmptyString(node.name)) {
    vscode.window.showErrorMessage(`No lab selected for GoTTY ${action}.`);
    return;
  }
  const labName = node.name;
  const options = await askForGottyOptions(node);
  if (options === undefined) return;
  try {
    const port = vscode.workspace.getConfiguration("containerlab").get<number>("gotty.port", 8080);
    const result = await backendOf(node).shareTool("gotty", labName, action, { ...options, port });
    if (result.output) outputChannel.info(result.output);
    const link = await parseGottyLink(result.link ?? result.output ?? "", node);
    if (link !== undefined && link.length > 0) {
      gottySessions.set(labName, link);
      await vscode.env.clipboard.writeText(link);
      const signIn =
        options.username !== undefined
          ? `Sign in as ${options.username} with the password you set.`
          : `Default credentials: ${result.username ?? "admin"}/admin`;
      const choice = await vscode.window.showInformationMessage(
        `GoTTY link copied to clipboard. ${signIn}`,
        "Open Link"
      );
      if (choice === "Open Link") {
        vscode.env.openExternal(vscode.Uri.parse(link));
      }
    } else {
      const msg =
        action === "attach"
          ? "GoTTY session started but no link found."
          : "GoTTY session reattached";
      vscode.window.showInformationMessage(msg);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to ${action} GoTTY: ${message}`);
  }
  await refreshGottySessions();
  await refreshRunningLabsProvider(action);
}

export async function gottyAttach(node: ClabLabTreeNode) {
  await gottyStart("attach", node);
}

export async function gottyDetach(node: ClabLabTreeNode | undefined) {
  if (node === undefined || !isNonEmptyString(node.name)) {
    vscode.window.showErrorMessage("No lab selected for GoTTY detach.");
    return;
  }
  const labName = node.name;
  try {
    await backendOf(node).shareTool("gotty", labName, "detach");
    gottySessions.delete(labName);
    vscode.window.showInformationMessage("GoTTY session detached");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to detach GoTTY: ${message}`);
  }
  await refreshGottySessions();
  try {
    await runningLabsProvider.refresh();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.warn(`Failed to refresh running labs after GoTTY detach: ${message}`);
  }
}

export async function gottyReattach(node: ClabLabTreeNode) {
  await gottyStart("reattach", node);
}

export function gottyCopyLink(link: string) {
  vscode.env.clipboard.writeText(link);
  vscode.window.showInformationMessage("GoTTY link copied to clipboard");
}
