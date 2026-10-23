import os from "node:os";
import path from "node:path";

/**
 * How to reach containerlab and the container runtime on this machine. Every
 * host fills it in from its own settings (VS Code settings, desktop config).
 */
export interface LocalLabBackendOptions {
  /** The containerlab binary; a bare name is looked up on PATH. */
  binaryPath?: string;
  /** Container runtime: `docker` or `podman`. */
  runtime?: string;
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
  runtime: string;
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

export function resolveLocalOptions(options: LocalLabBackendOptions = {}): ResolvedLocalOptions {
  const runtime = options.runtime?.trim() || "docker";
  return {
    binaryPath: options.binaryPath?.trim() || "containerlab",
    runtime,
    dockerSocketPath:
      options.dockerSocketPath?.trim() ||
      (runtime === "podman" ? defaultPodmanSocket() : "/var/run/docker.sock"),
    workspaceRoot: path.resolve(options.workspaceRoot?.trim() || path.join(os.homedir(), ".clab")),
    sudo: options.sudo === true,
    deployExtraArgs: options.deployExtraArgs ?? [],
    destroyExtraArgs: options.destroyExtraArgs ?? [],
    captureHostname: options.captureHostname?.trim() || "localhost",
    packetflixPort: options.packetflixPort ?? 5001,
    wiresharkImage: options.wiresharkImage?.trim() || DEFAULT_WIRESHARK_IMAGE,
    edgesharkExtraEnv: options.edgesharkExtraEnv ?? ["HTTP_PROXY=", "http_proxy="],
    env: options.env ?? process.env,
    username: options.username?.trim() || defaultUsername()
  };
}

function defaultPodmanSocket(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  return uid === 0 || uid === undefined
    ? "/run/podman/podman.sock"
    : `/run/user/${uid}/podman/podman.sock`;
}
