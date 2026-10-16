import type { LocalLabBackendOptions } from "@srl-labs/containerlab-lab-backend/local";
import { parseBooleanEnv } from "@srl-labs/containerlab-app-server";

/**
 * The "This computer" endpoint: containerlab on the machine the desktop app
 * runs on. Linux only for now; macOS and Windows connect to clab-api-server.
 */
export interface LocalBackendConfig {
  enabled: boolean;
  options: LocalLabBackendOptions;
}

const OPTION_KEYS = [
  "binaryPath",
  "runtime",
  "dockerSocketPath",
  "workspaceRoot",
  "captureHostname",
  "wiresharkImage"
] as const;

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

/**
 * Options from the user's `local-backend.json`, then the environment:
 * CONTAINERLAB_DESKTOP_LOCAL=0 turns the local endpoint off, and
 * CONTAINERLAB_DESKTOP_CLAB_BINARY, _RUNTIME, _DOCKER_SOCKET, _WORKSPACE and
 * _SUDO override the file.
 */
export function resolveLocalBackendConfig(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  fileContent: string | undefined
): LocalBackendConfig {
  let file: Record<string, unknown> = {};
  if (fileContent !== undefined) {
    try {
      const parsed = JSON.parse(fileContent) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        file = parsed as Record<string, unknown>;
      }
    } catch {
      // An unreadable file leaves the defaults.
    }
  }

  const options: LocalLabBackendOptions = {};
  for (const key of OPTION_KEYS) {
    const value = file[key];
    if (typeof value === "string" && value.trim()) options[key] = value.trim();
  }
  if (file.sudo === true) options.sudo = true;
  const deployExtraArgs = stringArray(file.deployExtraArgs);
  if (deployExtraArgs) options.deployExtraArgs = deployExtraArgs;
  const destroyExtraArgs = stringArray(file.destroyExtraArgs);
  if (destroyExtraArgs) options.destroyExtraArgs = destroyExtraArgs;

  const fromEnv: Array<[keyof LocalLabBackendOptions, string | undefined]> = [
    ["binaryPath", env.CONTAINERLAB_DESKTOP_CLAB_BINARY],
    ["runtime", env.CONTAINERLAB_DESKTOP_RUNTIME],
    ["dockerSocketPath", env.CONTAINERLAB_DESKTOP_DOCKER_SOCKET],
    ["workspaceRoot", env.CONTAINERLAB_DESKTOP_WORKSPACE]
  ];
  for (const [key, value] of fromEnv) {
    if (value?.trim()) (options as Record<string, unknown>)[key] = value.trim();
  }
  if (env.CONTAINERLAB_DESKTOP_SUDO !== undefined) {
    options.sudo = parseBooleanEnv(env.CONTAINERLAB_DESKTOP_SUDO, options.sudo ?? false);
  }

  const enabledByFile = file.enabled !== false;
  return {
    enabled: platform === "linux" && parseBooleanEnv(env.CONTAINERLAB_DESKTOP_LOCAL, enabledByFile),
    options
  };
}
