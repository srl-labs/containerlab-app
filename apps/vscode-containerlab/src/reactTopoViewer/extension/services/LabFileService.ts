/**
 * Opens the files a topology refers to (binds, startup configs, licenses) in
 * VS Code editors, creating missing ones when asked. Files of local labs are
 * on this machine; files of labs on a lab host go through its file system.
 */

import * as path from "path";

import * as vscode from "vscode";
import { resolveWorkspaceLabFile, type LabFileRequest } from "@containerlab/clab-ui/host";

import { getConnections, isUriString } from "../../../backend/labBackends";
import { REMOTE_SCHEME } from "../../../backend/connections";

import { formatErrorMessage, log } from "./logger";

/** Absolute directory of a lab host topology, which absolute paths need. */
function remoteTopologyDir(topologyUri: vscode.Uri, workspacePath: string): string | undefined {
  if (topologyUri.scheme !== REMOTE_SCHEME) return undefined;
  const connections = getConnections();
  const connection = connections?.get(topologyUri.authority);
  const absolutePath = connection
    ? connections
        ?.cachedTopologies(connection)
        .find((topology) => topology.yamlFileName === workspacePath)?.absolutePath
    : undefined;
  return absolutePath !== undefined && absolutePath !== ""
    ? path.posix.dirname(absolutePath)
    : undefined;
}

/**
 * The URI of a file of the topology at `yamlFilePath`: relative paths start
 * at the topology's directory. Undefined for a lab host file outside its
 * workspace.
 */
export function labFileUri(yamlFilePath: string, request: LabFileRequest): vscode.Uri | undefined {
  if (!isUriString(yamlFilePath)) {
    return vscode.Uri.file(path.resolve(path.dirname(yamlFilePath), request.path));
  }
  const topologyUri = vscode.Uri.parse(yamlFilePath);
  const workspacePath = topologyUri.path.replace(/^\/+/, "");
  const filePath = resolveWorkspaceLabFile(
    request,
    workspacePath,
    remoteTopologyDir(topologyUri, workspacePath)
  );
  return filePath !== undefined ? topologyUri.with({ path: `/${filePath}` }) : undefined;
}

async function statType(uri: vscode.Uri): Promise<vscode.FileType | undefined> {
  try {
    return (await vscode.workspace.fs.stat(uri)).type;
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") return undefined;
    throw error;
  }
}

export async function openTopologyFileReference(
  yamlFilePath: string,
  request: LabFileRequest
): Promise<void> {
  const uri = labFileUri(yamlFilePath, request);
  if (!uri) {
    void vscode.window.showWarningMessage(`${request.path} is outside the lab host's workspace.`);
    return;
  }
  try {
    const type = await statType(uri);
    if (type !== undefined && (type & vscode.FileType.Directory) !== 0) {
      await vscode.commands.executeCommand("revealInExplorer", uri);
      return;
    }
    if (type === undefined) {
      if (request.create !== true) {
        void vscode.window.showWarningMessage(`${request.path} does not exist.`);
        return;
      }
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
      await vscode.workspace.fs.writeFile(uri, new Uint8Array());
      log.info(`[LabFileService] Created ${uri.toString()}`);
    }
    await vscode.window.showTextDocument(uri, {
      preview: false,
      viewColumn: vscode.ViewColumn.Beside
    });
  } catch (err) {
    const message = formatErrorMessage(err);
    log.error(`[LabFileService] Failed to open ${uri.toString()}: ${message}`);
    void vscode.window.showErrorMessage(`Failed to open ${request.path}: ${message}`);
  }
}
