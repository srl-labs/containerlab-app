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

/** The backend that runs the labs the extension shows. */
export function getLabBackend(): LabBackend {
  return getLocalBackend();
}

/**
 * The lab a command acts on. Local labs are addressed by their topology
 * file, so containerlab finds the lab name in it.
 */
export function labTargetForPath(labPath: string, labName = ""): LabTarget {
  return { labName, path: labPath };
}

/**
 * The lab name a topology file declares, the name containerlab runs it under;
 * the file name without `.clab.yml` when the file has none.
 */
export function labNameForPath(labPath: string): string {
  try {
    const parsed = YAML.parse(fs.readFileSync(labPath, "utf8")) as { name?: unknown } | null;
    if (typeof parsed?.name === "string" && parsed.name.trim().length > 0) {
      return parsed.name.trim();
    }
  } catch {
    // Unreadable or not YAML; fall back to the file name.
  }
  return path.basename(labPath).replace(/\.clab\.ya?ml$/i, "");
}

export async function disposeLabBackends(): Promise<void> {
  await localBackend?.dispose();
  localBackend = undefined;
  localBackendKey = "";
}
