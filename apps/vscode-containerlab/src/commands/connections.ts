import * as os from "os";
import * as path from "path";

import * as vscode from "vscode";

import { listKubeContexts, type KubeContextInfo } from "@srl-labs/containerlab-lab-backend/local";

import { connectionOf, getConnections, remoteUri } from "../backend/labBackends";
import type { ConnectionManager, LabConnection } from "../backend/connections";

function manager(): ConnectionManager | undefined {
  const connections = getConnections();
  if (!connections) {
    void vscode.window.showErrorMessage("Containerlab is not ready yet.");
  }
  return connections;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The host name of a URL the user typed, for a default name. */
function hostOf(url: string): string {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}

/** Shows the Containerlab explorer, where the new lab host's labs appear. */
function revealExplorer(): void {
  void vscode.commands
    .executeCommand("containerlabExplorerWebview.focus")
    .then(undefined, () => {});
}

/**
 * Asks for a lab host and signs in to it: URL, name, user and password,
 * one step at a time. The host is saved even when the sign-in fails, so
 * the user can sign in again later. Where containerlab runs, a Kubernetes
 * cluster can be added instead.
 */
export async function addConnection(): Promise<LabConnection | undefined> {
  const connections = manager();
  if (!connections) return undefined;
  // containerlab on this machine runs a cluster's labs; it only runs on Linux.
  if (!connections.localAvailable) return addApiConnection(connections);
  const kind = await vscode.window.showQuickPick(
    [
      {
        label: "$(cloud) clab-api-server",
        description: "Sign in to a lab host",
        value: "api" as const
      },
      {
        label: "$(server-environment) Kubernetes cluster (c9s)",
        description: "Run labs with clabernetes, from this machine",
        value: "c9s" as const
      }
    ],
    { title: "Add Lab Host", placeHolder: "Where do the labs run?" }
  );
  if (kind === undefined) return undefined;
  if (kind.value === "c9s") return addClusterConnection(connections);
  return addApiConnection(connections);
}

type ContextPick = vscode.QuickPickItem & { context?: KubeContextInfo; chooseFile?: true };

function contextItems(contexts: KubeContextInfo[]): ContextPick[] {
  return contexts.map((context) => ({
    label: context.name,
    description: context.current ? "current context" : context.cluster,
    ...(context.namespace ? { detail: `Namespace ${context.namespace}` } : {}),
    context
  }));
}

/**
 * The cluster's kubeconfig context: one of the default kubeconfig
 * (`KUBECONFIG`, else `~/.kube/config`), or one of a file the user picks,
 * which the lab host then keeps. Undefined when the user cancels.
 */
async function pickKubeContext(
  title: string
): Promise<{ context: KubeContextInfo; kubeconfig?: string } | undefined> {
  const defaults = listKubeContexts();
  const picked = await vscode.window.showQuickPick<ContextPick>(
    [
      ...contextItems(defaults),
      ...(defaults.length > 0
        ? [{ label: "", kind: vscode.QuickPickItemKind.Separator } as ContextPick]
        : []),
      {
        label: "$(folder-opened) Choose kubeconfig file…",
        description:
          defaults.length > 0
            ? "A context from another file"
            : "No context in KUBECONFIG or ~/.kube/config",
        chooseFile: true
      }
    ],
    { title, placeHolder: "kubeconfig context of the cluster", ignoreFocusOut: true }
  );
  if (picked === undefined) return undefined;
  if (picked.context) return { context: picked.context };
  const files = await vscode.window.showOpenDialog({
    title: "kubeconfig file of the cluster",
    openLabel: "Use kubeconfig",
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(path.join(os.homedir(), ".kube"))
  });
  const kubeconfig = files?.[0]?.fsPath;
  if (kubeconfig === undefined) return undefined;
  const contexts = listKubeContexts({ kubeconfig });
  if (contexts.length === 0) {
    void vscode.window.showErrorMessage(
      `${kubeconfig} has no kubeconfig context, or it does not load.`
    );
    return undefined;
  }
  const inFile =
    contexts.length === 1
      ? contextItems(contexts)[0]
      : await vscode.window.showQuickPick(contextItems(contexts), {
          title,
          placeHolder: `Context in ${path.basename(kubeconfig)}`,
          ignoreFocusOut: true
        });
  return inFile?.context ? { context: inFile.context, kubeconfig } : undefined;
}

/**
 * Asks for a kubeconfig context and, optionally, the one namespace the user
 * may use, and adds the cluster as a lab host. containerlab on this machine
 * runs its labs with `-r c9s`.
 */
async function addClusterConnection(
  connections: ConnectionManager
): Promise<LabConnection | undefined> {
  const title = "Add Kubernetes Cluster";
  const picked = await pickKubeContext(`${title} (1/2)`);
  if (picked === undefined) return undefined;
  const namespace = await vscode.window.showInputBox({
    title: `${title} (2/2)`,
    prompt:
      "Namespace for every lab, if you may only use one. Leave empty for a namespace per lab (c9s-<lab>).",
    value: "",
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim() === "" || /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(value.trim())
        ? undefined
        : "Enter a Kubernetes namespace name."
  });
  if (namespace === undefined) return undefined;
  try {
    const connection = await connections.addClusterConnection({
      kubeContext: picked.context.name,
      ...(picked.kubeconfig !== undefined ? { kubeconfig: picked.kubeconfig } : {}),
      namespace: namespace.trim()
    });
    revealExplorer();
    return connection;
  } catch (error) {
    void vscode.window.showErrorMessage(`Adding the cluster failed: ${messageOf(error)}`);
    return undefined;
  }
}

async function addApiConnection(
  connections: ConnectionManager
): Promise<LabConnection | undefined> {
  const title = "Add Lab Host";
  const url = await vscode.window.showInputBox({
    title: `${title} (1/4)`,
    prompt: "URL of clab-api-server on the lab host",
    placeHolder: "https://lab-host:8090",
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim().length === 0 || /^(https?:\/\/)?[^\s/]+/.test(value.trim())
        ? undefined
        : "Enter a host name or URL."
  });
  if (url === undefined || url.trim() === "") return undefined;
  const label = await vscode.window.showInputBox({
    title: `${title} (2/4)`,
    prompt: "Name shown in the Containerlab views",
    value: hostOf(url.trim()),
    ignoreFocusOut: true
  });
  if (label === undefined) return undefined;
  const username = await vscode.window.showInputBox({
    title: `${title} (3/4)`,
    prompt: "Your Linux user on the lab host",
    ignoreFocusOut: true
  });
  if (username === undefined || username.trim() === "") return undefined;
  const password = await vscode.window.showInputBox({
    title: `${title} (4/4)`,
    prompt: `Password of ${username.trim()}`,
    password: true,
    ignoreFocusOut: true
  });
  if (password === undefined) return undefined;
  let connection: LabConnection;
  try {
    connection = await connections.addConnection(label.trim() || hostOf(url.trim()), url, {
      username: username.trim()
    });
  } catch (error) {
    void vscode.window.showErrorMessage(`Adding the lab host failed: ${messageOf(error)}`);
    return undefined;
  }
  try {
    await connections.signIn(connection, username.trim(), password);
    revealExplorer();
  } catch (error) {
    const choice = await vscode.window.showErrorMessage(
      `${connection.label} was added, but signing in failed: ${messageOf(error)}`,
      "Sign In Again"
    );
    if (choice === "Sign In Again") await connections.promptSignIn(connection);
  }
  return connection;
}

/** The lab host a command is for: the explorer node it was run on, or the one the user picks. */
async function pickLabHost(
  connections: ConnectionManager,
  title: string,
  target: unknown
): Promise<LabConnection | undefined> {
  if (target !== undefined) {
    const connection = connectionOf(target);
    return connection.kind === "api" ? connections.get(connection.id) : undefined;
  }
  const hosts = connections.list().filter((connection) => connection.kind === "api");
  if (hosts.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      "No lab host is configured yet.",
      "Add Lab Host"
    );
    if (choice === "Add Lab Host") await addConnection();
    return undefined;
  }
  if (hosts.length === 1) return hosts[0];
  const picked = await vscode.window.showQuickPick(
    hosts.map((connection) => ({
      label: connection.label,
      description: connection.url,
      detail: connections.status(connection) === "connected" ? "Signed in" : "Signed out",
      connection
    })),
    { title }
  );
  return picked?.connection;
}

export async function signIn(target?: unknown): Promise<void> {
  const connections = manager();
  if (!connections) return;
  const connection = await pickLabHost(connections, "Sign in to lab host", target);
  if (!connection) return;
  if (await connections.promptSignIn(connection)) revealExplorer();
}

export async function signOut(target?: unknown): Promise<void> {
  const connections = manager();
  if (!connections) return;
  const connection = await pickLabHost(connections, "Sign out of lab host", target);
  if (!connection) return;
  await connections.signOut(connection);
  void vscode.window.showInformationMessage(`Signed out of ${connection.label}.`);
}

/** Removes a lab host, or hides Local, after asking. */
export async function removeConnection(target?: unknown): Promise<void> {
  const connections = manager();
  if (!connections) return;
  if (target !== undefined && connectionOf(target).kind === "local") {
    const confirm = await vscode.window.showWarningMessage(
      "Hide the labs on this machine? Running labs keep running.",
      {
        modal: true,
        detail:
          'Turn "Labs on this machine" back on in the Containerlab settings to see them again.'
      },
      "Hide"
    );
    if (confirm === "Hide") await connections.setLocalEnabled(false);
    return;
  }
  const connection = await pickLabHost(connections, "Remove lab host", target);
  if (!connection) return;
  const confirm = await vscode.window.showWarningMessage(
    `Remove ${connection.label}?`,
    { modal: true, detail: "Its labs keep running on the host. You can add it again any time." },
    "Remove"
  );
  if (confirm === "Remove") await connections.removeConnection(connection);
}

/**
 * The explorer's primary action on a lab host that is signed out: sign in.
 * On Local it checks containerlab again.
 */
export async function reconnect(target?: unknown): Promise<void> {
  if (target !== undefined && connectionOf(target).kind === "local") {
    await vscode.commands.executeCommand("containerlab.connection.checkLocal");
    return;
  }
  const connections = manager();
  const connection = target !== undefined ? connectionOf(target) : undefined;
  if (connections && connection && connections.apiBackend(connection) !== undefined) {
    // Still signed in: the host only has to answer again.
    if (connections.status(connection) !== "offline" || (await connections.retry(connection))) {
      return;
    }
    void vscode.window.showWarningMessage(
      `${connection.label} is still not reachable. It is checked again automatically.`
    );
    return;
  }
  await signIn(target);
}

export async function copyConnectionUrl(target?: unknown): Promise<void> {
  const connection = target !== undefined ? connectionOf(target) : undefined;
  const url = connection?.kind === "api" ? getConnections()?.get(connection.id)?.url : undefined;
  if (url === undefined) return;
  await vscode.env.clipboard.writeText(url);
  void vscode.window.showInformationMessage(`Copied ${url}`);
}

/** Adds the lab host's workspace to the Explorer, to browse and edit its files. */
export async function openRemoteWorkspace(target?: unknown): Promise<void> {
  const connections = manager();
  if (!connections) return;
  const connection = await pickLabHost(connections, "Open lab host files", target);
  if (!connection) return;
  if (!(await connections.ensureBackend(connection))) return;
  const uri = remoteUri(connection, "");
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.some((folder) => folder.uri.toString() === uri.toString())) {
    await vscode.commands.executeCommand("workbench.view.explorer");
    return;
  }
  vscode.workspace.updateWorkspaceFolders(folders.length, null, {
    uri,
    name: `${connection.label} (lab host)`
  });
}

/** Opens the Lab Hosts page of the Containerlab settings. */
export async function manageConnections(): Promise<void> {
  await vscode.commands.executeCommand("containerlab.settings.open", "labHosts");
}
