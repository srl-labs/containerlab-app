import { parseBooleanEnv } from "@srl-labs/containerlab-lab-backend";
import {
  containerlabPlatformProblem,
  detectLocalEnvironment,
  expandKubeconfigPath,
  LocalLabBackend,
  parseLabRuntime,
  type C9sHostOptions,
  type LocalLabBackendOptions
} from "@srl-labs/containerlab-lab-backend/local";
import type { LocalEndpointStatus } from "@srl-labs/containerlab-app-contract";

import type { LocalEndpointOptions } from "./app.ts";
import { c9sLocalEndpointUrl, LOCAL_ENDPOINT_URL } from "./endpointSessionStore.ts";
import { createLocalUiStore } from "./localUiStore.ts";

/** A Kubernetes cluster with clabernetes as another local lab host (`clusters` in the settings file). */
export interface LocalClusterConfig {
  /** How the app names the cluster; "Cluster <context> (c9s)" when unset. */
  label?: string;
  options: LocalLabBackendOptions;
}

/** Whether an app runs labs on its own machine, and with which backend options. */
export interface LocalBackendConfig {
  enabled: boolean;
  /** The first local lab host: this machine, or a cluster with `runtime: "c9s"`. */
  options: LocalLabBackendOptions;
  /** More lab hosts next to the first: one per cluster. */
  clusters: LocalClusterConfig[];
  /** Settings that were left out, each with why. */
  problems: string[];
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
   * `<prefix>SUDO`, and for `RUNTIME=c9s` `<prefix>KUBE_CONTEXT`,
   * `<prefix>KUBECONFIG`, `<prefix>KUBE_NAMESPACE`, `<prefix>C9S_EXPOSE_TYPE`
   * and `<prefix>C9S_PERSISTENCE`.
   */
  envPrefix: string;
  /** The variable that turns labs on this machine on or off. */
  enableVariable: string;
  enabledByDefault: boolean;
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

const C9S_EXPOSE_TYPES = new Set(["ClusterIP", "Headless", "LoadBalancer", "None"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The c9s settings of a host from the settings file, or a problem. */
function readC9sOptions(raw: Record<string, unknown>, where: string): C9sHostOptions | string {
  const c9s: C9sHostOptions = {};
  const kubeContext = stringValue(raw.kubeContext);
  const kubeconfig = stringValue(raw.kubeconfig);
  const namespace = stringValue(raw.namespace);
  const exposeType = stringValue(raw.exposeType);
  if (kubeContext) c9s.kubeContext = kubeContext;
  if (kubeconfig) c9s.kubeconfig = expandKubeconfigPath(kubeconfig);
  if (namespace) c9s.namespace = namespace;
  if (exposeType !== undefined) {
    if (!C9S_EXPOSE_TYPES.has(exposeType)) {
      return `${where}: exposeType "${exposeType}" is none of ClusterIP, Headless, LoadBalancer, None.`;
    }
    c9s.exposeType = exposeType as C9sHostOptions["exposeType"];
  }
  if (raw.persistence === false) c9s.persistence = false;
  return c9s;
}

function readClusters(value: unknown, problems: string[]): LocalClusterConfig[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    problems.push("clusters must be a list of Kubernetes clusters.");
    return [];
  }
  const clusters: LocalClusterConfig[] = [];
  value.forEach((entry, index) => {
    const where = `clusters[${index}]`;
    if (!isObject(entry)) {
      problems.push(`${where} is not an object.`);
      return;
    }
    const c9s = readC9sOptions(entry, where);
    if (typeof c9s === "string") {
      problems.push(c9s);
      return;
    }
    if (!c9s.kubeContext) {
      problems.push(`${where} names no kubeContext.`);
      return;
    }
    const label = stringValue(entry.label);
    clusters.push({ ...(label ? { label } : {}), options: { runtime: "c9s", c9s } });
  });
  return clusters;
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
 * environment. Every local lab host needs Linux, where containerlab runs.
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

  const problems: string[] = [];
  let runtimeValid = true;
  if (options.runtime !== undefined && !parseLabRuntime(options.runtime)) {
    problems.push(`Unknown lab runtime "${options.runtime}". Use docker, podman or c9s.`);
    runtimeValid = false;
  }
  if (parseLabRuntime(options.runtime) === "c9s") {
    const fromFile = readC9sOptions(isObject(file.c9s) ? file.c9s : {}, "c9s");
    const c9s = typeof fromFile === "string" ? {} : fromFile;
    if (typeof fromFile === "string") problems.push(fromFile);
    const kubeContext = stringValue(env[`${envPrefix}KUBE_CONTEXT`]);
    const kubeconfig = stringValue(env[`${envPrefix}KUBECONFIG`]);
    const namespace = stringValue(env[`${envPrefix}KUBE_NAMESPACE`]);
    const exposeType = stringValue(env[`${envPrefix}C9S_EXPOSE_TYPE`]);
    const persistence = env[`${envPrefix}C9S_PERSISTENCE`];
    if (kubeContext) c9s.kubeContext = kubeContext;
    if (kubeconfig) c9s.kubeconfig = expandKubeconfigPath(kubeconfig);
    if (namespace) c9s.namespace = namespace;
    if (exposeType) {
      if (C9S_EXPOSE_TYPES.has(exposeType)) c9s.exposeType = exposeType as C9sHostOptions["exposeType"];
      else problems.push(`${envPrefix}C9S_EXPOSE_TYPE "${exposeType}" is none of ClusterIP, Headless, LoadBalancer, None.`);
    }
    if (persistence !== undefined && !parseBooleanEnv(persistence, true)) c9s.persistence = false;
    options.c9s = c9s;
  }
  const clusters = readClusters(file.clusters, problems);

  const enabledByFile = typeof file.enabled === "boolean" ? file.enabled : source.enabledByDefault;
  const enabled = runtimeValid && parseBooleanEnv(env[source.enableVariable], enabledByFile);
  // containerlab runs on Linux only. A cluster's labs run in Kubernetes, but
  // containerlab on this machine deploys and reaches them, so it needs Linux too.
  const platformProblem = containerlabPlatformProblem(source.platform);
  if (enabled && platformProblem && (parseLabRuntime(options.runtime) === "c9s" || clusters.length > 0)) {
    problems.push(`Kubernetes clusters are left out: ${platformProblem}`);
  }
  const usable = enabled && platformProblem === undefined;
  return {
    enabled: usable,
    options,
    clusters: usable ? clusters : [],
    problems
  };
}

/** The `local://` address of a local lab host. */
function localEndpointUrl(options: LocalLabBackendOptions): string {
  return parseLabRuntime(options.runtime) === "c9s"
    ? c9sLocalEndpointUrl(options.c9s?.kubeContext, options.c9s?.kubeconfig)
    : LOCAL_ENDPOINT_URL;
}

/** How the apps name a cluster lab host, e.g. "Cluster lab-prod (c9s)". */
function clusterLabel(options: LocalLabBackendOptions): string {
  return `Cluster ${options.c9s?.kubeContext ?? "current context"} (c9s)`;
}

const STATUS_TTL_MS = 15_000;

/**
 * Labs on the app's own machine: one backend that acts as the app's OS user,
 * its custom nodes and icons, and a status that is checked again at most
 * every 15 seconds unless asked for a fresh one.
 */
export function createLocalEndpoint(input: {
  options: LocalLabBackendOptions;
  /** The `local://` address; from the runtime and context when unset. */
  url?: string;
  /** How the apps name this machine, e.g. "This computer". */
  label: string;
  /** Docs page that explains how to set this machine up. */
  setupUrl?: string;
  autoConnect?: boolean;
}): LocalEndpointOptions & { backend: LocalLabBackend; url: string } {
  const backend = new LocalLabBackend(input.options);
  const { runtime, c9s } = backend.options;
  let cached: { at: number; status: Promise<LocalEndpointStatus> } | undefined;
  return {
    url: input.url ?? localEndpointUrl(input.options),
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
            runtime,
            ...(c9s?.kubeContext ? { kubeContext: c9s.kubeContext } : {}),
            ...(c9s?.namespace ? { namespace: c9s.namespace } : {}),
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

/**
 * The local lab hosts of a config: this machine (or the cluster it names as
 * its runtime) first, then each configured cluster.
 */
export function createLocalEndpoints(
  config: LocalBackendConfig,
  input: { label: string; setupUrl?: string; autoConnect?: boolean }
): Array<LocalEndpointOptions & { backend: LocalLabBackend; url: string }> {
  const endpoints: Array<LocalEndpointOptions & { backend: LocalLabBackend; url: string }> = [];
  const urls = new Set<string>();
  const add = (options: LocalLabBackendOptions, label: string) => {
    const url = localEndpointUrl(options);
    // One lab host per cluster context.
    if (urls.has(url)) return;
    urls.add(url);
    endpoints.push(
      createLocalEndpoint({
        options,
        url,
        label,
        ...(input.setupUrl !== undefined ? { setupUrl: input.setupUrl } : {}),
        ...(input.autoConnect !== undefined ? { autoConnect: input.autoConnect } : {})
      })
    );
  };
  if (config.enabled) {
    add(config.options, parseLabRuntime(config.options.runtime) === "c9s" ? clusterLabel(config.options) : input.label);
  }
  for (const cluster of config.clusters) {
    add({ ...config.options, ...cluster.options }, cluster.label ?? clusterLabel(cluster.options));
  }
  return endpoints;
}
