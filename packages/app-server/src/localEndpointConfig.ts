import { parseBooleanEnv } from "@srl-labs/containerlab-lab-backend";
import {
  detectLocalEnvironment,
  LocalLabBackend,
  type LocalLabBackendOptions
} from "@srl-labs/containerlab-lab-backend/local";
import type { LocalEndpointStatus } from "@srl-labs/containerlab-app-contract";

import type { LocalEndpointOptions } from "./app.ts";
import { createLocalUiStore } from "./localUiStore.ts";

/** Whether an app runs labs on its own machine, and with which backend options. */
export interface LocalBackendConfig {
  enabled: boolean;
  options: LocalLabBackendOptions;
}

/** Where an app reads its local backend settings from. */
export interface LocalBackendConfigSource {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** A JSON settings file, such as the desktop app's `local-backend.json`. */
  fileContent?: string;
  /**
   * Prefix of the variables that override the file: `<prefix>CLAB_BINARY`,
   * `<prefix>RUNTIME`, `<prefix>DOCKER_SOCKET`, `<prefix>WORKSPACE`,
   * `<prefix>SUDO` and `<prefix>HOST_SCRIPTS`.
   */
  envPrefix: string;
  /** The variable that turns labs on this machine on or off. */
  enableVariable: string;
  enabledByDefault: boolean;
  /** Whether script buttons may run shell scripts on this machine unless configured. */
  hostScriptsByDefault: boolean;
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

function readSettingsFile(content: string | undefined): Record<string, unknown> {
  if (content === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed));
    }
  } catch {
    // An unreadable file leaves the defaults.
  }
  return {};
}

/**
 * The local backend settings: the settings file first, then the
 * environment. Labs on the app's own machine need Linux.
 */
export function resolveLocalBackendConfig(source: LocalBackendConfigSource): LocalBackendConfig {
  const { env, envPrefix } = source;
  const file = readSettingsFile(source.fileContent);

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
    ["binaryPath", env[`${envPrefix}CLAB_BINARY`]],
    ["runtime", env[`${envPrefix}RUNTIME`]],
    ["dockerSocketPath", env[`${envPrefix}DOCKER_SOCKET`]],
    ["workspaceRoot", env[`${envPrefix}WORKSPACE`]]
  ];
  for (const [key, value] of fromEnv) {
    const trimmed = value?.trim() ?? "";
    if (trimmed !== "") Object.assign(options, { [key]: trimmed });
  }
  const sudo = env[`${envPrefix}SUDO`];
  if (sudo !== undefined) {
    options.sudo = parseBooleanEnv(sudo, options.sudo ?? false);
  }
  const hostScriptsByFile = typeof file.hostScripts === "boolean" ? file.hostScripts : source.hostScriptsByDefault;
  options.hostScripts = parseBooleanEnv(env[`${envPrefix}HOST_SCRIPTS`], hostScriptsByFile);

  const enabledByFile = typeof file.enabled === "boolean" ? file.enabled : source.enabledByDefault;
  return {
    enabled: source.platform === "linux" && parseBooleanEnv(env[source.enableVariable], enabledByFile),
    options
  };
}

const STATUS_TTL_MS = 15_000;

/**
 * Labs on the app's own machine: one backend that acts as the app's OS user,
 * its custom nodes and icons, and a status that is checked again at most
 * every 15 seconds unless asked for a fresh one.
 */
export function createLocalEndpoint(input: {
  options: LocalLabBackendOptions;
  /** How the apps name this machine, e.g. "This computer". */
  label: string;
  /** Docs page that explains how to set this machine up. */
  setupUrl?: string;
  autoConnect?: boolean;
}): LocalEndpointOptions & { backend: LocalLabBackend } {
  const backend = new LocalLabBackend(input.options);
  let cached: { at: number; status: Promise<LocalEndpointStatus> } | undefined;
  return {
    backend,
    ui: createLocalUiStore({ workspaceRoot: backend.options.workspaceRoot }),
    autoConnect: input.autoConnect,
    status(request) {
      if (!cached || request?.fresh === true || Date.now() - cached.at > STATUS_TTL_MS) {
        cached = {
          at: Date.now(),
          status: detectLocalEnvironment(input.options).then((environment) => ({
            available: environment.available,
            problems: environment.problems,
            label: input.label,
            username: environment.username,
            ...(environment.containerlabVersion !== undefined
              ? { containerlabVersion: environment.containerlabVersion }
              : {}),
            ...(input.setupUrl !== undefined ? { setupUrl: input.setupUrl } : {})
          }))
        };
      }
      return cached.status;
    }
  };
}
