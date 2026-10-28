// ./src/commands/impairments.ts
import * as vscode from "vscode";

import { isNetemCleared, type NetemSetRequest } from "@srl-labs/containerlab-lab-backend";

import { ClabInterfaceTreeNode } from "../treeView/common";
import { backendOf, connectionOf } from "../backend/labBackends";
import { ensureHostSupports } from "../backend/labHostSupport";

// Common validation messages and patterns
const ERR_EMPTY = "Input should not be empty";
const TIME_UNIT_RE = /^\d+(ms|s)$/;
const ERR_TIME_UNIT =
  "Input should be a number and a time unit. Either ms (milliseconds) or s (seconds)";
const NETEM_FIELDS = ["delay", "jitter", "loss", "rate", "corruption"];

function impairmentsAvailable(): boolean {
  return true;
}

/**
 * Set impairment on an interface. Assumes impairment values are validated.
 * @param node interface to set impairment on
 * @param impairment object with impairment values to set
 */
export async function setImpairment(
  node: ClabInterfaceTreeNode,
  impairment?: Record<string, unknown>
): Promise<void> {
  if (!impairmentsAvailable() || !impairment) {
    return;
  }
  if (!(await ensureHostSupports(connectionOf(node), "netem", "Link impairments"))) return;

  const netemInterface = node.name.startsWith("clab-s-") && node.alias ? node.alias : node.name;
  if (isNetemCleared(impairment)) {
    // Clearing every value removes netem, like `containerlab tools netem reset`.
    await resetImpairment(node, netemInterface);
    return;
  }
  const request = netemSetRequest(node.parentName, netemInterface, impairment);
  if (Object.keys(request).length === 2) {
    return;
  }

  const msg = `set link impairment to ${JSON.stringify(impairment)} for ${node.name} on ${node.parentName}.`;
  vscode.window.showInformationMessage(`Attempting to ${msg}`);
  try {
    await backendOf(node).netemSet(request);
    vscode.window.showInformationMessage(`Successfully ${msg}`);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to ${msg}\n\n${detail}.`);
  }
}

function netemSetRequest(
  containerName: string,
  netemInterface: string,
  impairment: Record<string, unknown>
): NetemSetRequest {
  const request: NetemSetRequest = { containerName, interface: netemInterface };
  for (const [key, value] of Object.entries(impairment)) {
    if (!NETEM_FIELDS.includes(key) || typeof value !== "string" || value.trim() === "") continue;
    if (key === "delay" || key === "jitter") {
      request[key] = value.trim();
    } else if (key === "loss" || key === "rate" || key === "corruption") {
      request[key] = Number(value.trim().replace(/%$/, ""));
    }
  }
  return request;
}

async function resetImpairment(node: ClabInterfaceTreeNode, netemInterface: string): Promise<void> {
  try {
    await backendOf(node).netemReset({ containerName: node.parentName, interface: netemInterface });
    vscode.window.showInformationMessage(
      `Cleared link impairments for ${node.name} on ${node.parentName}.`
    );
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(
      `Failed to clear link impairments for ${node.name} on ${node.parentName}\n\n${detail}.`
    );
  }
}

async function promptImpairment(
  node: ClabInterfaceTreeNode | undefined,
  impairment: string,
  title: string,
  placeHolder: string,
  validator: (_input: string) => string | undefined
): Promise<void> {
  if (!(node instanceof ClabInterfaceTreeNode)) {
    vscode.window.showErrorMessage(`No interface selected to set ${impairment} for.`);
    return;
  }
  if (!impairmentsAvailable()) {
    return;
  }
  const val = await vscode.window.showInputBox({ title, placeHolder, validateInput: validator });
  if (val === undefined) {
    return;
  }
  const netemData: Record<string, string | undefined> = {};
  netemData[impairment] = val;
  void setImpairment(node, netemData);
}

export async function setLinkDelay(node?: ClabInterfaceTreeNode): Promise<void> {
  if (node === undefined) {
    vscode.window.showErrorMessage("No interface selected to set delay for.");
    return;
  }
  await promptImpairment(
    node,
    "delay",
    `Set link delay for ${node.name} on ${node.parentName}`,
    `Link delay with time unit. ie: 50ms, 1s, 30s`,
    (input) => {
      if (input.length === 0) {
        return ERR_EMPTY;
      }
      if (!TIME_UNIT_RE.test(input)) {
        return ERR_TIME_UNIT;
      }
      return undefined;
    }
  );
}

export async function setLinkJitter(node?: ClabInterfaceTreeNode): Promise<void> {
  if (node === undefined) {
    vscode.window.showErrorMessage("No interface selected to set jitter for.");
    return;
  }
  await promptImpairment(
    node,
    "jitter",
    `Set link jitter for ${node.name} on ${node.parentName}`,
    `Jitter with time unit. ie: 50ms, 1s, 30s`,
    (input) => {
      if (input.length === 0) {
        return ERR_EMPTY;
      }
      if (!TIME_UNIT_RE.test(input)) {
        return ERR_TIME_UNIT;
      }
      return undefined;
    }
  );
}

export async function setLinkLoss(node?: ClabInterfaceTreeNode): Promise<void> {
  if (node === undefined) {
    vscode.window.showErrorMessage("No interface selected to set loss for.");
    return;
  }
  await promptImpairment(
    node,
    "loss",
    `Set packet loss for ${node.name} on ${node.parentName}`,
    `Packet loss as a percentage. ie 50 means 50% packet loss`,
    (input) => {
      if (input.length === 0) {
        return ERR_EMPTY;
      }
      const re = /^(?:[1-9]\d?|100|0)$/;
      if (!re.test(input)) {
        return "Input should be a number between 0 and 100.";
      }
      return undefined;
    }
  );
}

export async function setLinkRate(node?: ClabInterfaceTreeNode): Promise<void> {
  if (node === undefined) {
    vscode.window.showErrorMessage("No interface selected to set rate for.");
    return;
  }
  await promptImpairment(
    node,
    "rate",
    `Set egress rate-limit for ${node.name} on ${node.parentName}`,
    `Rate-limit in kbps. ie 100 means 100kbit/s`,
    (input) => {
      if (input.length === 0) {
        return ERR_EMPTY;
      }
      const re = /^\d+$/;
      if (!re.test(input)) {
        return "Input should be a number";
      }
      return undefined;
    }
  );
}

export async function setLinkCorruption(node?: ClabInterfaceTreeNode): Promise<void> {
  if (node === undefined) {
    vscode.window.showErrorMessage("No interface selected to set corruption for.");
    return;
  }
  await promptImpairment(
    node,
    "corruption",
    `Set packet corruption for ${node.name} on ${node.parentName}`,
    `Packet corruption as a percentage. ie 50 means 50% probability of packet corruption.`,
    (input) => {
      if (input.length === 0) {
        return ERR_EMPTY;
      }
      const re = /^(?:[1-9]\d?|100|0)$/;
      if (!re.test(input)) {
        return "Input should be a number between 0 and 100.";
      }
      return undefined;
    }
  );
}
