import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { LabHostCheck } from "@containerlab/clab-ui/host";

import type { KubeClusterProbe } from "./kube/clusterProbe.ts";
import { containerlabCheck, detectC9sEnvironment } from "./kube/detect.ts";
import { resolveLocalOptions, type LocalLabBackendOptions, type ResolvedLocalOptions } from "./options.ts";
import { containerlabCommand, runCommand, stripAnsi } from "./process.ts";

/** Whether containerlab can run labs on this machine for the current user. */
export interface LocalEnvironmentStatus {
  available: boolean;
  /** What is missing, each with a hint how to fix it. */
  problems: string[];
  /** Every check in order, for "Check connection"; the ones after a failure that stops the rest are `skipped`. */
  checks: LabHostCheck[];
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

const INSTALL_CONTAINERLAB = 'curl -sL https://containerlab.dev/setup | sudo -E bash -s "all"';

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
    const problem = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      problems: [problem],
      checks: [{ id: "settings", label: "Lab host settings", status: "failed", message: problem }],
      platform: overrides.platform ?? process.platform,
      runtime: options.runtime?.trim() ?? "",
      username: options.username?.trim() ?? "",
      isRoot: false,
      inClabAdmins: false,
      inRuntimeGroup: false
    };
  }
  const problems: string[] = [];
  const checks: LabHostCheck[] = [];
  const { isRoot, inClabAdmins, inRuntimeGroup } = await detectLocalUser(options);
  const status: LocalEnvironmentStatus = {
    available: false,
    problems,
    checks,
    platform: overrides.platform ?? process.platform,
    runtime: resolved.runtime,
    username: resolved.username,
    isRoot,
    inClabAdmins,
    inRuntimeGroup
  };

  const c9s = resolved.runtime === "c9s";
  const platformProblem = containerlabPlatformProblem(status.platform);
  if (platformProblem) {
    problems.push(platformProblem);
    checks.push({
      id: "platform",
      label: "This computer runs Linux",
      status: "failed",
      message: platformProblem,
      fix: "Use a lab server (clab-api-server), or run the app in WSL or a Linux VM."
    });
    return status;
  }

  status.containerlabPath = await findBinary(resolved.binaryPath, resolved.env);
  let containerlabProblem: string | undefined;
  if (!status.containerlabPath) {
    containerlabProblem = `containerlab is not installed. Install it with: ${INSTALL_CONTAINERLAB}`;
    problems.push(containerlabProblem);
  } else {
    const [file, args] = containerlabCommand({ ...resolved, binaryPath: status.containerlabPath }, ["version"]);
    const result = await runCommand(file, args, { env: resolved.env, timeoutMs: 15_000 }).catch(() => undefined);
    const version = /version:\s*(\S+)/.exec(stripAnsi(result?.stdout ?? ""))?.[1];
    if (version) {
      status.containerlabVersion = version;
    } else {
      containerlabProblem = `containerlab at ${status.containerlabPath} does not run: ${result?.stderr.trim() || "no output"}`;
      problems.push(containerlabProblem);
    }
  }
  if (containerlabProblem !== undefined) {
    checks.push({
      ...(c9s ? containerlabCheck(undefined, containerlabProblem) : { id: "containerlab", label: "containerlab is installed", status: "failed" as const }),
      message: status.containerlabPath
        ? containerlabProblem
        : `containerlab was not found (looked for ${resolved.binaryPath}).`,
      fix: status.containerlabPath
        ? "Reinstall containerlab, or point the app to a working binary."
        : "Install containerlab, or point the app to its binary (containerlab.binaryPath in VS Code).",
      ...(status.containerlabPath ? {} : { command: INSTALL_CONTAINERLAB })
    });
  } else if (!c9s) {
    checks.push({
      id: "containerlab",
      label: "containerlab is installed",
      status: "ok",
      message: `containerlab ${status.containerlabVersion ?? ""} at ${status.containerlabPath}`
    });
  }

  if (c9s) {
    // The cluster runs the labs: no Docker and no clab_admins group needed.
    const cluster = await detectC9sEnvironment(resolved, status.containerlabVersion, overrides.kubeProbe);
    problems.push(...cluster.problems);
    checks.push(...cluster.checks);
    if (cluster.kubeContext) status.kubeContext = cluster.kubeContext;
    if (cluster.kubernetesVersion) status.kubernetesVersion = cluster.kubernetesVersion;
    if (cluster.clabernetesVersion) status.clabernetesVersion = cluster.clabernetesVersion;
    status.available = problems.length === 0;
    return status;
  }

  if (status.containerlabPath && !isRoot && !resolved.sudo) {
    const check = await suidRootCheck(status.containerlabPath);
    if (check.status === "failed") problems.push(`${check.message} Run: ${check.command}, or install containerlab normally.`);
    checks.push(check);
  }

  const groupsCheck = { id: "groups", label: `${resolved.username} may run containerlab without sudo` };
  if (!isRoot && !resolved.sudo) {
    const missing: string[] = [];
    if (!inClabAdmins) {
      missing.push("clab_admins");
      problems.push(
        `${resolved.username} is not in the clab_admins group. Run: sudo usermod -aG clab_admins ${resolved.username}, then log in again.`
      );
    }
    if (!inRuntimeGroup) {
      missing.push("docker");
      problems.push(
        `${resolved.username} is not in the docker group. Run: sudo usermod -aG docker ${resolved.username}, then log in again.`
      );
    }
    checks.push(
      missing.length === 0
        ? { ...groupsCheck, status: "ok", message: `In clab_admins${resolved.runtime === "docker" ? " and docker" : ""}` }
        : {
            ...groupsCheck,
            status: "failed",
            message: `${resolved.username} is not in ${missing.join(" and ")}.`,
            fix: "Add the groups, then log in again.",
            command: missing.map((group) => `sudo usermod -aG ${group} ${resolved.username}`).join(" && ")
          }
    );
  } else {
    checks.push({ ...groupsCheck, status: "ok", message: isRoot ? "Runs as root" : "Runs containerlab with sudo" });
  }

  const runtime = await runCommand(resolved.runtime, ["version", "--format", "{{.Server.Version}}"], {
    env: resolved.env,
    timeoutMs: 15_000
  }).catch(() => undefined);
  const runtimeCheck = { id: "runtime", label: `${resolved.runtime === "podman" ? "Podman" : "Docker"} answers` };
  if (!runtime || runtime.code !== 0) {
    const problem = runtime
      ? `${resolved.runtime} is not reachable: ${runtime.stderr.trim().split("\n")[0]}`
      : `${resolved.runtime} is not installed.`;
    problems.push(problem);
    checks.push({
      ...runtimeCheck,
      status: "failed",
      message: problem,
      fix: runtime ? `Start ${resolved.runtime}, and check its socket.` : `Install ${resolved.runtime}.`
    });
  } else {
    checks.push({ ...runtimeCheck, status: "ok", message: `${resolved.runtime} ${runtime.stdout.trim()}` });
  }

  status.available = problems.length === 0;
  return status;
}

function shellQuote(value: string): string {
  return /^[\w./+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * containerlab runs Docker labs as root: the user runs it as root or with
 * sudo, or the binary is owned by root with the SUID bit, as the installer
 * sets it up. A self-built binary is neither until it is changed.
 */
export async function suidRootCheck(binary: string): Promise<LabHostCheck> {
  const check = { id: "suid", label: "containerlab runs as root (SUID)" };
  const stat = await fs.stat(binary).catch(() => undefined);
  if (!stat) return { ...check, status: "skipped", message: `${binary} cannot be read.` };
  if (stat.uid === 0 && (stat.mode & 0o4000) !== 0) {
    return { ...check, status: "ok", message: `${binary} is SUID root` };
  }
  const quoted = shellQuote(binary);
  return {
    ...check,
    status: "failed",
    message: `containerlab at ${binary} is not SUID root, so it cannot run Docker labs without sudo.`,
    fix: "Make it SUID root, or install containerlab normally.",
    command: `sudo chown root:root ${quoted} && sudo chmod 4755 ${quoted}`
  };
}

/** The workspace root a local backend uses by default. */
export function defaultLocalWorkspaceRoot(): string {
  return path.join(os.homedir(), ".clab");
}
