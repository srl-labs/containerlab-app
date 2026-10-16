import * as vscode from "vscode";

import { getConnections, remoteUri } from "../backend/labBackends";
import type { ConnectionManager, LabConnection } from "../backend/connections";

interface ConnectionItem extends vscode.QuickPickItem {
  connection?: LabConnection;
  add?: boolean;
}

function manager(): ConnectionManager | undefined {
  const connections = getConnections();
  if (!connections) {
    void vscode.window.showErrorMessage("Containerlab is not ready yet.");
  }
  return connections;
}

function describe(connections: ConnectionManager, connection: LabConnection): string {
  if (connection.kind === "local") return "containerlab on this machine";
  const signedIn = connections.apiBackend(connection) !== undefined;
  return `${connection.url ?? ""}${signedIn ? "" : " · signed out"}`;
}

/** Makes a connection active, signing in first when it needs a password. */
async function activate(connections: ConnectionManager, connection: LabConnection): Promise<void> {
  if (connection.kind === "api" && !(await connections.ensureBackend(connection))) {
    return;
  }
  await connections.setActive(connection.id);
}

/** Asks for a clab-api-server and adds it to the settings. */
export async function addConnection(): Promise<LabConnection | undefined> {
  const connections = manager();
  if (!connections) return undefined;
  const url = await vscode.window.showInputBox({
    title: "Add Lab Server (1/2)",
    prompt: "URL of the clab-api-server, e.g. https://lab-host:8080",
    placeHolder: "https://lab-host:8080",
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim().length === 0 || /^(https?:\/\/)?[^\s/]+/.test(value.trim())
        ? undefined
        : "Enter a host name or URL."
  });
  if (url === undefined || url === "") return undefined;
  let host = url.trim();
  try {
    host = new URL(/^[a-z]+:\/\//i.test(host) ? host : `https://${host}`).hostname;
  } catch {
    // Keep what the user typed as the label.
  }
  const label = await vscode.window.showInputBox({
    title: "Add Lab Server (2/2)",
    prompt: "Name shown for this lab server",
    value: host,
    ignoreFocusOut: true
  });
  if (label === undefined) return undefined;
  try {
    const connection = await connections.addConnection(label.trim() || host, url);
    await activate(connections, connection);
    return connection;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Adding the lab server failed: ${message}`);
    return undefined;
  }
}

/** Picks the connection whose labs the views show. */
export async function switchConnection(): Promise<void> {
  const connections = manager();
  if (!connections) return;
  const active = connections.active;
  const items: ConnectionItem[] = connections.list().map((connection) => ({
    label: `$(${connection.kind === "local" ? "vm" : "cloud"}) ${connection.label}`,
    description: describe(connections, connection),
    detail: connection.id === active.id ? "Active" : undefined,
    connection
  }));
  items.push({ label: "$(add) Add Lab Server…", add: true });
  const picked = await vscode.window.showQuickPick(items, {
    title: "Containerlab: Lab Server",
    placeHolder: "Where should the Containerlab views show labs from?"
  });
  if (!picked) return;
  if (picked.add === true) {
    await addConnection();
    return;
  }
  if (picked.connection) await activate(connections, picked.connection);
}

async function pickApiConnection(
  connections: ConnectionManager,
  title: string
): Promise<LabConnection | undefined> {
  const active = connections.active;
  if (active.kind === "api") return active;
  const servers = connections.list().filter((connection) => connection.kind === "api");
  if (servers.length === 0) {
    void vscode.window.showInformationMessage("No lab server is configured. Add one first.");
    return undefined;
  }
  if (servers.length === 1) return servers[0];
  const picked = await vscode.window.showQuickPick(
    servers.map((connection) => ({
      label: connection.label,
      description: describe(connections, connection),
      connection
    })),
    { title }
  );
  return picked?.connection;
}

export async function signIn(): Promise<void> {
  const connections = manager();
  if (!connections) return;
  const connection = await pickApiConnection(connections, "Sign in to lab server");
  if (!connection) return;
  if (await connections.promptSignIn(connection)) {
    await connections.setActive(connection.id);
  }
}

export async function signOut(): Promise<void> {
  const connections = manager();
  if (!connections) return;
  const connection = await pickApiConnection(connections, "Sign out of lab server");
  if (!connection) return;
  await connections.signOut(connection);
  void vscode.window.showInformationMessage(`Signed out of ${connection.label}.`);
  if (connections.active.id === connection.id) {
    await connections.setActive(connection.id);
  }
}

export async function removeConnection(): Promise<void> {
  const connections = manager();
  if (!connections) return;
  const servers = connections.list().filter((connection) => connection.kind === "api");
  const picked = await vscode.window.showQuickPick(
    servers.map((connection) => ({
      label: connection.label,
      description: connection.url,
      connection
    })),
    { title: "Remove lab server" }
  );
  if (!picked) return;
  const confirm = await vscode.window.showWarningMessage(
    `Remove ${picked.connection.label}? Its labs keep running on the server.`,
    { modal: true },
    "Remove"
  );
  if (confirm === "Remove") await connections.removeConnection(picked.connection);
}

/** Adds the lab server's workspace to the Explorer, to browse and edit its files. */
export async function openRemoteWorkspace(): Promise<void> {
  const connections = manager();
  if (!connections) return;
  const connection = await pickApiConnection(connections, "Open lab server workspace");
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
    name: `${connection.label} (lab server)`
  });
}
