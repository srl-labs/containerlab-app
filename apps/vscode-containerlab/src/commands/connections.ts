import * as vscode from "vscode";

import { connectionOf, getConnections, remoteUri } from "../backend/labBackends";
import {
  LOCAL_CONNECTION,
  type ConnectionManager,
  type LabConnection
} from "../backend/connections";

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

type AddChoice = vscode.QuickPickItem & {
  value: "this-computer" | "cluster" | "server";
  unavailable?: string;
};

/** Why this window cannot run labs here, for the choices that need containerlab on this machine. */
const NEEDS_LINUX =
  "containerlab runs on Linux only. Use a lab server, or open this window in WSL.";

/**
 * "Add Lab Host": where labs should run. This computer shows Local again; a
 * Kubernetes cluster opens the cluster form on the Lab Hosts page; a lab
 * server asks for its URL and signs in. Choices that cannot work in this
 * window stay in the list and say why.
 */
export async function addConnection(): Promise<LabConnection | undefined> {
  const connections = manager();
  if (!connections) return undefined;
  const localShown = connections.list().some((connection) => connection.id === LOCAL_CONNECTION.id);
  let thisComputer: Pick<AddChoice, "detail" | "unavailable"> = {};
  if (!connections.localAvailable) thisComputer = { detail: NEEDS_LINUX, unavailable: NEEDS_LINUX };
  else if (localShown) {
    thisComputer = {
      detail: "Already in the list.",
      unavailable: "This computer is in the list already."
    };
  }
  const items: AddChoice[] = [
    {
      label: "$(device-desktop) This computer",
      description: "Docker or Podman, set in containerlab.runtime",
      value: "this-computer",
      ...thisComputer
    },
    {
      label: "$(server-environment) Kubernetes cluster",
      description: "With your kubeconfig; containerlab runs here",
      value: "cluster",
      ...(connections.localAvailable ? {} : { detail: NEEDS_LINUX, unavailable: NEEDS_LINUX })
    },
    {
      label: "$(cloud) Lab server",
      description: "clab-api-server; it may run Docker or Kubernetes",
      value: "server"
    }
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: "Add Lab Host",
    placeHolder: "Where should labs run?"
  });
  if (picked === undefined) return undefined;
  if (picked.unavailable !== undefined) {
    void vscode.window.showWarningMessage(picked.unavailable);
    return undefined;
  }
  if (picked.value === "this-computer") {
    await connections.setLocalEnabled(true);
    revealExplorer();
    return LOCAL_CONNECTION;
  }
  if (picked.value === "cluster") {
    // The cluster form: kubeconfig, context, namespaces, defaults and "Check connection".
    await vscode.commands.executeCommand("containerlab.settings.open", "labHosts", "cluster");
    return undefined;
  }
  return addApiConnection(connections);
}

async function addApiConnection(
  connections: ConnectionManager
): Promise<LabConnection | undefined> {
  const title = "Add Lab Server";
  const url = await vscode.window.showInputBox({
    title: `${title} (1/4)`,
    prompt: "URL of clab-api-server on the lab server",
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
    prompt: "Your Linux user on the lab server",
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
