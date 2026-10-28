import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import * as vscode from "vscode";
import type { LabBackend, LabTarget } from "@srl-labs/containerlab-lab-backend";
import {
  declaredTopologyName,
  LocalLabBackend,
  type LocalLabBackendOptions
} from "@srl-labs/containerlab-lab-backend/local";

import { containerlabBinaryPath } from "../globals";

import {
  ConnectionManager,
  isClusterConnection,
  LOCAL_CONNECTION,
  REMOTE_SCHEME,
  type LabConnection
} from "./connections";

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

const clusterBackends = new Map<string, { key: string; backend: LocalLabBackend }>();

/** containerlab on this machine running labs on a cluster connection's Kubernetes cluster. */
export function clusterBackendOptions(connection: LabConnection): LocalLabBackendOptions {
  return {
    ...localBackendOptions(),
    runtime: "c9s",
    c9s: {
      ...(connection.kubeContext !== undefined ? { kubeContext: connection.kubeContext } : {}),
      ...(connection.kubeconfig !== undefined ? { kubeconfig: connection.kubeconfig } : {}),
      ...(connection.namespace !== undefined ? { namespace: connection.namespace } : {}),
      ...(connection.exposeType !== undefined ? { exposeType: connection.exposeType } : {}),
      ...(connection.persistence === false ? { persistence: false } : {}),
      ...(connection.imagePullSecret !== undefined
        ? { imagePullSecret: connection.imagePullSecret }
        : {})
    }
  };
}

/** The backend of a cluster connection, rebuilt when its settings change. */
function getClusterBackend(connection: LabConnection): LocalLabBackend {
  const options = clusterBackendOptions(connection);
  const key = JSON.stringify(options);
  const cached = clusterBackends.get(connection.id);
  if (cached?.key === key) return cached.backend;
  void cached?.backend.dispose();
  const backend = new LocalLabBackend(options);
  clusterBackends.set(connection.id, { key, backend });
  return backend;
}

/** Starts connection management; without it every lab is local. */
export function initConnections(
  context: vscode.ExtensionContext,
  options: { localSupported?: boolean } = {}
): ConnectionManager {
  connections ??= new ConnectionManager(context, options);
  topologyHosts = context.workspaceState;
  return connections;
}

const TOPOLOGY_HOSTS_KEY = "containerlab.topologyLabHosts";
let topologyHosts: vscode.Memento | undefined;
/** Topologies of labs running on a cluster, as the cluster reports them (also `k8s://` paths). */
const clusterTopologies = new Map<string, string>();

/**
 * The local lab host remembered for a topology file on this machine: the one
 * it was opened from, acted on or deployed to last, else the cluster that
 * runs it. Undefined while the file has no host yet.
 */
export function knownTopologyHost(file: string): LabConnection | undefined {
  const assigned =
    topologyHosts?.get<Record<string, string>>(TOPOLOGY_HOSTS_KEY, {})[file] ??
    clusterTopologies.get(file);
  if (assigned === LOCAL_CONNECTION.id) return LOCAL_CONNECTION;
  const connection = assigned !== undefined ? connections?.get(assigned) : undefined;
  return connection && isClusterConnection(connection) ? connection : undefined;
}

/** The local lab host a topology file on this machine runs on; this machine by default. */
function labHostOfTopology(file: string): LabConnection {
  return knownTopologyHost(file) ?? LOCAL_CONNECTION;
}

/** A topology file on this machine, as opposed to a lab server URI, a URL or a cluster's own lab. */
function isLocalTopologyFile(file: string): boolean {
  return file !== "" && !isUriString(file);
}

/**
 * Remembers the lab host a topology file on this machine runs on: this
 * machine or a Kubernetes cluster. Lab servers have their own files.
 */
export async function rememberTopologyHost(file: string, connection: LabConnection): Promise<void> {
  if (!topologyHosts || !isLocalTopologyFile(file) || connection.kind !== "local") return;
  const current = topologyHosts.get<Record<string, string>>(TOPOLOGY_HOSTS_KEY, {});
  if (current[file] === connection.id) return;
  await topologyHosts.update(TOPOLOGY_HOSTS_KEY, { ...current, [file]: connection.id });
}

/**
 * Remembers the host of a topology opened or acted on from a host's section
 * of the explorer, so the viewer, the editor and the palette use it too.
 */
export async function rememberHostOf(node: {
  connectionId?: string;
  labPath?: { absolute: string };
}): Promise<void> {
  const file = node.labPath?.absolute;
  const connection =
    node.connectionId !== undefined ? connectionById(node.connectionId) : undefined;
  if (file === undefined || !connection) return;
  await rememberTopologyHost(file, connection);
}

/**
 * With Kubernetes clusters configured, asks where a topology on this machine
 * runs: this machine or a cluster. Undefined when the user cancels.
 */
export async function pickTopologyHost(
  file: string,
  labName: string,
  verb = "Deploy"
): Promise<LabConnection | undefined> {
  const clusters = (connections?.list() ?? []).filter(isClusterConnection);
  if (clusters.length === 0) return LOCAL_CONNECTION;
  const current = labHostOfTopology(file);
  const choices = [
    ...(connections?.list().some((connection) => connection.id === LOCAL_CONNECTION.id)
      ? [LOCAL_CONNECTION]
      : []),
    ...clusters
  ].sort((left, right) => Number(right.id === current.id) - Number(left.id === current.id));
  const picked = await vscode.window.showQuickPick(
    choices.map((connection) => ({
      label: `$(${isClusterConnection(connection) ? "cloud" : "vm"}) ${connection.label}`,
      description: connectionDescription(connection),
      connection
    })),
    { title: `${verb} ${labName} on`, placeHolder: "Where?" }
  );
  if (!picked) return undefined;
  await rememberTopologyHost(file, picked.connection);
  return picked.connection;
}

export function getConnections(): ConnectionManager | undefined {
  return connections;
}

/** A connection by id; Local for no id. */
export function connectionById(id: string | undefined): LabConnection | undefined {
  if (id === undefined || id === LOCAL_CONNECTION.id) return LOCAL_CONNECTION;
  return connections?.get(id);
}

function connectionOfAuthority(authority: string): LabConnection {
  return connections?.get(authority) ?? { id: authority, label: authority, kind: "api" };
}

/**
 * The connection a tree node, topology path or file URI belongs to: nodes
 * carry it, files on a lab host have it in their URI, everything else is
 * on this machine.
 */
export function connectionOf(target: unknown): LabConnection {
  if (typeof target === "string") {
    if (isUriString(target)) {
      const uri = vscode.Uri.parse(target);
      if (uri.scheme === REMOTE_SCHEME) {
        return connectionOfAuthority(uri.authority);
      }
    }
    return labHostOfTopology(target);
  }
  if (typeof target === "object" && target !== null) {
    const scheme: unknown = Reflect.get(target, "scheme");
    if (typeof scheme === "string") {
      // A vscode.Uri: files on a lab host carry it as the authority.
      return scheme === REMOTE_SCHEME
        ? connectionOfAuthority(String(Reflect.get(target, "authority")))
        : LOCAL_CONNECTION;
    }
    const connectionId: unknown = Reflect.get(target, "connectionId");
    if (typeof connectionId === "string" && connectionId !== "") {
      return connectionById(connectionId) ?? { id: connectionId, label: connectionId, kind: "api" };
    }
    const labPath: unknown = Reflect.get(target, "labPath");
    const absolute: unknown =
      typeof labPath === "object" && labPath !== null
        ? Reflect.get(labPath, "absolute")
        : undefined;
    if (typeof absolute === "string") return connectionOf(absolute);
  }
  return LOCAL_CONNECTION;
}

/** Whether a node, path or URI is on a lab host rather than this machine. */
export function isRemote(target: unknown): boolean {
  return connectionOf(target).kind === "api";
}

/**
 * The backend that runs a connection's labs: the local CLI, or the
 * signed-in clab-api-server of a lab host.
 */
export function backendFor(connection: LabConnection): LabBackend {
  if (connection.kind === "local") {
    return isClusterConnection(connection) ? getClusterBackend(connection) : getLocalBackend();
  }
  const backend = connections?.apiBackend(connection);
  if (!backend) {
    throw new Error(`Sign in to ${connection.label} first.`);
  }
  return backend;
}

/** The backend of a connection; asks for the password of a signed-out lab host. */
async function ensureBackendFor(connection: LabConnection): Promise<LabBackend> {
  if (connection.kind === "local") {
    return isClusterConnection(connection) ? getClusterBackend(connection) : getLocalBackend();
  }
  const backend = await connections?.ensureBackend(connection);
  if (!backend) throw new Error(`Sign in to ${connection.label} first.`);
  return backend;
}

/** The backend of the connection a node, path or URI belongs to. */
export function backendOf(target: unknown): LabBackend {
  return backendFor(connectionOf(target));
}

/**
 * Where a command without a node or file runs. With one connection that is
 * the one; otherwise the user picks, signed-out lab hosts included (they
 * are asked to sign in).
 */
export async function pickConnection(
  title: string,
  offered: (connection: LabConnection) => boolean = () => true
): Promise<LabConnection | undefined> {
  const listed = connections?.list() ?? [LOCAL_CONNECTION];
  // Offer the hosts that can; with none, the first, which says why it cannot.
  const all = listed.filter(offered).length > 0 ? listed.filter(offered) : listed.slice(0, 1);
  if (all.length <= 1) return all[0] ?? LOCAL_CONNECTION;
  const picked = await vscode.window.showQuickPick(
    all.map((connection) => ({
      label: `$(${connection.kind === "local" && !isClusterConnection(connection) ? "vm" : "cloud"}) ${connection.label}`,
      description: connectionDescription(connection),
      detail:
        connection.kind === "api" && connections?.status(connection) !== "connected"
          ? "Signed out: you are asked to sign in"
          : undefined,
      connection
    })),
    { title, placeHolder: "Where?" }
  );
  if (!picked) return undefined;
  if (picked.connection.kind === "api") {
    const backend = await connections?.ensureBackend(picked.connection);
    if (!backend) return undefined;
  }
  return picked.connection;
}

/** Where a connection's labs run, as the views describe it. */
export function connectionDescription(connection: LabConnection): string {
  if (isClusterConnection(connection)) {
    const where = [connection.kubeContext, connection.namespace].filter(Boolean).join("/");
    const description = where ? `Kubernetes · ${where}` : "Kubernetes";
    // Two kubeconfig files can name their contexts alike.
    return connection.kubeconfig !== undefined
      ? `${description} · ${path.basename(connection.kubeconfig)}`
      : description;
  }
  return connection.kind === "local" ? "this machine" : (connection.url ?? "");
}

/**
 * The topology path containerlab reports for a c9s lab it did not deploy:
 * `k8s://<namespace>/topologies/<lab>`. Labs containerlab deployed report
 * their file.
 */
const KUBERNETES_LAB_PATH = /^k8s:\/\//i;

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
  return segments.length > 1 ? segments[0] : topologyFileStem(segments[0]);
}

function topologyFileStem(fileName: string): string {
  return path.posix.basename(fileName).replace(/\.clab\.(ya?ml|gotmpl)$/i, "");
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
  let declared: string | undefined;
  try {
    declared = declaredTopologyName(fs.readFileSync(labPath, "utf8"), labPath);
  } catch {
    // Unreadable; fall back to the file name.
  }
  return declared !== undefined && declared !== "" ? declared : topologyFileStem(labPath);
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
    throw new Error("The lab host of this file is no longer configured.");
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
 * The host a lab path runs on. A topology on this machine runs on the host
 * given with it (a node of that host's section), else where it was opened or
 * deployed last; a cluster's own lab on the cluster that reports it.
 */
export function hostOfLabPath(labPath: string, connectionId?: string): LabConnection {
  const given = connectionById(connectionId) ?? LOCAL_CONNECTION;
  if (given.kind !== "local" || isClusterConnection(given)) return given;
  if (KUBERNETES_LAB_PATH.test(labPath)) return labHostOfTopology(labPath);
  return connectionId !== undefined || isUriString(labPath) ? given : labHostOfTopology(labPath);
}

/**
 * Where a lab command goes. Local labs are addressed by their topology file
 * (containerlab finds the lab name in it); labs on a lab host by name, with
 * the workspace path of their topology when there is one. A source URL runs
 * where `connectionId` says, Local by default.
 */
export async function resolveLab(
  labPath: string,
  labName?: string,
  connectionId?: string
): Promise<ResolvedLab> {
  const connection = hostOfLabPath(labPath, connectionId);
  if (connectionId !== undefined) void rememberTopologyHost(labPath, connection);
  if (isLabSourceUrl(labPath)) {
    // containerlab and clab-api-server fetch the topology themselves.
    return {
      backend: await ensureBackendFor(connection),
      target: { labName: labName ?? "", path: labPath }
    };
  }
  if (isClusterConnection(connection) && KUBERNETES_LAB_PATH.test(labPath)) {
    // A c9s lab whose topology lives only in the cluster.
    return {
      backend: backendFor(connection),
      target: { labName: nonEmpty(labName) ?? labPath.split("/").pop() ?? "" }
    };
  }
  if (isUriString(labPath)) {
    return resolveRemoteFile(labPath, labName);
  }
  if (connection.kind === "api") {
    // A running lab on the host whose topology is outside its workspace.
    return {
      backend: await ensureBackendFor(connection),
      target: { labName: nonEmpty(labName) ?? labNameForPath(labPath) }
    };
  }
  if (isClusterConnection(connection)) {
    // A cluster's lab reports the file it was deployed from, maybe on another
    // machine; then the lab host goes by its name.
    return {
      backend: backendFor(connection),
      target: { labName: nonEmpty(labName) ?? labNameForPath(labPath), path: labPath }
    };
  }
  // containerlab reads the lab name from the topology file.
  return { backend: backendFor(connection), target: { labName: "", path: labPath } };
}

/**
 * The path the views use for a lab topology on a lab host: its workspace URI
 * when the host lists it, the host's own path otherwise.
 */
export function viewLabPath(connection: LabConnection, serverPath: string): string {
  if (isClusterConnection(connection) && serverPath) {
    // The topology file of a cluster's lab runs on that cluster, also when opened later.
    clusterTopologies.set(serverPath, connection.id);
    return serverPath;
  }
  if (connection.kind !== "api" || !serverPath || isUriString(serverPath)) {
    return serverPath;
  }
  const entry = connections
    ?.cachedTopologies(connection)
    .find((topology) => topology.absolutePath === serverPath);
  return entry ? remoteUri(connection, entry.yamlFileName).toString() : serverPath;
}

export async function disposeLabBackends(): Promise<void> {
  const backends = [
    localBackend,
    ...Array.from(clusterBackends.values(), (entry) => entry.backend)
  ];
  clusterBackends.clear();
  localBackend = undefined;
  localBackendKey = "";
  await Promise.allSettled(backends.map(async (backend) => backend?.dispose()));
}
