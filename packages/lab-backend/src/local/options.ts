import os from "node:os";
import path from "node:path";

import { isC9sExposeType, type C9sExposeType, type LabRuntimeKind } from "@containerlab/clab-ui/host";

import { LabBackendError } from "../contract/errors.ts";

/** The c9s settings of a lab host: a Kubernetes cluster with clabernetes. */
export interface C9sHostOptions {
  /** The kubeconfig context of the cluster; the kubeconfig's current context when empty. */
  kubeContext?: string;
  /**
   * The kubeconfig file (a leading `~` is the home folder); `KUBECONFIG` (or
   * `~/.kube/config`) when empty.
   */
  kubeconfig?: string;
  /**
   * The namespace of every lab, for users who may only use one namespace.
   * Without it each lab gets its own namespace, `c9s-<lab>`.
   */
  namespace?: string;
  /** How node ports are exposed by default (`--expose-type`). */
  exposeType?: C9sExposeType;
  /** Persistent volumes for node state; on unless false (`--no-persistence`). */
  persistence?: boolean;
}

/**
 * How to reach containerlab and the container runtime on this machine. Every
 * host fills it in from its own settings (VS Code settings, desktop config).
 */
export interface LocalLabBackendOptions {
  /** The containerlab binary; a bare name is looked up on PATH. */
  binaryPath?: string;
  /** Lab runtime: `docker` (default), `podman` or `c9s`. */
  runtime?: string;
  /** With `runtime: "c9s"`: the cluster and its defaults. */
  c9s?: C9sHostOptions;
  /** Docker Engine API socket of the runtime. */
  dockerSocketPath?: string;
  /** Lab workspace root; topologies and lab folders live here. Default `~/.clab`. */
  workspaceRoot?: string;
  /**
   * Run containerlab through `sudo -n`. Off by default: members of the
   * `clab_admins` group run containerlab without it. Never prompts for a password.
   */
  sudo?: boolean;
  /** Extra arguments for every deploy and redeploy, e.g. from a user setting. */
  deployExtraArgs?: string[];
  /** Extra arguments for every destroy. */
  destroyExtraArgs?: string[];
  /** Host name in Packetflix capture links when none is requested. */
  captureHostname?: string;
  /** Edgeshark's Packetflix port. */
  packetflixPort?: number;
  /** Image of the Wireshark VNC capture containers. */
  wiresharkImage?: string;
  /** Extra `KEY=value` variables for the Edgeshark containers. */
  edgesharkExtraEnv?: string[];
  /** Environment for spawned commands. */
  env?: NodeJS.ProcessEnv;
  /** The OS user who owns labs on this machine. */
  username?: string;
}

export interface ResolvedLocalOptions {
  binaryPath: string;
  runtime: LabRuntimeKind;
  /** Set when `runtime` is `c9s`. */
  c9s?: C9sHostOptions;
  dockerSocketPath: string;
  workspaceRoot: string;
  sudo: boolean;
  deployExtraArgs: string[];
  destroyExtraArgs: string[];
  captureHostname: string;
  packetflixPort: number;
  wiresharkImage: string;
  edgesharkExtraEnv: string[];
  env: NodeJS.ProcessEnv;
  username: string;
}

export const DEFAULT_WIRESHARK_IMAGE = "ghcr.io/srl-labs/wireshark-vnc-docker:latest";

function defaultUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER ?? "user";
  }
}

const LAB_RUNTIMES: readonly LabRuntimeKind[] = ["docker", "podman", "c9s"];

/** A lab runtime name, or undefined when it is none containerlab-app supports. */
export function parseLabRuntime(value: string | undefined): LabRuntimeKind | undefined {
  const runtime = value?.trim().toLowerCase();
  return LAB_RUNTIMES.find((candidate) => candidate === runtime);
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

/**
 * A kubeconfig path (or path list) with a leading `~` replaced by the home
 * folder, as a shell would; containerlab and client-node take the path as is.
 */
export function expandKubeconfigPath(value: string, home: string = os.homedir()): string {
  return value
    .split(path.delimiter)
    .map((file) => {
      const entry = file.trim();
      if (entry === "~") return home;
      return entry.startsWith("~/") ? path.join(home, entry.slice(2)) : entry;
    })
    .join(path.delimiter);
}

function resolveC9sOptions(options: C9sHostOptions | undefined): C9sHostOptions {
  const kubeContext = trimmed(options?.kubeContext);
  const configured = trimmed(options?.kubeconfig);
  const kubeconfig = configured ? expandKubeconfigPath(configured) : undefined;
  const namespace = trimmed(options?.namespace);
  const exposeType = options?.exposeType;
  return {
    ...(kubeContext ? { kubeContext } : {}),
    ...(kubeconfig ? { kubeconfig } : {}),
    ...(namespace ? { namespace } : {}),
    ...(isC9sExposeType(exposeType) ? { exposeType } : {}),
    ...(options?.persistence === false ? { persistence: false } : {})
  };
}

/**
 * How containerlab finds the cluster: `CLAB_KUBE_CONTEXT`, `CLAB_KUBECONFIG`
 * and, for a host with one namespace, `CLAB_KUBE_NAMESPACE`.
 */
function c9sEnvironment(env: NodeJS.ProcessEnv, c9s: C9sHostOptions): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env };
  if (c9s.kubeContext) result.CLAB_KUBE_CONTEXT = c9s.kubeContext;
  if (c9s.kubeconfig) result.CLAB_KUBECONFIG = c9s.kubeconfig;
  if (c9s.namespace) result.CLAB_KUBE_NAMESPACE = c9s.namespace;
  return result;
}

export function resolveLocalOptions(options: LocalLabBackendOptions = {}): ResolvedLocalOptions {
  const runtime = options.runtime?.trim() ? parseLabRuntime(options.runtime) : "docker";
  if (!runtime) {
    throw new LabBackendError(
      `Unknown lab runtime "${options.runtime?.trim()}". Use docker, podman or c9s.`,
      400
    );
  }
  const c9s = runtime === "c9s" ? resolveC9sOptions(options.c9s) : undefined;
  const env = options.env ?? process.env;
  return {
    binaryPath: options.binaryPath?.trim() || "containerlab",
    runtime,
    ...(c9s ? { c9s } : {}),
    dockerSocketPath:
      options.dockerSocketPath?.trim() ||
      (runtime === "podman" ? defaultPodmanSocket() : "/var/run/docker.sock"),
    workspaceRoot: path.resolve(options.workspaceRoot?.trim() || path.join(os.homedir(), ".clab")),
    // c9s talks to the cluster with the user's own kubeconfig; sudo would drop it.
    sudo: runtime !== "c9s" && options.sudo === true,
    deployExtraArgs: options.deployExtraArgs ?? [],
    destroyExtraArgs: options.destroyExtraArgs ?? [],
    captureHostname: options.captureHostname?.trim() || "localhost",
    packetflixPort: options.packetflixPort ?? 5001,
    wiresharkImage: options.wiresharkImage?.trim() || DEFAULT_WIRESHARK_IMAGE,
    edgesharkExtraEnv: options.edgesharkExtraEnv ?? ["HTTP_PROXY=", "http_proxy="],
    env: c9s ? c9sEnvironment(env, c9s) : env,
    username: options.username?.trim() || defaultUsername()
  };
}

function defaultPodmanSocket(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  return uid === 0 || uid === undefined
    ? "/run/podman/podman.sock"
    : `/run/user/${uid}/podman/podman.sock`;
}
