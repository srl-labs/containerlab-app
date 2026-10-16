import * as vscode from "vscode";
import type { NetemFields } from "@containerlab/clab-ui/node-impairments";
import type { NetemSetRequest } from "@srl-labs/containerlab-lab-backend";

import type { ClabContainerTreeNode } from "../treeView/common";
import { outputChannel } from "../globals";
import { getLabBackend } from "../backend/labBackends";
import { NODE_IMPAIRMENTS_PANEL, createPanelWebviewHtml } from "../webviews/shared/webviewPanels";

/**
 * Raw netem item from CLI JSON output
 */
interface NetemRawItem {
  interface: string;
  delay?: string;
  jitter?: string;
  packet_loss?: number;
  rate?: number;
  corruption?: number;
}

/**
 * Parsed netem data by container name
 */
type NetemRawData = Record<string, NetemRawItem[]>;

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getTreeItemLabelText(label: string | vscode.TreeItemLabel | undefined): string {
  if (typeof label === "string") {
    return label;
  }
  if (label !== undefined && typeof label.label === "string") {
    return label.label;
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNetemRawItem(value: unknown): value is NetemRawItem {
  if (!isRecord(value)) return false;
  return typeof value.interface === "string";
}

function toNetemRawData(value: unknown): NetemRawData {
  if (!isRecord(value)) return {};
  const result: NetemRawData = {};
  for (const [key, items] of Object.entries(value)) {
    if (!Array.isArray(items)) continue;
    result[key] = items.filter((item): item is NetemRawItem => isNetemRawItem(item));
  }
  return result;
}

function normalizeInterfaceName(iface: string): string {
  const idx = iface.indexOf("(");
  const base = idx >= 0 ? iface.slice(0, idx) : iface;
  return base.trim();
}

function stripPercentage(val: string): string {
  let s = val.trimEnd();
  if (s.endsWith("%")) {
    s = s.slice(0, -1).trimEnd();
  }
  return s.trim();
}

function defaultNetemFields(): NetemFields {
  return {
    delay: "0ms",
    jitter: "0ms",
    loss: "0.00%",
    rate: "0",
    corruption: "0.00%"
  };
}

function parseNetemItem(item: NetemRawItem): [string, NetemFields] | null {
  if (item.interface === "lo") {
    return null;
  }
  const key = normalizeInterfaceName(item.interface);
  const fields: NetemFields = {
    delay: typeof item.delay === "string" && item.delay.trim().length > 0 ? item.delay : "0ms",
    jitter: typeof item.jitter === "string" && item.jitter.trim().length > 0 ? item.jitter : "0ms",
    loss:
      typeof item.packet_loss === "number" && item.packet_loss > 0
        ? `${item.packet_loss}%`
        : "0.00%",
    rate: typeof item.rate === "number" && item.rate > 0 ? String(item.rate) : "0",
    corruption:
      typeof item.corruption === "number" && item.corruption > 0 ? `${item.corruption}%` : "0.00%"
  };
  return [key, fields];
}

function ensureDefaults(map: Record<string, NetemFields>, node: ClabContainerTreeNode) {
  node.interfaces.forEach((ifNode) => {
    const norm = normalizeInterfaceName(ifNode.name);
    if (norm === "lo") {
      return;
    }
    if (!(norm in map)) {
      map[norm] = defaultNetemFields();
      outputChannel.info(`Defaulted values for ${norm}.`);
    }
  });
}

async function refreshNetemSettings(
  node: ClabContainerTreeNode
): Promise<Record<string, NetemFields>> {
  let netemMap: Record<string, NetemFields> = {};

  try {
    const rawData = toNetemRawData(await getLabBackend().netemShow(node.name));
    const interfacesData = rawData[node.name] ?? [];
    for (const item of interfacesData) {
      const parsed = parseNetemItem(item);
      if (parsed) {
        const [key, fields] = parsed;
        netemMap[key] = fields;
      }
    }
    outputChannel.info("Netem settings refreshed via JSON.");
  } catch (err: unknown) {
    const msg = getErrorMessage(err);
    vscode.window.showWarningMessage(`Failed to retrieve netem settings: ${msg}`);
    outputChannel.info(`Error reading netem settings of ${node.name}: ${msg}`);
  }

  ensureDefaults(netemMap, node);
  return netemMap;
}

function positiveNumber(value: string | undefined): number | undefined {
  const numeric = Number(stripPercentage(value ?? ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function buildNetemRequest(
  containerName: string,
  intfName: string,
  fields: NetemFields
): NetemSetRequest | undefined {
  const request: NetemSetRequest = { containerName, interface: intfName };
  if (fields.delay) request.delay = fields.delay;
  if (fields.jitter) request.jitter = fields.jitter;
  const loss = positiveNumber(fields.loss);
  if (loss !== undefined) request.loss = loss;
  const rate = positiveNumber(fields.rate);
  if (rate !== undefined) request.rate = rate;
  const corruption = positiveNumber(fields.corruption);
  if (corruption !== undefined) request.corruption = corruption;
  return Object.keys(request).length > 2 ? request : undefined;
}

async function applyNetem(
  node: ClabContainerTreeNode,
  panel: vscode.WebviewPanel,
  netemData: Record<string, NetemFields>
) {
  const backend = getLabBackend();
  const ops: Promise<unknown>[] = [];
  for (const [intfName, fields] of Object.entries(netemData)) {
    const request = buildNetemRequest(node.name, intfName, fields);
    if (request) {
      outputChannel.info(`Applying netem to ${node.name} ${intfName}: ${JSON.stringify(request)}`);
      ops.push(backend.netemSet(request));
    }
  }
  if (ops.length === 0) {
    vscode.window.showInformationMessage("No parameters specified; nothing applied.");
  } else {
    try {
      await Promise.all(ops);
      const labelText = getTreeItemLabelText(node.label);
      const displayName = labelText !== "" ? labelText : node.name;
      vscode.window.showInformationMessage(`Applied netem settings for ${displayName}`);
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Failed to apply settings: ${getErrorMessage(err)}`);
    }
  }
  const updated = await refreshNetemSettings(node);
  panel.webview.postMessage({ command: "updateFields", data: updated });
}

async function clearNetem(node: ClabContainerTreeNode, panel: vscode.WebviewPanel) {
  const backend = getLabBackend();
  const ops: Promise<unknown>[] = [];
  for (const ifNode of node.interfaces) {
    const norm = normalizeInterfaceName(ifNode.name);
    if (norm === "lo") {
      continue;
    }
    ops.push(backend.netemReset({ containerName: node.name, interface: norm }));
  }
  try {
    await Promise.all(ops);
    vscode.window.showInformationMessage(`Cleared netem settings for ${node.name}`);
  } catch (err: unknown) {
    vscode.window.showErrorMessage(`Failed to clear settings: ${getErrorMessage(err)}`);
  }
  const updated = await refreshNetemSettings(node);
  panel.webview.postMessage({ command: "updateFields", data: updated });
}

async function refreshPanel(node: ClabContainerTreeNode, panel: vscode.WebviewPanel) {
  const updated = await refreshNetemSettings(node);
  panel.webview.postMessage({ command: "updateFields", data: updated });
  vscode.window.showInformationMessage("Netem settings refreshed.");
}

export async function manageNodeImpairments(
  node: ClabContainerTreeNode,
  context: vscode.ExtensionContext
) {
  const netemMap = await refreshNetemSettings(node);
  const panelLabel = getTreeItemLabelText(node.label);

  const panel = vscode.window.createWebviewPanel(
    "clabNodeImpairments",
    `Link Impairments: ${panelLabel !== "" ? panelLabel : node.name}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, "dist"),
        vscode.Uri.joinPath(context.extensionUri, "resources")
      ]
    }
  );

  const iconUri = vscode.Uri.joinPath(context.extensionUri, "resources", "containerlab.svg");
  panel.iconPath = iconUri;

  panel.webview.html = createPanelWebviewHtml(
    NODE_IMPAIRMENTS_PANEL,
    panel.webview,
    context.extensionUri,
    {
      nodeName: node.name,
      interfacesData: netemMap
    }
  );

  panel.webview.onDidReceiveMessage(
    async (msg: { command: string; data?: Record<string, NetemFields> }) => {
      switch (msg.command) {
        case "apply":
          if (msg.data) {
            await applyNetem(node, panel, msg.data);
          }
          break;
        case "clearAll":
          await clearNetem(node, panel);
          break;
        case "refresh":
          await refreshPanel(node, panel);
          break;
      }
    }
  );
}
