import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import * as vscode from "vscode";
import type { LabBackend, LabTarget } from "@srl-labs/containerlab-lab-backend";
import {
  LocalLabBackend,
  type LocalLabBackendOptions
} from "@srl-labs/containerlab-lab-backend/local";
import YAML from "yaml";

import { containerlabBinaryPath } from "../globals";

import { ConnectionManager, REMOTE_SCHEME, type LabConnection } from "./connections";

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function splitArgs(value: string): string[] {
  return value.split(/\s+/).filter((arg) => arg.length > 0);
}

/** Local backend options from the extension settings. */
function localBackendOptions(): LocalLabBackendOptions {
  const config = vscode.workspace.getConfiguration("containerlab");
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const extraEnv = config
    .get<string>("capture.edgeshark.extraEnvironmentVars", "HTTP_PROXY=, http_proxy=")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes("="));
  return {
    binaryPath: containerlabBinaryPath || "containerlab",
    runtime: config.get<string>("runtime", "docker"),
    dockerSocketPath: config.get<string>("dockerSocketPath", "/var/run/docker.sock"),
    workspaceRoot: workspaceFolder ?? path.join(os.homedir(), ".clab"),
    deployExtraArgs: splitArgs(config.get<string>("deploy.extraArgs", "")),
    destroyExtraArgs: splitArgs(config.get<string>("destroy.extraArgs", "")),
    packetflixPort: config.get<number>("capture.packetflixPort", 5001),
    wiresharkImage: config.get<string>("capture.wireshark.dockerImage", ""),
    edgesharkExtraEnv: extraEnv
  };
}

let localBackend: LocalLabBackend | undefined;
let localBackendKey = "";
let connections: ConnectionManager | undefined;

/** The backend for containerlab on this machine, rebuilt when its settings change. */
export function getLocalBackend(): LocalLabBackend {
  const options = localBackendOptions();
  const key = JSON.stringify(options);
  if (!localBackend || key !== localBackendKey) {
    void localBackend?.dispose();
    localBackend = new LocalLabBackend(options);
    localBackendKey = key;
  }
  return localBackend;
}

/** Starts connection management; without it every lab is local. */
export function initConnections(
  context: vscode.ExtensionContext,
  options: { localSupported?: boolean } = {}
): ConnectionManager {
  connections ??= new ConnectionManager(context, options);
  return connections;
}

export function getConnections(): ConnectionManager | undefined {
  return connections;
}

/** The connection whose labs the views show. */
export function activeConnection(): LabConnection {
  return connections?.active ?? { id: "local", label: "Local", kind: "local" };
}

export function isRemoteActive(): boolean {
  return activeConnection().kind === "api";
}

/**
 * The backend that runs the labs the extension shows: the local CLI, or the
 * signed-in clab-api-server of the active connection.
 */
export function getLabBackend(): LabBackend {
  const active = activeConnection();
  if (active.kind === "local") {
    return getLocalBackend();
  }
  const backend = connections?.activeBackend();
  if (!backend) {
    throw new Error(`Sign in to ${active.label} first (Containerlab: Sign In to Lab Server).`);
  }
  return backend;
}

/** A topology to fetch from Git or the web, e.g. `https://github.com/srl-labs/srlinux-getting-started`. */
export function isLabSourceUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** A path on this machine, or a URI such as `clab-api://<connection>/<path>`. */
export function isUriString(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

export function labUri(pathOrUri: string): vscode.Uri {
  return isUriString(pathOrUri) ? vscode.Uri.parse(pathOrUri) : vscode.Uri.file(pathOrUri);
}

/** How the extension refers to a topology: a path on this machine, a URI otherwise. */
export function labPathOf(uri: vscode.Uri): string {
  return uri.scheme === "file" ? uri.fsPath : uri.toString();
}

/** The URI of a file in a clab-api-server workspace. */
export function remoteUri(connection: LabConnection, workspacePath: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: REMOTE_SCHEME,
    authority: connection.id,
    path: `/${workspacePath.replace(/^\/+/, "")}`
  });
}

function remoteLabNameFallback(workspacePath: string): string {
  const segments = workspacePath.split("/");
  return segments.length > 1 ? segments[0] : segments[0].replace(/\.clab\.ya?ml$/i, "");
}

/**
 * The lab name a topology file declares, the name containerlab runs it under;
 * the file name without `.clab.yml` when the file has none. Files on a lab
 * server are named the way the server lists them.
 */
export function labNameForPath(labPath: string): string {
  if (isUriString(labPath)) {
    const uri = vscode.Uri.parse(labPath);
    const workspacePath = uri.path.replace(/^\/+/, "");
    const connection = connections?.get(uri.authority);
    const entry = connection
      ? connections
          ?.cachedTopologies(connection)
          .find((topology) => topology.yamlFileName === workspacePath)
      : undefined;
    return entry?.labName ?? remoteLabNameFallback(workspacePath);
  }
  try {
    const parsed: unknown = YAML.parse(fs.readFileSync(labPath, "utf8"));
    const name: unknown =
      typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "name") : undefined;
    if (typeof name === "string" && name.trim().length > 0) {
      return name.trim();
    }
  } catch {
    // Unreadable or not YAML; fall back to the file name.
  }
  return path.basename(labPath).replace(/\.clab\.ya?ml$/i, "");
}

/** The backend and target for a lab given by its topology path or URI. */
export interface ResolvedLab {
  backend: LabBackend;
  target: LabTarget;
}

/** A lab whose topology is a file in a clab-api-server workspace. */
async function resolveRemoteFile(labPath: string, labName?: string): Promise<ResolvedLab> {
  const uri = vscode.Uri.parse(labPath);
  if (uri.scheme !== REMOTE_SCHEME) {
    throw new Error(`Labs cannot run from ${uri.scheme}: files.`);
  }
  const connection = connections?.get(uri.authority);
  if (!connections || !connection) {
    throw new Error("The lab server of this file is no longer configured.");
  }
  const backend = await connections.ensureBackend(connection);
  if (!backend) {
    throw new Error(`Sign in to ${connection.label} first.`);
  }
  // The topology list maps the file to the name the server runs the lab under.
  await connections.remoteTopologies(connection).catch(() => []);
  return {
    backend,
    target: {
      labName: nonEmpty(labName) ?? labNameForPath(labPath),
      path: uri.path.replace(/^\/+/, "")
    }
  };
}

/**
 * Where a lab command goes. Local labs are addressed by their topology file
 * (containerlab finds the lab name in it); labs on a server by name, with the
 * workspace path of their topology when there is one.
 */
export async function resolveLab(labPath: string, labName?: string): Promise<ResolvedLab> {
  if (isLabSourceUrl(labPath)) {
    // containerlab and clab-api-server fetch the topology themselves.
    const backend = isRemoteActive() ? getLabBackend() : getLocalBackend();
    return { backend, target: { labName: labName ?? "", path: labPath } };
  }
  if (isUriString(labPath)) {
    return resolveRemoteFile(labPath, labName);
  }
  const active = activeConnection();
  if (active.kind === "api") {
    // A running lab on the server whose topology is outside the workspace.
    return {
      backend: getLabBackend(),
      target: { labName: nonEmpty(labName) ?? labNameForPath(labPath) }
    };
  }
  // containerlab reads the lab name from the topology file.
  return { backend: getLocalBackend(), target: { labName: "", path: labPath } };
}

/**
 * The path the views use for a lab topology on the server: its workspace URI
 * when the server lists it, the server's own path otherwise.
 */
export function viewLabPath(serverPath: string): string {
  const active = activeConnection();
  if (active.kind !== "api" || !serverPath || isUriString(serverPath)) {
    return serverPath;
  }
  const entry = connections
    ?.cachedTopologies(active)
    .find((topology) => topology.absolutePath === serverPath);
  return entry ? remoteUri(active, entry.yamlFileName).toString() : serverPath;
}

export async function disposeLabBackends(): Promise<void> {
  await localBackend?.dispose();
  localBackend = undefined;
  localBackendKey = "";
}
