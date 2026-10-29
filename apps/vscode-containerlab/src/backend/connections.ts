import { createHash } from "crypto";

import * as vscode from "vscode";
import type {
  ClusterHostSettings,
  EndpointKind,
  LabHostCheck
} from "@srl-labs/containerlab-app-contract";
import { errorStatus, type TopologyEntry } from "@srl-labs/containerlab-lab-backend";
import { ApiLabBackend } from "@srl-labs/containerlab-lab-backend/api";
import {
  CONTAINERLAB_LINUX_ONLY,
  expandKubeconfigPath
} from "@srl-labs/containerlab-lab-backend/local";

/**
 * Where labs run: this machine, a Kubernetes cluster with clabernetes that
 * containerlab on this machine reaches (`runtime: "c9s"`), or a clab-api-server.
 * In the settings a cluster is `"kind": "kubernetes"`; inside the extension it
 * is a local connection, because containerlab on this machine runs its labs.
 */
export interface LabConnection {
  id: string;
  label: string;
  kind: EndpointKind;
  /** Local connections only: `c9s` for a cluster; this machine's runtime setting otherwise. */
  runtime?: "c9s";
  /** c9s: the kubeconfig context of the cluster. */
  kubeContext?: string;
  /**
   * c9s: the kubeconfig file with the context, `~` expanded; `KUBECONFIG` of
   * VS Code (or `~/.kube/config`) when unset.
   */
  kubeconfig?: string;
  /** c9s: the namespace of every lab; a namespace per lab (`c9s-<lab>`) when unset. */
  namespace?: string;
  /** c9s: how node ports are exposed by default. */
  exposeType?: "ClusterIP" | "Headless" | "LoadBalancer" | "None";
  /** c9s: false turns persistent node volumes off by default. */
  persistence?: boolean;
  /** c9s: the image pull secret of every lab's pods by default. */
  imagePullSecret?: string;
  /** The clab-api-server URL; only for API connections. */
  url?: string;
  /** User name to sign in with, from the settings or the last sign-in. */
  username?: string;
  /** How long a sign-in lasts, e.g. "24h"; the host's default when unset. */
  sessionDuration?: string;
}

interface ConnectionSetting {
  kind?: unknown;
  runtime?: unknown;
  kubeContext?: unknown;
  kubeconfig?: unknown;
  namespace?: unknown;
  exposeType?: unknown;
  persistence?: unknown;
  imagePullSecret?: unknown;
  label?: unknown;
  url?: unknown;
  username?: unknown;
  sessionDuration?: unknown;
}

/**
 * How a connection is doing: signed in (or ready, for Local), signed out,
 * its sign-in expired, or not answering.
 */
export type ConnectionStatus = "connected" | "saved" | "session_expired" | "offline";

export const LOCAL_CONNECTION: LabConnection = {
  id: "local",
  label: "This computer",
  kind: "local"
};

/** How long a sign-in lasts unless the lab host says otherwise, as in the desktop app. */
export const DEFAULT_SESSION_DURATION = "24h";

/** Whether containerlab can run labs on this machine, and what is missing if not. */
export interface LocalStatus {
  available: boolean;
  problems: string[];
  checks?: LabHostCheck[];
  containerlabVersion?: string;
  username?: string;
}
/** URI scheme of files in a clab-api-server workspace. */
export const REMOTE_SCHEME = "clab-api";

const USERNAMES_KEY = "containerlab.connectionUsernames";

/** How often a lab host that does not answer is asked again: first after 5 s, at most every 60 s. */
const RETRY_FIRST_MS = 5000;
const RETRY_MAX_MS = 60_000;
const RETRY_TIMEOUT_MS = 5000;

function normalizeUrl(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

/** A stable id for a server URL; it is also the authority of its file URIs. */
function apiConnectionId(url: string): string {
  return `api-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
}

/**
 * A stable id for a cluster lab host, by its kubeconfig context, and its
 * kubeconfig file when it names one: the same context name in two files can
 * be two clusters. Entries without a file keep the id of the context alone.
 */
function clusterConnectionId(kubeContext: string, kubeconfig?: string): string {
  const key = kubeconfig === undefined ? kubeContext : `${kubeconfig}\n${kubeContext}`;
  return `c9s-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

const EXPOSE_TYPES = new Set(["ClusterIP", "Headless", "LoadBalancer", "None"]);

function settingString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** A kubeconfig path from the settings, with `~` expanded. */
function kubeconfigPath(value: unknown): string | undefined {
  const configured = settingString(value);
  return configured === undefined ? undefined : expandKubeconfigPath(configured);
}

/**
 * Whether a setting entry is a cluster lab host: `kind: "kubernetes"`, or
 * `kind: "local", runtime: "c9s"` as earlier builds wrote it.
 */
function isClusterSetting(setting: ConnectionSetting): boolean {
  return setting.kind === "kubernetes" || (setting.kind === "local" && setting.runtime === "c9s");
}

/** The settings entry of a cluster lab host, as the cluster form saves it. */
function clusterSettingEntry(settings: ClusterHostSettings): ConnectionSetting {
  const text = (value: string | undefined) => value?.trim() || undefined;
  const label = text(settings.label);
  const kubeconfig = text(settings.kubeconfig);
  const namespace = text(settings.namespace);
  const imagePullSecret = text(settings.imagePullSecret);
  return {
    kind: "kubernetes",
    ...(label !== undefined ? { label } : {}),
    kubeContext: settings.kubeContext.trim(),
    ...(kubeconfig !== undefined ? { kubeconfig } : {}),
    ...(namespace !== undefined ? { namespace } : {}),
    ...(settings.exposeType !== undefined && EXPOSE_TYPES.has(settings.exposeType)
      ? { exposeType: settings.exposeType }
      : {}),
    ...(settings.persistence === false ? { persistence: false } : {}),
    ...(imagePullSecret !== undefined ? { imagePullSecret } : {})
  };
}

/** A cluster lab host from its `containerlab.connections` entry. */
export function clusterConnectionFromSetting(
  setting: ConnectionSetting
): LabConnection | undefined {
  if (!isClusterSetting(setting)) return undefined;
  const kubeContext = settingString(setting.kubeContext);
  if (kubeContext === undefined) return undefined;
  const kubeconfig = kubeconfigPath(setting.kubeconfig);
  const namespace = settingString(setting.namespace);
  const exposeType = settingString(setting.exposeType);
  const imagePullSecret = settingString(setting.imagePullSecret);
  return {
    id: clusterConnectionId(kubeContext, kubeconfig),
    label: settingString(setting.label) ?? kubeContext,
    kind: "local",
    runtime: "c9s",
    kubeContext,
    ...(kubeconfig !== undefined ? { kubeconfig } : {}),
    ...(namespace !== undefined ? { namespace } : {}),
    ...(exposeType !== undefined && EXPOSE_TYPES.has(exposeType)
      ? { exposeType: exposeType as LabConnection["exposeType"] }
      : {}),
    ...(setting.persistence === false ? { persistence: false } : {}),
    ...(imagePullSecret !== undefined ? { imagePullSecret } : {})
  };
}

/** The settings of a cluster connection, for the cluster form; the kubeconfig as the user wrote it. */
export function clusterSettingsOf(connection: LabConnection): ClusterHostSettings {
  const configured = vscode.workspace
    .getConfiguration("containerlab")
    .get<ConnectionSetting[]>("connections", []);
  const entry = (Array.isArray(configured) ? configured : []).find(
    (setting) => clusterConnectionFromSetting(setting)?.id === connection.id
  );
  const kubeconfig = settingString(entry?.kubeconfig) ?? connection.kubeconfig;
  const label = settingString(entry?.label);
  return {
    kubeContext: connection.kubeContext ?? "",
    ...(label !== undefined ? { label } : {}),
    ...(kubeconfig !== undefined ? { kubeconfig } : {}),
    ...(connection.namespace !== undefined ? { namespace: connection.namespace } : {}),
    ...(connection.exposeType !== undefined ? { exposeType: connection.exposeType } : {}),
    ...(connection.persistence === false ? { persistence: false } : {}),
    ...(connection.imagePullSecret !== undefined
      ? { imagePullSecret: connection.imagePullSecret }
      : {})
  };
}

/** Whether a connection is a Kubernetes cluster that containerlab on this machine runs labs on. */
export function isClusterConnection(connection: LabConnection): boolean {
  return connection.kind === "local" && connection.runtime === "c9s";
}

/** Whether a connection is this machine with Docker or Podman, which is hidden instead of removed. */
export function isThisComputer(connection: LabConnection): boolean {
  return connection.kind === "local" && !isClusterConnection(connection);
}

function tokenKey(url: string): string {
  return `containerlab.connection.token:${url}`;
}

/**
 * The connections the extension runs labs through: "This computer" (this machine)
 * and the lab hosts (clab-api-servers) in the `containerlab.connections`
 * setting. The views show the labs of all of them side by side.
 */
export class ConnectionManager implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<LabConnection | undefined>();
  /**
   * Fires when a connection signs in or out, its status changes, or the
   * list changes (with no connection).
   */
  readonly onDidChange = this.changeEmitter.event;
  private readonly backends = new Map<string, ApiLabBackend>();
  private readonly topologies = new Map<string, { at: number; entries: TopologyEntry[] }>();
  /** Topology lists being fetched; callers at the same time share the request. */
  private readonly topologyRequests = new Map<
    string,
    { backend: ApiLabBackend; request: Promise<TopologyEntry[]> }
  >();
  /** Why a connection does not answer: an unreachable host, or what Local is missing. */
  private readonly problems = new Map<string, string>();
  /** What the last check of this machine found. */
  private localStatus: LocalStatus | undefined;
  /** Each check of the last look at a local connection (this machine or a cluster). */
  private readonly checks = new Map<string, LabHostCheck[]>();
  private readonly expired = new Set<string>();
  /** Pending checks of lab hosts that do not answer, by connection id. */
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disposables: vscode.Disposable[] = [];

  private readonly localSupported: boolean;

  constructor(
    private readonly context: vscode.ExtensionContext,
    options: { localSupported?: boolean } = {}
  ) {
    this.localSupported = options.localSupported ?? true;
    this.disposables.push(
      this.changeEmitter,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("containerlab.connections") ||
          event.affectsConfiguration("containerlab.localConnection")
        ) {
          this.changeEmitter.fire(undefined);
        }
      })
    );
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    for (const timer of this.retries.values()) clearTimeout(timer);
    this.retries.clear();
  }

  private localEnabled(): boolean {
    return (
      this.localSupported &&
      vscode.workspace.getConfiguration("containerlab").get<boolean>("localConnection", true)
    );
  }

  private savedUsernames(): Record<string, string> {
    return this.context.globalState.get<Record<string, string>>(USERNAMES_KEY, {});
  }

  /**
   * Whether containerlab runs where the extension runs (Linux, or WSL). Labs
   * on this machine and on Kubernetes clusters both need it.
   */
  get localAvailable(): boolean {
    return this.localSupported;
  }

  /**
   * Why cluster lab hosts are left out on this platform, when the settings
   * name any; undefined where containerlab runs.
   */
  ignoredClusters(): string | undefined {
    if (this.localSupported) return undefined;
    const settings = vscode.workspace
      .getConfiguration("containerlab")
      .get<ConnectionSetting[]>("connections", []);
    const count = (Array.isArray(settings) ? settings : []).filter(isClusterSetting).length;
    if (count === 0) return undefined;
    return `${count === 1 ? "1 Kubernetes lab host is" : `${count} Kubernetes lab hosts are`} left out: ${CONTAINERLAB_LINUX_ONLY}`;
  }

  /** This computer first (unless turned off), then the configured lab hosts. */
  list(): LabConnection[] {
    const connections: LabConnection[] = [];
    if (this.localEnabled()) {
      connections.push(LOCAL_CONNECTION);
    }
    const settings = vscode.workspace
      .getConfiguration("containerlab")
      .get<ConnectionSetting[]>("connections", []);
    const usernames = this.savedUsernames();
    for (const setting of Array.isArray(settings) ? settings : []) {
      // containerlab on this machine runs a cluster's labs; without Linux it cannot.
      const cluster = this.localSupported ? clusterConnectionFromSetting(setting) : undefined;
      if (cluster) {
        if (!connections.some((connection) => connection.id === cluster.id))
          connections.push(cluster);
        continue;
      }
      if (isClusterSetting(setting)) continue;
      const url = typeof setting.url === "string" ? normalizeUrl(setting.url) : undefined;
      if (url === undefined) continue;
      const id = apiConnectionId(url);
      if (connections.some((connection) => connection.id === id)) continue;
      const label =
        typeof setting.label === "string" && setting.label.trim()
          ? setting.label.trim()
          : new URL(url).host;
      const username =
        typeof setting.username === "string" && setting.username.trim()
          ? setting.username.trim()
          : usernames[url];
      const sessionDuration =
        typeof setting.sessionDuration === "string" && setting.sessionDuration.trim()
          ? setting.sessionDuration.trim()
          : undefined;
      connections.push({
        id,
        label,
        kind: "api",
        url,
        ...(username ? { username } : {}),
        ...(sessionDuration !== undefined ? { sessionDuration } : {})
      });
    }
    return connections;
  }

  get(id: string): LabConnection | undefined {
    return this.list().find((connection) => connection.id === id);
  }

  /** Whether the views group labs by connection: with lab hosts next to Local, or several hosts. */
  get grouped(): boolean {
    const connections = this.list();
    return connections.length > 1 || connections.some((connection) => connection.kind === "api");
  }

  status(connection: LabConnection): ConnectionStatus {
    if (this.problems.has(connection.id)) return "offline";
    if (connection.kind === "local") return "connected";
    if (this.backends.has(connection.id)) return "connected";
    return this.expired.has(connection.id) ? "session_expired" : "saved";
  }

  /** The checks of the last look at a local connection, for the Lab Hosts page. */
  checksOf(connection: LabConnection): LabHostCheck[] | undefined {
    return this.checks.get(connection.id);
  }

  /** Records the checks of a local connection and, from them, whether it can run labs. */
  setChecks(connection: LabConnection, checks: LabHostCheck[], problems: string[]): void {
    this.checks.set(connection.id, checks);
    this.setProblem(connection, problems.length === 0 ? undefined : problems.join(" "));
  }

  /** What is wrong with a connection that does not answer. */
  problem(connection: LabConnection): string | undefined {
    return this.problems.get(connection.id);
  }

  /** Records that a connection answered, or why it did not. */
  setProblem(connection: LabConnection, problem: string | undefined): void {
    const previous = this.problems.get(connection.id);
    if (previous === problem) return;
    if (problem === undefined) this.problems.delete(connection.id);
    else this.problems.set(connection.id, problem);
    if (connection.kind === "api") {
      if (problem === undefined) this.cancelRetry(connection.id);
      else this.scheduleRetry(connection, RETRY_FIRST_MS);
    }
    this.changeEmitter.fire(connection);
  }

  /**
   * Asks a signed-in lab host that did not answer whether it is back.
   * True when it answers; otherwise it is asked again later.
   */
  async retry(connection: LabConnection, delayMs = RETRY_FIRST_MS): Promise<boolean> {
    this.cancelRetry(connection.id);
    const backend = this.backends.get(connection.id);
    if (!backend || !this.problems.has(connection.id)) return false;
    try {
      await backend.version({ timeoutMs: RETRY_TIMEOUT_MS });
    } catch (error) {
      if (errorStatus(error) === 401) {
        await this.expire(connection);
        return false;
      }
      // Still not answering, unless it signed out in the meantime.
      if (this.backends.get(connection.id) === backend && this.problems.has(connection.id)) {
        this.scheduleRetry(connection, Math.min(delayMs * 2, RETRY_MAX_MS));
      }
      return false;
    }
    if (this.backends.get(connection.id) !== backend) return false;
    this.setProblem(connection, undefined);
    return true;
  }

  private scheduleRetry(connection: LabConnection, delayMs: number): void {
    if (this.retries.has(connection.id) || !this.backends.has(connection.id)) return;
    this.retries.set(
      connection.id,
      setTimeout(() => void this.retry(connection, delayMs), delayMs)
    );
  }

  private cancelRetry(connectionId: string): void {
    const timer = this.retries.get(connectionId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.retries.delete(connectionId);
  }

  /** What the last check of this machine found; undefined before the first check. */
  get local(): LocalStatus | undefined {
    return this.localStatus;
  }

  /** Records a check of this machine; its problems show on Local's root. */
  setLocalStatus(status: LocalStatus): void {
    this.localStatus = status;
    if (status.checks) this.checks.set(LOCAL_CONNECTION.id, status.checks);
    this.setProblem(LOCAL_CONNECTION, status.available ? undefined : status.problems.join(" "));
    this.changeEmitter.fire(LOCAL_CONNECTION);
  }

  /** Loads the stored tokens of all lab hosts, e.g. after VS Code starts. */
  async restoreAll(): Promise<void> {
    await Promise.all(
      this.list()
        .filter((connection) => connection.kind === "api")
        .map((connection) => this.restore(connection))
    );
  }

  /**
   * The host rejected the token, e.g. because the session expired: forget
   * it and offer to sign in again.
   */
  async expire(connection: LabConnection): Promise<void> {
    if (!this.backends.has(connection.id)) return;
    await this.signOut(connection);
    this.expired.add(connection.id);
    this.changeEmitter.fire(connection);
    const choice = await vscode.window.showWarningMessage(
      `Your sign-in to ${connection.label} has expired.`,
      "Sign In"
    );
    if (choice === "Sign In") await this.promptSignIn(connection);
  }

  /** The backend of an API connection, if it is signed in. */
  apiBackend(connection: LabConnection): ApiLabBackend | undefined {
    return connection.kind === "api" ? this.backends.get(connection.id) : undefined;
  }

  /** Loads a stored token, so a signed-in connection works after a restart. */
  async restore(connection: LabConnection): Promise<ApiLabBackend | undefined> {
    if (connection.kind !== "api" || connection.url === undefined) return undefined;
    const existing = this.backends.get(connection.id);
    if (existing) return existing;
    const token = await Promise.resolve(this.context.secrets.get(tokenKey(connection.url))).catch(
      () => undefined
    );
    if (token === undefined || token === "") return undefined;
    const backend = new ApiLabBackend({ baseUrl: connection.url, token });
    this.backends.set(connection.id, backend);
    return backend;
  }

  /** The signed-in backend of an API connection; asks for the password when there is no token. */
  async ensureBackend(connection: LabConnection): Promise<ApiLabBackend | undefined> {
    return (
      this.apiBackend(connection) ??
      (await this.restore(connection)) ??
      (await this.promptSignIn(connection))
    );
  }

  /** Signs in with a password; the token goes to SecretStorage, never to the settings. */
  async signIn(
    connection: LabConnection,
    username: string,
    password: string,
    sessionDuration = connection.sessionDuration ?? DEFAULT_SESSION_DURATION
  ): Promise<ApiLabBackend> {
    if (connection.kind !== "api" || connection.url === undefined) {
      throw new Error("Only lab hosts need a sign-in.");
    }
    const backend = await ApiLabBackend.login({
      baseUrl: connection.url,
      username,
      password,
      ...(sessionDuration !== "" ? { sessionDuration } : {})
    });
    try {
      await this.context.secrets.store(tokenKey(connection.url), backend.token);
    } catch {
      // No keyring: the sign-in lasts until VS Code closes.
    }
    await this.context.globalState.update(USERNAMES_KEY, {
      ...this.savedUsernames(),
      [connection.url]: username
    });
    this.backends.set(connection.id, backend);
    this.topologies.delete(connection.id);
    this.expired.delete(connection.id);
    this.problems.delete(connection.id);
    this.changeEmitter.fire(connection);
    return backend;
  }

  async signOut(connection: LabConnection): Promise<void> {
    if (connection.url === undefined) return;
    this.backends.delete(connection.id);
    this.topologies.delete(connection.id);
    this.problems.delete(connection.id);
    this.cancelRetry(connection.id);
    await Promise.resolve(this.context.secrets.delete(tokenKey(connection.url))).catch(() => {});
    this.changeEmitter.fire(connection);
  }

  /** Asks for the password and signs in; undefined when the user cancels. */
  async promptSignIn(connection: LabConnection): Promise<ApiLabBackend | undefined> {
    const username = await vscode.window.showInputBox({
      title: `Sign in to ${connection.label}`,
      prompt: `User on ${connection.url}`,
      value: connection.username ?? "",
      ignoreFocusOut: true
    });
    if (username === undefined || username === "") return undefined;
    const password = await vscode.window.showInputBox({
      title: `Sign in to ${connection.label}`,
      prompt: `Password of ${username}`,
      password: true,
      ignoreFocusOut: true
    });
    if (password === undefined) return undefined;
    try {
      return await this.signIn(connection, username, password);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Sign-in to ${connection.label} failed: ${message}`);
      return undefined;
    }
  }

  /** The workspace topologies of an API connection, cached for a few seconds. */
  async remoteTopologies(connection: LabConnection, maxAgeMs = 5000): Promise<TopologyEntry[]> {
    const backend = this.apiBackend(connection) ?? (await this.restore(connection));
    if (!backend) return [];
    const cached = this.topologies.get(connection.id);
    if (cached && Date.now() - cached.at < maxAgeMs) return cached.entries;
    // A host that does not answer is asked again by `retry`, not on every refresh.
    if (this.problems.has(connection.id)) return cached?.entries ?? [];
    const pending = this.topologyRequests.get(connection.id);
    if (pending?.backend === backend) return pending.request;
    const request = backend.listTopologies().then(
      (entries) => {
        this.topologies.set(connection.id, { at: Date.now(), entries });
        return entries;
      },
      (error: unknown) => {
        if (errorStatus(error) === undefined && this.backends.get(connection.id) === backend) {
          this.setProblem(connection, error instanceof Error ? error.message : String(error));
        }
        throw error;
      }
    );
    const settle = () => {
      if (this.topologyRequests.get(connection.id)?.request === request) {
        this.topologyRequests.delete(connection.id);
      }
    };
    request.then(settle, settle);
    this.topologyRequests.set(connection.id, { backend, request });
    return request;
  }

  /** The cached topologies, without asking the server. */
  cachedTopologies(connection: LabConnection): TopologyEntry[] {
    return this.topologies.get(connection.id)?.entries ?? [];
  }

  /**
   * Signs in to a new lab host and saves it once the sign-in worked, so a
   * typo in the URL or password does not leave a host behind.
   */
  async addAndSignIn(input: {
    label?: string;
    url: string;
    username: string;
    password: string;
    sessionDuration?: string;
  }): Promise<LabConnection> {
    const normalized = normalizeUrl(input.url);
    if (normalized === undefined) throw new Error(`"${input.url}" is not an http(s) URL.`);
    const named = input.label?.trim() ?? "";
    const label = named !== "" ? named : new URL(normalized).host;
    const pending: LabConnection = {
      id: apiConnectionId(normalized),
      label,
      kind: "api",
      url: normalized,
      username: input.username,
      ...(input.sessionDuration !== undefined && input.sessionDuration !== ""
        ? { sessionDuration: input.sessionDuration }
        : {})
    };
    await this.signIn(pending, input.username, input.password, input.sessionDuration);
    return this.addConnection(label, normalized, {
      username: input.username,
      sessionDuration: input.sessionDuration
    });
  }

  /**
   * Adds a lab host to the user settings, or updates the one with the same URL.
   * The setting is machine-scoped, so in a remote window this writes the
   * remote machine's settings and leaves the local list alone.
   */
  async addConnection(
    label: string,
    url: string,
    details: { username?: string; sessionDuration?: string } = {}
  ): Promise<LabConnection> {
    const normalized = normalizeUrl(url);
    if (normalized === undefined) throw new Error(`"${url}" is not an http(s) URL.`);
    const config = vscode.workspace.getConfiguration("containerlab");
    const current = config.get<ConnectionSetting[]>("connections", []);
    const next = (Array.isArray(current) ? current : []).filter(
      (entry) => typeof entry.url !== "string" || normalizeUrl(entry.url) !== normalized
    );
    next.push({
      label,
      url: normalized,
      ...(details.username !== undefined && details.username !== ""
        ? { username: details.username }
        : {}),
      ...(details.sessionDuration !== undefined && details.sessionDuration !== ""
        ? { sessionDuration: details.sessionDuration }
        : {})
    });
    await config.update("connections", next, vscode.ConfigurationTarget.Global);
    const connection = this.get(apiConnectionId(normalized));
    if (!connection) throw new Error("The lab host could not be saved.");
    return connection;
  }

  /**
   * Changes a lab host's name, URL, user or sign-in length. A new URL or
   * user needs a new sign-in.
   */
  async updateConnection(
    connection: LabConnection,
    changes: { label: string; url: string; username: string; sessionDuration?: string }
  ): Promise<LabConnection> {
    const normalized = normalizeUrl(changes.url);
    if (normalized === undefined) throw new Error(`"${changes.url}" is not an http(s) URL.`);
    if (normalized !== connection.url || changes.username !== (connection.username ?? "")) {
      await this.signOut(connection);
    }
    const config = vscode.workspace.getConfiguration("containerlab");
    const current = config.get<ConnectionSetting[]>("connections", []);
    const next = (Array.isArray(current) ? current : []).map((entry) =>
      typeof entry.url === "string" && normalizeUrl(entry.url) === connection.url
        ? {
            label: changes.label,
            url: normalized,
            ...(changes.username !== "" ? { username: changes.username } : {}),
            ...(changes.sessionDuration !== undefined && changes.sessionDuration !== ""
              ? { sessionDuration: changes.sessionDuration }
              : {})
          }
        : entry
    );
    await config.update("connections", next, vscode.ConfigurationTarget.Global);
    const updated = this.get(apiConnectionId(normalized));
    if (!updated) throw new Error("The lab host could not be saved.");
    return updated;
  }

  /**
   * Adds a Kubernetes cluster as a lab host, or updates the one with the same
   * context and kubeconfig. containerlab on this machine runs its labs with `-r c9s`.
   */
  async addClusterConnection(input: {
    kubeContext: string;
    /** The kubeconfig file with the context; VS Code's default kubeconfig when unset. */
    kubeconfig?: string;
    label?: string;
    namespace?: string;
  }): Promise<LabConnection> {
    return this.saveClusterConnection(input);
  }

  /**
   * Saves a cluster lab host from the cluster form: a new one, or `previous`
   * changed. Another entry with the same context and kubeconfig is replaced.
   */
  async saveClusterConnection(
    settings: ClusterHostSettings,
    previous?: LabConnection
  ): Promise<LabConnection> {
    if (!this.localSupported) throw new Error(CONTAINERLAB_LINUX_ONLY);
    const kubeContext = settings.kubeContext.trim();
    if (!kubeContext) throw new Error("A Kubernetes lab host needs a kubeconfig context.");
    const kubeconfig = settings.kubeconfig?.trim();
    const id = clusterConnectionId(
      kubeContext,
      kubeconfig ? expandKubeconfigPath(kubeconfig) : undefined
    );
    const config = vscode.workspace.getConfiguration("containerlab");
    const current = config.get<ConnectionSetting[]>("connections", []);
    const entries = Array.isArray(current) ? current : [];
    const entry = clusterSettingEntry({ ...settings, kubeContext });
    const replaced = new Set([id, ...(previous ? [previous.id] : [])]);
    // The edited entry keeps its place in the list; a new one goes last.
    const index = entries.findIndex((setting) => {
      const cluster = clusterConnectionFromSetting(setting);
      return cluster !== undefined && replaced.has(cluster.id);
    });
    const next = entries.filter((setting) => {
      const cluster = clusterConnectionFromSetting(setting);
      return cluster === undefined || !replaced.has(cluster.id);
    });
    next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, entry);
    await config.update("connections", next, vscode.ConfigurationTarget.Global);
    if (previous && previous.id !== id) {
      this.problems.delete(previous.id);
      this.checks.delete(previous.id);
    }
    const connection = this.get(id);
    if (!connection) throw new Error("The cluster could not be saved.");
    this.changeEmitter.fire(undefined);
    return connection;
  }

  async removeConnection(connection: LabConnection): Promise<void> {
    if (isClusterConnection(connection)) {
      const config = vscode.workspace.getConfiguration("containerlab");
      const current = config.get<ConnectionSetting[]>("connections", []);
      await config.update(
        "connections",
        (Array.isArray(current) ? current : []).filter(
          (entry) => clusterConnectionFromSetting(entry)?.id !== connection.id
        ),
        vscode.ConfigurationTarget.Global
      );
      this.problems.delete(connection.id);
      this.checks.delete(connection.id);
      return;
    }
    if (connection.kind !== "api" || connection.url === undefined) return;
    await this.signOut(connection);
    const config = vscode.workspace.getConfiguration("containerlab");
    const current = config.get<ConnectionSetting[]>("connections", []);
    await config.update(
      "connections",
      (Array.isArray(current) ? current : []).filter(
        (entry) => typeof entry.url !== "string" || normalizeUrl(entry.url) !== connection.url
      ),
      vscode.ConfigurationTarget.Global
    );
  }

  /** Shows or hides Local, labs on this machine. */
  async setLocalEnabled(enabled: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration("containerlab")
      .update("localConnection", enabled, vscode.ConfigurationTarget.Global);
  }
}
