import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveLocalOptions, type LocalLabBackendOptions } from "./options.ts";
import { containerlabCommand, runCommand, stripAnsi } from "./process.ts";

/** Whether containerlab can run labs on this machine for the current user. */
export interface LocalEnvironmentStatus {
  available: boolean;
  /** What is missing, each with a hint how to fix it. */
  problems: string[];
  platform: NodeJS.Platform;
  runtime: string;
  username: string;
  containerlabPath?: string;
  containerlabVersion?: string;
  isRoot: boolean;
  inClabAdmins: boolean;
  inRuntimeGroup: boolean;
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await fs.access(file, fsConstants.X_OK);
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

/** The absolute path of a binary, looked up on PATH unless it is a path already. */
export async function findBinary(binary: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (binary.includes("/")) return (await isExecutable(binary)) ? binary : undefined;
  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, binary);
    if (await isExecutable(candidate)) return candidate;
  }
  return undefined;
}

async function userGroups(): Promise<string[]> {
  try {
    const result = await runCommand("id", ["-nG"]);
    return result.stdout.trim().split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

/** Who runs containerlab here, and whether the groups let them run it without sudo. */
export interface LocalUserAccess {
  username: string;
  uid: number;
  isRoot: boolean;
  groups: string[];
  inClabAdmins: boolean;
  /** In the docker group; Podman needs no group. */
  inRuntimeGroup: boolean;
  /** Root, or in clab_admins and the runtime's group. */
  canRunLabs: boolean;
}

/** The group check of detectLocalEnvironment, without running containerlab or the runtime. */
export async function detectLocalUser(options: LocalLabBackendOptions = {}): Promise<LocalUserAccess> {
  const resolved = resolveLocalOptions(options);
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  const isRoot = uid === 0;
  const groups = await userGroups();
  const inClabAdmins = groups.includes("clab_admins");
  const inRuntimeGroup = resolved.runtime === "podman" || groups.includes("docker");
  return {
    username: resolved.username,
    uid,
    isRoot,
    groups,
    inClabAdmins,
    inRuntimeGroup,
    canRunLabs: isRoot || (inClabAdmins && inRuntimeGroup)
  };
}

/**
 * Checks what a local lab backend needs: Linux, the containerlab binary, the
 * container runtime and the group memberships that let the user run both
 * without sudo. Never prompts for anything.
 */
export async function detectLocalEnvironment(
  options: LocalLabBackendOptions = {}
): Promise<LocalEnvironmentStatus> {
  const resolved = resolveLocalOptions(options);
  const problems: string[] = [];
  const { isRoot, inClabAdmins, inRuntimeGroup } = await detectLocalUser(options);
  const status: LocalEnvironmentStatus = {
    available: false,
    problems,
    platform: process.platform,
    runtime: resolved.runtime,
    username: resolved.username,
    isRoot,
    inClabAdmins,
    inRuntimeGroup
  };

  if (process.platform !== "linux") {
    problems.push("Labs on this computer need Linux. Connect to a clab-api-server instead.");
    return status;
  }

  status.containerlabPath = await findBinary(resolved.binaryPath, resolved.env);
  if (!status.containerlabPath) {
    problems.push(
      "containerlab is not installed. Install it with: curl -sL https://containerlab.dev/setup | sudo -E bash -s \"all\""
    );
  } else {
    const [file, args] = containerlabCommand({ ...resolved, binaryPath: status.containerlabPath }, ["version"]);
    const result = await runCommand(file, args, { env: resolved.env, timeoutMs: 15_000 }).catch(() => undefined);
    const version = /version:\s*(\S+)/.exec(stripAnsi(result?.stdout ?? ""))?.[1];
    if (version) {
      status.containerlabVersion = version;
    } else {
      problems.push(`containerlab at ${status.containerlabPath} does not run: ${result?.stderr.trim() || "no output"}`);
    }
  }

  if (!isRoot && !resolved.sudo) {
    if (!inClabAdmins) {
      problems.push(
        `${resolved.username} is not in the clab_admins group. Run: sudo usermod -aG clab_admins ${resolved.username}, then log in again.`
      );
    }
    if (!inRuntimeGroup) {
      problems.push(
        `${resolved.username} is not in the docker group. Run: sudo usermod -aG docker ${resolved.username}, then log in again.`
      );
    }
  }

  const runtime = await runCommand(resolved.runtime, ["version", "--format", "{{.Server.Version}}"], {
    env: resolved.env,
    timeoutMs: 15_000
  }).catch(() => undefined);
  if (!runtime || runtime.code !== 0) {
    problems.push(
      runtime
        ? `${resolved.runtime} is not reachable: ${runtime.stderr.trim().split("\n")[0]}`
        : `${resolved.runtime} is not installed.`
    );
  }

  status.available = problems.length === 0;
  return status;
}

/** The workspace root a local backend uses by default. */
export function defaultLocalWorkspaceRoot(): string {
  return path.join(os.homedir(), ".clab");
}
