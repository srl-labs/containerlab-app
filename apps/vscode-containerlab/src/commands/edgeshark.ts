import * as vscode from "vscode";

import { backendFor, connectionOf, pickConnection } from "../backend/labBackends";
import { ensureHostSupports } from "../backend/labHostSupport";
import type { LabConnection } from "../backend/connections";

import { execCommandInTerminal } from "./command";

// Packetflix reaches gostwire as "gostwire.ghost-in-da-edge" upstream, which
// Podman's DNS cannot resolve. The bare service name works on Docker and Podman.
const DISCOVERY_SERVICE_SED = `s/--discovery-service=gostwire[.][^"]*/--discovery-service=gostwire/`;

function getEdgesharkInstallCmd(): string {
  const config = vscode.workspace.getConfiguration("containerlab");
  const extraEnvVars = config.get<string>("edgeshark.extraEnvironmentVars", "");

  if (extraEnvVars) {
    // Parse the environment variables from the setting
    const envLines = extraEnvVars
      .split(",")
      .map((env) => env.trim())
      .filter((env) => env);
    if (envLines.length > 0) {
      // Create a temporary file approach with proper YAML injection
      const envSection = envLines.map((env) => `          - ${env}`).join("\\n");

      // Download, modify, and run the compose file using a secure temp file
      return `tmpFile="$(mktemp -t edgeshark-compose.XXXXXX)" && \
curl -sL https://github.com/siemens/edgeshark/raw/main/deployments/wget/docker-compose.yaml -o "$tmpFile" && \
sed -i '${DISCOVERY_SERVICE_SED}' "$tmpFile" && \
sed -i '/gostwire:/,/^    [^ ]/ { /pull_policy:.*always/a\\        environment:\\n${envSection}
}' "$tmpFile" && \
sed -i '/edgeshark:/,/^    [^ ]/ { /pull_policy:.*always/a\\        environment:\\n${envSection}
}' "$tmpFile" && \
DOCKER_DEFAULT_PLATFORM= docker compose -f "$tmpFile" up -d && \
rm -f "$tmpFile"`;
    }
  }

  return `curl -sL \
https://github.com/siemens/edgeshark/raw/main/deployments/wget/docker-compose.yaml \
| sed '${DISCOVERY_SERVICE_SED}' \
| DOCKER_DEFAULT_PLATFORM= docker compose -f - up -d`;
}

function getEdgesharkUninstallCmd(): string {
  return `curl -sL \
https://github.com/siemens/edgeshark/raw/main/deployments/wget/docker-compose.yaml \
| DOCKER_DEFAULT_PLATFORM= docker compose -f - down`;
}

/** Installs or removes Edgeshark on a lab host. */
async function manageRemoteEdgeshark(
  connection: LabConnection,
  action: "install" | "uninstall"
): Promise<void> {
  const title =
    action === "install"
      ? `Installing Edgeshark on ${connection.label}`
      : `Removing Edgeshark from ${connection.label}`;
  try {
    const backend = backendFor(connection);
    if (!(await ensureHostSupports(connection, "edgesharkManagement", "Edgeshark"))) return;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title },
      () => (action === "install" ? backend.edgesharkInstall() : backend.edgesharkUninstall())
    );
    void vscode.window.showInformationMessage(
      action === "install"
        ? `Edgeshark is running on ${connection.label}.`
        : "Edgeshark was removed."
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`${title} failed: ${message}`);
  }
}

/** Where Edgeshark goes: the connection of a tree node, or the one the user picks. */
async function edgesharkTarget(target: unknown, title: string): Promise<LabConnection | undefined> {
  return target !== undefined ? connectionOf(target) : pickConnection(title);
}

export async function installEdgeshark(target?: unknown) {
  const connection = await edgesharkTarget(target, "Install Edgeshark on");
  if (!connection) return;
  if (connection.kind === "api") {
    return manageRemoteEdgeshark(connection, "install");
  }
  execCommandInTerminal(getEdgesharkInstallCmd(), "Edgeshark Installation");
}

export async function uninstallEdgeshark(target?: unknown) {
  const connection = await edgesharkTarget(target, "Uninstall Edgeshark from");
  if (!connection) return;
  if (connection.kind === "api") {
    return manageRemoteEdgeshark(connection, "uninstall");
  }
  execCommandInTerminal(getEdgesharkUninstallCmd(), "Edgeshark Uninstallation");
}
