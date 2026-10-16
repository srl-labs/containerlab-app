import { createHash } from "crypto";

import * as vscode from "vscode";
import type { LabBackend, TopologyEntry } from "@srl-labs/containerlab-lab-backend";
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
}

interface ConnectionSetting {
  label?: unknown;
  url?: unknown;
  username?: unknown;
}

const LOCAL_CONNECTION_ID = "local";
/** URI scheme of files in a clab-api-server workspace. */
export const REMOTE_SCHEME = "clab-api";

const ACTIVE_CONNECTION_KEY = "containerlab.activeConnection";
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
 * The connections the extension can run labs through: "Local" (this machine)
 * and the clab-api-servers in the `containerlab.connections` setting. One
 * connection is active at a time; the views show its labs.
 */
export class ConnectionManager implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<LabConnection>();
  readonly onDidChangeActive = this.changeEmitter.event;
  private readonly signInEmitter = new vscode.EventEmitter<LabConnection>();
  /** Fires after a sign-in, when the connection's backend has a new token. */
  readonly onDidSignIn = this.signInEmitter.event;
  private readonly backends = new Map<string, ApiLabBackend>();
  private readonly topologies = new Map<string, { at: number; entries: TopologyEntry[] }>();
  private readonly statusBar: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  private readonly localSupported: boolean;

  constructor(
    private readonly context: vscode.ExtensionContext,
    options: { localSupported?: boolean } = {}
  ) {
    this.localSupported = options.localSupported ?? true;
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.disposables.push(
      this.statusBar,
      this.changeEmitter,
      this.signInEmitter,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("containerlab.connections") ||
          event.affectsConfiguration("containerlab.localConnection")
        ) {
          this.updateStatusBar();
          if (!this.list().some((connection) => connection.id === this.activeId())) {
            void this.setActive(this.list()[0]?.id ?? LOCAL_CONNECTION_ID);
          }
        }
      })
    );
    this.updateStatusBar();
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

  /** Local first (unless turned off), then the configured servers. */
  list(): LabConnection[] {
    const connections: LabConnection[] = [];
    if (this.localEnabled()) {
      connections.push({ id: LOCAL_CONNECTION_ID, label: "Local", kind: "local" });
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
      connections.push({ id, label, kind: "api", url, ...(username ? { username } : {}) });
    }
    return connections;
  }

  get(id: string): LabConnection | undefined {
    return this.list().find((connection) => connection.id === id);
  }

  private activeId(): string {
    return this.context.globalState.get<string>(ACTIVE_CONNECTION_KEY, LOCAL_CONNECTION_ID);
  }

  get active(): LabConnection {
    const connections = this.list();
    return (
      connections.find((connection) => connection.id === this.activeId()) ??
      connections.at(0) ?? { id: LOCAL_CONNECTION_ID, label: "Local", kind: "local" }
    );
  }

  async setActive(id: string): Promise<void> {
    await this.context.globalState.update(ACTIVE_CONNECTION_KEY, id);
    this.updateStatusBar();
    this.changeEmitter.fire(this.active);
  }

  private updateStatusBar(): void {
    const active = this.active;
    const multiple = this.list().length > 1;
    const signedOut = active.kind === "api" && !this.backends.has(active.id);
    this.statusBar.text = signedOut
      ? `$(cloud) ${active.label}: Sign In`
      : `$(${active.kind === "local" ? "vm" : "cloud"}) ${active.label}`;
    this.statusBar.command = signedOut
      ? "containerlab.connection.signIn"
      : "containerlab.connection.switch";
    if (active.kind === "local") {
      this.statusBar.tooltip = "Containerlab: labs on this machine. Click to switch.";
    } else if (signedOut) {
      this.statusBar.tooltip = `Containerlab: sign in to ${active.url ?? active.label} to see its labs.`;
    } else {
      this.statusBar.tooltip = `Containerlab: labs on ${active.url ?? active.label}. Click to switch.`;
    }
    if (multiple || active.kind === "api") this.statusBar.show();
    else this.statusBar.hide();
  }

  /** Loads the stored tokens of all lab servers, e.g. after VS Code starts. */
  async restoreAll(): Promise<void> {
    await Promise.all(
      this.list()
        .filter((connection) => connection.kind === "api")
        .map((connection) => this.restore(connection))
    );
    this.updateStatusBar();
  }

  /**
   * The server rejected the token, e.g. because the session expired: forget
   * it and offer to sign in again.
   */
  async expire(connection: LabConnection): Promise<void> {
    if (!this.backends.has(connection.id)) return;
    await this.signOut(connection);
    const choice = await vscode.window.showWarningMessage(
      `Your session on ${connection.label} has ended.`,
      "Sign In"
    );
    if (choice === "Sign In" && (await this.promptSignIn(connection))) {
      await this.setActive(connection.id);
    }
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
    password: string
  ): Promise<ApiLabBackend> {
    if (connection.kind !== "api" || connection.url === undefined) {
      throw new Error("Only clab-api-server connections need a sign-in.");
    }
    const backend = await ApiLabBackend.login({ baseUrl: connection.url, username, password });
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
    this.updateStatusBar();
    this.signInEmitter.fire(connection);
    return backend;
  }

  async signOut(connection: LabConnection): Promise<void> {
    if (connection.url === undefined) return;
    this.backends.delete(connection.id);
    this.topologies.delete(connection.id);
    this.updateStatusBar();
    await Promise.resolve(this.context.secrets.delete(tokenKey(connection.url))).catch(() => {});
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

  /** Adds a server to the user settings and makes it active. */
  async addConnection(label: string, url: string): Promise<LabConnection> {
    const normalized = normalizeUrl(url);
    if (normalized === undefined) throw new Error(`"${url}" is not an http(s) URL.`);
    const config = vscode.workspace.getConfiguration("containerlab");
    const current = config.get<ConnectionSetting[]>("connections", []);
    const next = (Array.isArray(current) ? current : []).filter(
      (entry) => typeof entry.url !== "string" || normalizeUrl(entry.url) !== normalized
    );
    next.push({ label, url: normalized });
    await config.update("connections", next, vscode.ConfigurationTarget.Global);
    const connection = this.get(apiConnectionId(normalized));
    if (!connection) throw new Error("The connection could not be saved.");
    return connection;
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
    if (this.activeId() === connection.id) {
      await this.setActive(this.list()[0]?.id ?? LOCAL_CONNECTION_ID);
    }
  }

  /** The backend of the active connection; undefined while an API connection is signed out. */
  activeBackend(): LabBackend | undefined {
    const active = this.active;
    return active.kind === "api" ? this.backends.get(active.id) : undefined;
  }
}
