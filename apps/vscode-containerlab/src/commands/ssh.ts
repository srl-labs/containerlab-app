import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import * as vscode from "vscode";
import {
  resolveNodeCredentialsFromYaml,
  type ResolvedNodeCredentials
} from "@containerlab/clab-ui/host";

import {
  type ClabContainerTreeNode,
  type ClabLabTreeNode,
  flattenContainers
} from "../treeView/common";
import { sshUserMapping } from "../globals";
import { isRemoteNode, openRemoteTerminal } from "../backend/remoteNode";

import { execCommandInTerminal } from "./command";

function resolveDistributedSrosSshTarget(node: ClabContainerTreeNode): string | undefined {
  if (node.kind !== "nokia_srsim") {
    return undefined;
  }

  const rootNodeName = node.rootNodeName?.trim();
  if (rootNodeName === undefined || rootNodeName.length === 0 || node.name.length === 0) {
    return undefined;
  }

  const fullName = node.name.trim();
  const shortName = node.name_short.trim();
  if (shortName.length > 0 && shortName.length < fullName.length && fullName.endsWith(shortName)) {
    return `${fullName.slice(0, fullName.length - shortName.length)}${rootNodeName}`;
  }

  const suffixSeparator = fullName.lastIndexOf("-");
  if (suffixSeparator > 0) {
    return fullName.slice(0, suffixSeparator);
  }

  return undefined;
}

function resolveSshTarget(node: ClabContainerTreeNode): string | undefined {
  const distributedSrosTarget = resolveDistributedSrosSshTarget(node);
  if (distributedSrosTarget !== undefined && distributedSrosTarget.length > 0) {
    return distributedSrosTarget;
  }
  if (node.name.length > 0) {
    return node.name;
  }
  if (node.v6Address !== undefined && node.v6Address.length > 0) {
    return node.v6Address;
  }
  if (node.v4Address !== undefined && node.v4Address.length > 0) {
    return node.v4Address;
  }
  if (node.cID.length > 0) {
    return node.cID;
  }
  return undefined;
}

/** Credentials the lab's topology file gives the node, if it can be read. */
function readTopologyCredentials(node: ClabContainerTreeNode): ResolvedNodeCredentials {
  const topologyPath = node.labPath?.absolute;
  if (topologyPath === undefined || topologyPath.length === 0) {
    return {};
  }
  let yaml: string;
  try {
    yaml = fs.readFileSync(topologyPath, "utf8");
  } catch {
    return {};
  }
  // Distributed SR SIM containers belong to their root node in the topology
  const nodeNames = [node.rootNodeName, node.name_short].filter(
    (name): name is string => name !== undefined && name.trim().length > 0
  );
  for (const nodeName of nodeNames) {
    const credentials = resolveNodeCredentialsFromYaml(yaml, nodeName.trim());
    if (credentials.username !== undefined || credentials.identityFile !== undefined) {
      return credentials;
    }
  }
  return {};
}

/** Resolve an identity-file path like containerlab: `~` is home, relative paths start at the topology folder. */
function resolveIdentityFile(identityFile: string, topologyPath: string): string {
  if (identityFile === "~" || identityFile.startsWith("~/")) {
    return path.join(os.homedir(), identityFile.slice(1));
  }
  return path.resolve(path.dirname(topologyPath), identityFile);
}

/** Quote a value for the terminal shell unless it is plainly safe. */
function shellQuote(value: string): string {
  if (/^[\w.@%+=:,/-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function sshToNode(node: ClabContainerTreeNode | undefined): void {
  if (!node) {
    vscode.window.showErrorMessage("No container node selected.");
    return;
  }

  const sshTarget = resolveSshTarget(node);
  if (sshTarget === undefined) {
    vscode.window.showErrorMessage("No target to connect to container");
    return;
  }

  // Get the SSH user mapping from user settings
  const config = vscode.workspace.getConfiguration("containerlab");
  const userSshMapping = config.get<Partial<Record<string, string>>>("node.sshUserMapping", {});
  const defaultMapping = sshUserMapping as Partial<Record<string, string>>;

  // The topology's credentials come first, then the user setting, the default mapping and "admin"
  if (isRemoteNode(node)) {
    // clab-api-server starts SSH on the lab host, where the node is reachable.
    void openRemoteTerminal(node, "ssh", `SSH - ${node.name}`, {
      sshUsername: userSshMapping[node.kind] ?? defaultMapping[node.kind] ?? "admin"
    });
    return;
  }
  const credentials = readTopologyCredentials(node);
  const sshUser = shellQuote(
    credentials.username ?? userSshMapping[node.kind] ?? defaultMapping[node.kind] ?? "admin"
  );
  const identityOption =
    credentials.identityFile !== undefined
      ? `-i ${shellQuote(resolveIdentityFile(credentials.identityFile, node.labPath.absolute))} `
      : "";

  execCommandInTerminal(`ssh ${identityOption}${sshUser}@${sshTarget}`, `SSH - ${sshTarget}`, true);
}

export function sshToLab(node: ClabLabTreeNode | undefined): void {
  if (!node) {
    vscode.window.showErrorMessage("No lab node selected.");
    return;
  }

  if (!node.containers) {
    vscode.window.showErrorMessage("No child containers to connect to");
    return;
  }

  flattenContainers(node.containers).forEach((c) => {
    sshToNode(c);
  });
}
