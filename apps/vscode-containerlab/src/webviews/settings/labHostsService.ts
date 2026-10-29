import * as os from "os";
import * as path from "path";

import * as vscode from "vscode";
import type { ClusterHostSettings } from "@srl-labs/containerlab-app-contract";
import type { LabHostsSnapshot } from "@containerlab/clab-ui/settings/schema";
import { defaultKubeconfigFile, readKubeContexts } from "@srl-labs/containerlab-lab-backend/local";

import { backendFor, connectionById, getConnections } from "../../backend/labBackends";
import {
  clusterSettingsOf,
  DEFAULT_SESSION_DURATION,
  isClusterConnection,
  LOCAL_CONNECTION,
  type ConnectionManager,
  type LabConnection
} from "../../backend/connections";
import { cachedLabHostInfo } from "../../backend/labHostSupport";
import { checkClusterSettings, checkLocalLabHost } from "../../backend/labHostChecks";

type LabHost = LabHostsSnapshot["hosts"][number];

/** Why this window offers no clusters: containerlab here deploys a cluster's labs, and it needs Linux. */
const CLUSTERS_NEED_LINUX =
  "containerlab runs on Linux only, and it deploys a cluster's labs from this computer. Use a lab server that runs Kubernetes, or open this window in WSL.";

/** A path in the home folder as `~/…`, the way users write a kubeconfig path. */
function homeRelative(file: string): string {
  const home = os.homedir();
  return file.startsWith(`${home}${path.sep}`) ? `~${file.slice(home.length)}` : file;
}

/** Where a lab host's labs run and how it is set up, for its card. */
function hostDetails(
  connections: ConnectionManager,
  connection: LabConnection,
  connected: boolean
): Partial<LabHost> {
  if (isClusterConnection(connection)) {
    const settings = clusterSettingsOf(connection);
    const checks = connections.checksOf(connection);
    return {
      runtime: "c9s",
      kubeContext: settings.kubeContext,
      ...(settings.kubeconfig !== undefined ? { kubeconfig: settings.kubeconfig } : {}),
      ...(settings.namespace !== undefined ? { namespace: settings.namespace } : {}),
      ...(settings.exposeType !== undefined ? { exposeType: settings.exposeType } : {}),
      persistence: settings.persistence !== false,
      ...(settings.imagePullSecret !== undefined
        ? { imagePullSecret: settings.imagePullSecret }
        : {}),
      editable: true,
      ...(checks !== undefined ? { checks } : {})
    };
  }
  if (connection.kind === "local") {
    const runtime = vscode.workspace
      .getConfiguration("containerlab")
      .get<string>("runtime", "docker");
    const checks = connections.checksOf(connection);
    return {
      runtime: runtime === "podman" ? "podman" : "docker",
      ...(checks !== undefined ? { checks } : {})
    };
  }
  // A lab server tells what it runs once signed in.
  const profile = connected ? cachedLabHostInfo(connection)?.profile : undefined;
  if (!profile) return {};
  return {
    runtime: profile.runtime,
    ...(profile.cluster !== undefined ? { cluster: profile.cluster } : {}),
    ...(profile.namespacePattern !== undefined
      ? { namespacePattern: profile.namespacePattern }
      : {}),
    ...(profile.exposeType !== undefined ? { exposeType: profile.exposeType } : {}),
    ...(profile.persistence !== undefined ? { persistence: profile.persistence } : {}),
    ...(profile.imagePullSecret !== undefined ? { imagePullSecret: profile.imagePullSecret } : {}),
    ...(profile.updateRequired !== undefined ? { updateRequired: profile.updateRequired } : {})
  };
}

/** This computer, the Kubernetes clusters and the lab servers, for the Lab Hosts page of the settings. */
export function labHostsSnapshot(): LabHostsSnapshot | undefined {
  const connections = getConnections();
  if (!connections) return undefined;
  const local = connections.local;
  return {
    hosts: connections.list().map((connection) => {
      const status = connections.status(connection);
      return {
        id: connection.id,
        kind: connection.kind,
        url: connection.url ?? "",
        label: connection.label,
        username:
          connection.kind === "local" ? (local?.username ?? "") : (connection.username ?? ""),
        sessionDuration:
          connection.kind === "local"
            ? ""
            : (connection.sessionDuration ?? DEFAULT_SESSION_DURATION),
        status,
        connected: status === "connected",
        ...hostDetails(connections, connection, status === "connected")
      };
    }),
    clusters: connections.localAvailable
      ? { defaultKubeconfig: homeRelative(defaultKubeconfigFile()) }
      : {
          unavailable: CLUSTERS_NEED_LINUX
        },
    ...(connections.localAvailable
      ? {
          local: {
            shown: connections.list().some((connection) => connection.id === LOCAL_CONNECTION.id),
            available: local?.available ?? true,
            problems: local?.problems ?? [],
            ...(local?.containerlabVersion !== undefined
              ? { containerlabVersion: local.containerlabVersion }
              : {})
          }
        }
      : {})
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function labHost(payload: Record<string, unknown>): LabConnection {
  const connection = connectionById(text(payload.endpointId));
  if (!connection) throw new Error("This lab host is no longer configured.");
  return connection;
}

/** Cluster settings from the cluster form; the extension checks them again before saving. */
function clusterSettings(value: unknown): ClusterHostSettings {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const kubeContext = text(raw.kubeContext);
  if (!kubeContext) throw new Error("Pick a kubeconfig context.");
  const field = (key: string) => text(raw[key]) || undefined;
  const exposeType = field("exposeType");
  const settings: ClusterHostSettings = { kubeContext };
  const label = field("label");
  const kubeconfig = field("kubeconfig");
  const namespace = field("namespace");
  const imagePullSecret = field("imagePullSecret");
  if (label) settings.label = label;
  if (kubeconfig) settings.kubeconfig = kubeconfig;
  if (namespace) settings.namespace = namespace;
  if (
    exposeType === "ClusterIP" ||
    exposeType === "Headless" ||
    exposeType === "LoadBalancer" ||
    exposeType === "None"
  ) {
    settings.exposeType = exposeType;
  }
  if (raw.persistence === false) settings.persistence = false;
  if (imagePullSecret) settings.imagePullSecret = imagePullSecret;
  return settings;
}

function password(payload: Record<string, unknown>): string {
  return typeof payload.password === "string" ? payload.password : "";
}

type LabHostsAction = (
  connections: ConnectionManager,
  payload: Record<string, unknown>
) => Promise<unknown>;

/** What each button of the Lab Hosts page does. */
const ACTIONS: Record<string, LabHostsAction> = {
  "labHosts.add": async (connections, payload) => {
    await connections.addAndSignIn({
      url: text(payload.url),
      label: text(payload.label),
      username: text(payload.username),
      password: password(payload),
      sessionDuration: text(payload.sessionDuration)
    });
  },
  "labHosts.signIn": async (connections, payload) => {
    await connections.signIn(labHost(payload), text(payload.username), password(payload));
  },
  "labHosts.signOut": async (connections, payload) => {
    await connections.signOut(labHost(payload));
  },
  "labHosts.update": async (connections, payload) => {
    const connection = labHost(payload);
    if (connection.kind === "local") return;
    await connections.updateConnection(connection, {
      label: text(payload.label) || connection.label,
      url: text(payload.url) || (connection.url ?? ""),
      username:
        payload.username !== undefined ? text(payload.username) : (connection.username ?? ""),
      sessionDuration:
        payload.sessionDuration !== undefined
          ? text(payload.sessionDuration)
          : connection.sessionDuration
    });
  },
  "labHosts.remove": async (connections, payload) => {
    const connection = labHost(payload);
    if (connection.id === LOCAL_CONNECTION.id) await connections.setLocalEnabled(false);
    else await connections.removeConnection(connection);
  },
  // "Check connection" answers with each check.
  "labHosts.check": async (connections, payload) =>
    checkLocalLabHost(connections, labHost(payload)),
  "labHosts.cluster.contexts": async (_connections, payload) =>
    readKubeContexts(text(payload.kubeconfig) ? { kubeconfig: text(payload.kubeconfig) } : {}),
  "labHosts.cluster.chooseKubeconfig": async () => {
    const files = await vscode.window.showOpenDialog({
      title: "kubeconfig file of the cluster",
      openLabel: "Use kubeconfig",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(path.join(os.homedir(), ".kube"))
    });
    const file = files?.[0]?.fsPath;
    return file !== undefined ? { path: homeRelative(file) } : {};
  },
  "labHosts.cluster.check": async (_connections, payload) =>
    checkClusterSettings(clusterSettings(payload.settings)),
  "labHosts.cluster.save": async (connections, payload) => {
    const previous = text(payload.endpointId) ? labHost(payload) : undefined;
    const saved = await connections.saveClusterConnection(
      clusterSettings(payload.settings),
      previous
    );
    void checkLocalLabHost(connections, saved);
  },
  "labHosts.showLocal": async (connections) => {
    await connections.setLocalEnabled(true);
  },
  "labHosts.checkLocal": async () => {
    await vscode.commands.executeCommand("containerlab.connection.checkLocal", { quiet: true });
  },
  // Health stats answer with their metrics.
  "labHosts.metrics": async (_connections, payload) => backendFor(labHost(payload)).healthMetrics()
};

/** Whether a settings request belongs to the Lab Hosts page. */
export function isLabHostsAction(action: unknown): boolean {
  return typeof action === "string" && action in ACTIONS;
}

/**
 * Runs an action of the Lab Hosts page. Health stats answer with their
 * metrics; every other action with undefined, and the page gets the new
 * settings snapshot.
 */
export async function handleLabHostsAction(payload: Record<string, unknown>): Promise<unknown> {
  const connections = getConnections();
  if (!connections) throw new Error("Containerlab is not ready yet.");
  const action = typeof payload.action === "string" ? ACTIONS[payload.action] : undefined;
  if (!action) throw new Error("Unsupported lab host action.");
  return action(connections, payload);
}
