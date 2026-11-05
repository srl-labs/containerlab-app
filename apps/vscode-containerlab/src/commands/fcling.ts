import * as fs from "fs";

import * as vscode from "vscode";
import * as YAML from "yaml";
import { FCLING_IMAGE } from "@containerlab/clab-ui/fabric/engine";

import type { ClabLabTreeNode } from "../treeView/common";
import { connectionOf, isRemote, resolveLab } from "../backend/labBackends";

import { execCommandInTerminal } from "./command";
import { ensureHostSupports } from "../backend/labHostSupport";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getMgmtNetwork(doc: unknown): string | undefined {
  if (!isRecord(doc)) return undefined;
  const mgmt = doc.mgmt;
  if (!isRecord(mgmt)) return undefined;
  return typeof mgmt.network === "string" ? mgmt.network : undefined;
}

function buildNetworkFromYaml(topoPath: string): string {
  try {
    const content = fs.readFileSync(topoPath, "utf8");
    const doc: unknown = YAML.parse(content);
    const net = getMgmtNetwork(doc);
    if (typeof net === "string" && net.trim().length > 0) {
      return net.trim();
    }
  } catch {
    // ignore errors
  }
  return "clab";
}

async function runFcling(node: ClabLabTreeNode | undefined, cmd: string): Promise<void> {
  if (!node) {
    vscode.window.showErrorMessage("No lab node selected.");
    return;
  }
  if (!(await ensureHostSupports(connectionOf(node), "fcling", "fcling"))) return;

  const topo = node.labPath.absolute;
  if (topo.length === 0) {
    vscode.window.showErrorMessage("No topology path found.");
    return;
  }

  if (isRemote(node)) {
    void runRemoteFcling(node, cmd);
    return;
  }

  const config = vscode.workspace.getConfiguration("containerlab");
  const runtime = config.get<string>("runtime", "docker");
  const extraArgs = config.get<string>("extras.fcling.extraDockerArgs", "");

  const network = buildNetworkFromYaml(topo);

  const command = `${runtime} run --pull missing -it --network ${network} --rm -v /etc/hosts:/etc/hosts:ro -v "${topo}":/topo.yml ${extraArgs} ${FCLING_IMAGE} -t /topo.yml ${cmd}`;

  execCommandInTerminal(command, `fcling - ${node.label}`);
}

/** fcling on the lab host; its report opens in an editor. */
async function runRemoteFcling(node: ClabLabTreeNode, cmd: string): Promise<void> {
  try {
    const { backend, target } = await resolveLab(
      node.labPath.absolute,
      node.name,
      node.connectionId
    );
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `fcling ${cmd}` },
      () => backend.fcling(target, cmd)
    );
    const document = await vscode.workspace.openTextDocument({ content: result.output });
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`fcling ${cmd} failed: ${message}`);
  }
}

export const fclingBgpPeers = (node: ClabLabTreeNode) => runFcling(node, "bgp-peers");
export const fclingBgpRib = (node: ClabLabTreeNode) => runFcling(node, "bgp-rib");
export const fclingIpv4Rib = (node: ClabLabTreeNode) => runFcling(node, "ipv4-rib");
export const fclingLldp = (node: ClabLabTreeNode) => runFcling(node, "lldp");
export const fclingMac = (node: ClabLabTreeNode) => runFcling(node, "mac");
export const fclingNi = (node: ClabLabTreeNode) => runFcling(node, "ni");
export const fclingSubif = (node: ClabLabTreeNode) => runFcling(node, "subif");
export const fclingSysInfo = (node: ClabLabTreeNode) => runFcling(node, "sys-info");

export async function fclingCustom(node: ClabLabTreeNode) {
  const val = await vscode.window.showInputBox({
    title: "Custom fcling command",
    placeHolder: "Enter command, e.g. bgp-peers"
  });
  if (val === undefined || val.trim().length === 0) {
    return;
  }
  await runFcling(node, val.trim());
}
