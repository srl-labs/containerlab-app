import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { KubeClusterProbe } from "./kube/clusterProbe.ts";
import { detectC9sEnvironment } from "./kube/detect.ts";
import { resolveLocalOptions, type LocalLabBackendOptions, type ResolvedLocalOptions } from "./options.ts";
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
  /** c9s: the kubeconfig context in use. */
  kubeContext?: string;
  /** c9s: the Kubernetes API server version. */
  kubernetesVersion?: string;
  /** c9s: the clabernetes manager version, when the user may read it. */
  clabernetesVersion?: string;
}

/** Replacements for what detection talks to, for tests. */
export interface DetectionOverrides {
  /** The cluster of a c9s host. */
  kubeProbe?: (options: Pick<ResolvedLocalOptions, "c9s" | "env">) => KubeClusterProbe;
  /** The platform the app runs on; `process.platform` when unset. */
  platform?: NodeJS.Platform;
}

/**
 * containerlab is built for Linux only, so every local lab host needs Linux,
 * also one whose labs run on a Kubernetes cluster: containerlab on this
 * machine deploys them and reaches their nodes.
 */
export const CONTAINERLAB_LINUX_ONLY =
  "containerlab runs on Linux only. Use a clab-api-server lab host, or run the app in WSL or a Linux VM.";

/** Why containerlab cannot run on a platform, or undefined on Linux. */
export function containerlabPlatformProblem(platform: NodeJS.Platform = process.platform): string | undefined {
  return platform === "linux" ? undefined : CONTAINERLAB_LINUX_ONLY;
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
  options: LocalLabBackendOptions = {},
  overrides: DetectionOverrides = {}
): Promise<LocalEnvironmentStatus> {
  let resolved: ResolvedLocalOptions;
  try {
    resolved = resolveLocalOptions(options);
  } catch (error) {
    return {
      available: false,
      problems: [error instanceof Error ? error.message : String(error)],
      platform: overrides.platform ?? process.platform,
      runtime: options.runtime?.trim() ?? "",
      username: options.username?.trim() ?? "",
      isRoot: false,
      inClabAdmins: false,
      inRuntimeGroup: false
    };
  }
  const problems: string[] = [];
  const { isRoot, inClabAdmins, inRuntimeGroup } = await detectLocalUser(options);
  const status: LocalEnvironmentStatus = {
    available: false,
    problems,
    platform: overrides.platform ?? process.platform,
    runtime: resolved.runtime,
    username: resolved.username,
    isRoot,
    inClabAdmins,
    inRuntimeGroup
  };

  const platformProblem = containerlabPlatformProblem(status.platform);
  if (platformProblem) {
    problems.push(platformProblem);
    return status;
  }

  const c9s = resolved.runtime === "c9s";

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

  if (c9s) {
    // The cluster runs the labs: no Docker and no clab_admins group needed.
    const cluster = await detectC9sEnvironment(resolved, status.containerlabVersion, overrides.kubeProbe);
    problems.push(...cluster.problems);
    if (cluster.kubeContext) status.kubeContext = cluster.kubeContext;
    if (cluster.kubernetesVersion) status.kubernetesVersion = cluster.kubernetesVersion;
    if (cluster.clabernetesVersion) status.clabernetesVersion = cluster.clabernetesVersion;
    status.available = problems.length === 0;
    return status;
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
