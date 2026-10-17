import { createHash } from "crypto";

import * as vscode from "vscode";
import type { TopologyEntry } from "@srl-labs/containerlab-lab-backend";
import { ApiLabBackend } from "@srl-labs/containerlab-lab-backend/api";

/** Where labs run: this machine, or a clab-api-server. */
export interface LabConnection {
  id: string;
  label: string;
  kind: "local" | "api";
  /** The clab-api-server URL; only for API connections. */
  url?: string;
  /** User name to sign in with, from the settings or the last sign-in. */
  username?: string;
  /** How long a sign-in lasts, e.g. "24h"; the host's default when unset. */
  sessionDuration?: string;
}

interface ConnectionSetting {
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

export const LOCAL_CONNECTION: LabConnection = { id: "local", label: "Local", kind: "local" };

/** How long a sign-in lasts unless the lab host says otherwise, as in the desktop app. */
export const DEFAULT_SESSION_DURATION = "24h";

/** Whether containerlab can run labs on this machine, and what is missing if not. */
export interface LocalStatus {
  available: boolean;
  problems: string[];
  containerlabVersion?: string;
  username?: string;
}
/** URI scheme of files in a clab-api-server workspace. */
export const REMOTE_SCHEME = "clab-api";

const USERNAMES_KEY = "containerlab.connectionUsernames";

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

function tokenKey(url: string): string {
  return `containerlab.connection.token:${url}`;
}

/**
 * The connections the extension runs labs through: "Local" (this machine)
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
  /** Why a connection does not answer: an unreachable host, or what Local is missing. */
  private readonly problems = new Map<string, string>();
  /** What the last check of this machine found. */
  private localStatus: LocalStatus | undefined;
  private readonly expired = new Set<string>();
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

  /** Whether this machine can run labs at all (Linux, or WSL). */
  get localAvailable(): boolean {
    return this.localSupported;
  }

  /** Local first (unless turned off), then the configured lab hosts. */
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
    this.changeEmitter.fire(connection);
  }

  /** What the last check of this machine found; undefined before the first check. */
  get local(): LocalStatus | undefined {
    return this.localStatus;
  }

  /** Records a check of this machine; its problems show on Local's root. */
  setLocalStatus(status: LocalStatus): void {
    this.localStatus = status;
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
    const entries = await backend.listTopologies();
    this.topologies.set(connection.id, { at: Date.now(), entries });
    return entries;
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

  /** Adds a lab host to the user settings, or updates the one with the same URL. */
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

  async removeConnection(connection: LabConnection): Promise<void> {
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
