import { isRecord } from "../core/utilities/typeHelpers";

/** The lab runtime a lab host runs containerlab with (`containerlab -r`). */
export type LabRuntimeKind = "docker" | "podman" | "c9s";

/** How clabernetes exposes node ports (`--expose-type`). */
export type C9sExposeType = "ClusterIP" | "Headless" | "LoadBalancer" | "None";

export const C9S_EXPOSE_TYPES: readonly C9sExposeType[] = [
  "None",
  "ClusterIP",
  "LoadBalancer",
  "Headless"
];

export function isC9sExposeType(value: unknown): value is C9sExposeType {
  return typeof value === "string" && (C9S_EXPOSE_TYPES as readonly string[]).includes(value);
}

/**
 * Extra containerlab options for deploy, redeploy and destroy.
 *
 * Every field maps to a containerlab flag and to the matching clab-api-server
 * query parameter. Not every action takes every flag; see
 * `LAB_LIFECYCLE_OPTION_FIELDS`.
 */
export interface LabLifecycleOptions {
  /**
   * How long containerlab waits for the lab runtime, as a Go duration such as
   * `30m` (`--timeout`). containerlab's default is 2m on Docker and Podman and
   * 10m on c9s, where nodes wait for their images.
   */
  timeout?: string;
  /** Only act on these nodes (`--node-filter`). */
  nodeFilter?: string[];
  /** Limit the number of parallel workers (`--max-workers`). */
  maxWorkers?: number;
  /** Skip post-deploy actions (`--skip-post-deploy`). */
  skipPostDeploy?: boolean;
  /** Skip the lab directory extended ACLs (`--skip-labdir-acl`). */
  skipLabdirAcl?: boolean;
  /** Template file for the topology data export (`--export-template`). */
  exportTemplate?: string;
  /** Stop containers before removing them (`--graceful`). */
  graceful?: boolean;
  /** Keep the management network (`--keep-mgmt-net`). */
  keepMgmtNet?: boolean;
  /**
   * Template variables file, relative to the topology file (`--vars`).
   * Without it containerlab uses `<topology>_vars.yml` next to the topology.
   */
  varsFile?: string;
  /**
   * Restore VM snapshots from `<dir>/<node>.tar` (`--restore-all`). Relative
   * paths start at the topology directory.
   */
  restoreAll?: string;
  /** Restore single nodes from snapshot files (`--restore node=path`); wins over `restoreAll`. */
  restore?: LabSnapshotRestore[];
  /** c9s: the Kubernetes namespace of the lab (`--namespace`); default `c9s-<lab>`. */
  namespace?: string;
  /** c9s: how node ports are exposed (`--expose-type`). */
  exposeType?: C9sExposeType;
  /** c9s: no persistent volumes for node state (`--no-persistence`). */
  noPersistence?: boolean;
  /** c9s: the image pull secret of the lab's pods (`--image-pull-secret`). */
  imagePullSecret?: string;
  /** c9s: deploy the nodes without a Topology resource (`--no-topology-cr`). */
  noTopologyCR?: boolean;
}

/** One node restored from a VM snapshot file on deploy. */
export interface LabSnapshotRestore {
  node: string;
  path: string;
}

export type LabLifecycleOptionKind = "deploy" | "redeploy" | "destroy";
export type LabLifecycleOptionField = keyof LabLifecycleOptions;

/**
 * Options each action accepts, following containerlab and clab-api-server:
 * redeploy has no node filter, and the API does not take `maxWorkers` on destroy.
 * `LAB_LIFECYCLE_OPTION_RUNTIMES` narrows them per lab runtime.
 */
export const LAB_LIFECYCLE_OPTION_FIELDS: Record<
  LabLifecycleOptionKind,
  readonly LabLifecycleOptionField[]
> = {
  deploy: [
    "timeout",
    "nodeFilter",
    "maxWorkers",
    "skipPostDeploy",
    "skipLabdirAcl",
    "exportTemplate",
    "restoreAll",
    "restore",
    "varsFile",
    "namespace",
    "exposeType",
    "noPersistence",
    "imagePullSecret",
    "noTopologyCR"
  ],
  redeploy: [
    "timeout",
    "maxWorkers",
    "skipPostDeploy",
    "skipLabdirAcl",
    "exportTemplate",
    "graceful",
    "keepMgmtNet",
    "varsFile",
    "namespace",
    "exposeType",
    "noPersistence",
    "imagePullSecret",
    "noTopologyCR"
  ],
  destroy: ["timeout", "nodeFilter", "graceful", "keepMgmtNet", "varsFile", "namespace"]
};

const CONTAINER_RUNTIMES: readonly LabRuntimeKind[] = ["docker", "podman"];
const C9S_RUNTIME: readonly LabRuntimeKind[] = ["c9s"];

/**
 * The lab runtimes that take an option; options not listed take every runtime.
 * containerlab rejects the container-only flags under `-r c9s`, and the c9s
 * flags mean nothing to Docker or Podman.
 */
export const LAB_LIFECYCLE_OPTION_RUNTIMES: Partial<
  Record<LabLifecycleOptionField, readonly LabRuntimeKind[]>
> = {
  nodeFilter: CONTAINER_RUNTIMES,
  graceful: CONTAINER_RUNTIMES,
  restoreAll: CONTAINER_RUNTIMES,
  restore: CONTAINER_RUNTIMES,
  skipPostDeploy: CONTAINER_RUNTIMES,
  skipLabdirAcl: CONTAINER_RUNTIMES,
  exportTemplate: CONTAINER_RUNTIMES,
  keepMgmtNet: CONTAINER_RUNTIMES,
  namespace: C9S_RUNTIME,
  exposeType: C9S_RUNTIME,
  noPersistence: C9S_RUNTIME,
  imagePullSecret: C9S_RUNTIME,
  noTopologyCR: C9S_RUNTIME
};

/**
 * The lab runtime options are checked for; `any` keeps the options of every
 * runtime, for clients that leave the narrowing to the lab host.
 */
export type LabLifecycleOptionRuntime = LabRuntimeKind | "any";

/** The options an action takes on a lab runtime. */
export function labLifecycleOptionFields(
  kind: LabLifecycleOptionKind,
  runtime: LabLifecycleOptionRuntime = "docker"
): readonly LabLifecycleOptionField[] {
  if (runtime === "any") return LAB_LIFECYCLE_OPTION_FIELDS[kind];
  return LAB_LIFECYCLE_OPTION_FIELDS[kind].filter(
    (field) => LAB_LIFECYCLE_OPTION_RUNTIMES[field]?.includes(runtime) ?? true
  );
}

const NODE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const EXPORT_TEMPLATE_PATTERN = /^[A-Za-z0-9_./~-]+$/;
const VARS_FILE_PATTERN = /^[A-Za-z0-9_./@+-]+$/;
/** A Kubernetes namespace or secret name: a DNS label (RFC 1123), as Kubernetes checks it. */
const KUBE_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const KUBE_SECRET_NAME_PATTERN = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
/** A Go duration with units, as containerlab's `--timeout` takes it, e.g. `30m` or `1h30m`. */
const DURATION_PATTERN = /^(?:\d+(?:\.\d+)?(?:h|m|s|ms))+$/;
const BOOLEAN_FIELDS = [
  "skipPostDeploy",
  "skipLabdirAcl",
  "graceful",
  "keepMgmtNet",
  "noPersistence",
  "noTopologyCR"
] as const;
const MAX_PATH_LENGTH = 4096;

export function isValidLifecycleNodeName(name: string): boolean {
  return NODE_NAME_PATTERN.test(name);
}

/** A Kubernetes namespace name. */
export function isValidKubeNamespace(name: string): boolean {
  return KUBE_NAME_PATTERN.test(name);
}

/** A Kubernetes Secret name. */
export function isValidKubeSecretName(name: string): boolean {
  return KUBE_SECRET_NAME_PATTERN.test(name);
}

/** A positive Go duration such as `90s`, `30m` or `1h30m`. */
export function isValidLifecycleTimeout(value: string): boolean {
  return DURATION_PATTERN.test(value) && /[1-9]/.test(value);
}

/** containerlab's `--timeout` default: 10m on lab runtimes such as c9s, where nodes wait for their images, else 2m. */
export function containerlabDefaultTimeout(runtime: LabRuntimeKind): string {
  return runtime === "c9s" ? "10m" : "2m";
}

const DURATION_UNIT_MS: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1 };

/** A lifecycle timeout in milliseconds; undefined unless it is a valid one. */
export function lifecycleTimeoutMs(value: string | undefined): number | undefined {
  const trimmed = value?.trim() ?? "";
  if (!isValidLifecycleTimeout(trimmed)) return undefined;
  let total = 0;
  for (const [, amount, unit] of trimmed.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    total += Number(amount) * (DURATION_UNIT_MS[unit] ?? 0);
  }
  return total;
}

export function isValidExportTemplate(template: string): boolean {
  return EXPORT_TEMPLATE_PATTERN.test(template) && !template.includes("..");
}

/** A file or directory path a lab action reads or writes: no control characters. */
export function isValidLabActionPath(value: string): boolean {
  if (value.length === 0 || value.length > MAX_PATH_LENGTH) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function readPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return isValidLabActionPath(trimmed) ? trimmed : undefined;
}

function readRestore(value: unknown): LabSnapshotRestore[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const byNode = new Map<string, string>();
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.node !== "string") continue;
    const node = entry.node.trim();
    const path = readPath(entry.path);
    if (path !== undefined && isValidLifecycleNodeName(node)) byNode.set(node, path);
  }
  const restore = Array.from(byNode, ([node, path]) => ({ node, path }));
  return restore.length > 0 ? restore : undefined;
}

function readNodeFilter(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim())
    .filter((name) => isValidLifecycleNodeName(name));
  const unique = Array.from(new Set(names));
  return unique.length > 0 ? unique : undefined;
}

/** A vars file path relative to the topology file, e.g. `lab.clab_vars.prod.yml`. */
export function isValidVarsFile(file: string): boolean {
  return VARS_FILE_PATTERN.test(file) && !file.startsWith("/");
}

function readVarsFile(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const file = value.trim();
  return file.length > 0 && isValidVarsFile(file) ? file : undefined;
}

function readMaxWorkers(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readExportTemplate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const template = value.trim();
  return template.length > 0 && isValidExportTemplate(template) ? template : undefined;
}

function readKubeName(value: unknown, valid: (name: string) => boolean): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length > 0 && valid(name) ? name : undefined;
}

/**
 * Keep the options that the action accepts on the lab runtime and that are
 * well formed; drop the rest. Returns undefined when nothing is left, so
 * callers can tell "no options" apart.
 */
export function normalizeLabLifecycleOptions(
  kind: LabLifecycleOptionKind,
  value: unknown,
  runtime: LabLifecycleOptionRuntime = "docker"
): LabLifecycleOptions | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value;
  const allowed = new Set<LabLifecycleOptionField>(labLifecycleOptionFields(kind, runtime));
  const options: LabLifecycleOptions = {};

  if (allowed.has("timeout") && typeof raw.timeout === "string") {
    const timeout = raw.timeout.trim();
    if (isValidLifecycleTimeout(timeout)) options.timeout = timeout;
  }
  if (allowed.has("nodeFilter")) {
    const nodeFilter = readNodeFilter(raw.nodeFilter);
    if (nodeFilter) options.nodeFilter = nodeFilter;
  }
  if (allowed.has("maxWorkers")) {
    const maxWorkers = readMaxWorkers(raw.maxWorkers);
    if (maxWorkers !== undefined) options.maxWorkers = maxWorkers;
  }
  if (allowed.has("exportTemplate")) {
    const exportTemplate = readExportTemplate(raw.exportTemplate);
    if (exportTemplate !== undefined) options.exportTemplate = exportTemplate;
  }
  for (const field of BOOLEAN_FIELDS) {
    if (allowed.has(field) && raw[field] === true) options[field] = true;
  }
  if (allowed.has("varsFile")) {
    const varsFile = readVarsFile(raw.varsFile);
    if (varsFile !== undefined) options.varsFile = varsFile;
  }
  if (allowed.has("restoreAll")) Object.assign(options, readSnapshotRestore(raw));
  if (allowed.has("namespace")) {
    const namespace = readKubeName(raw.namespace, isValidKubeNamespace);
    if (namespace !== undefined) options.namespace = namespace;
  }
  if (allowed.has("exposeType") && isC9sExposeType(raw.exposeType)) {
    options.exposeType = raw.exposeType;
  }
  if (allowed.has("imagePullSecret")) {
    const secret = readKubeName(raw.imagePullSecret, isValidKubeSecretName);
    if (secret !== undefined) options.imagePullSecret = secret;
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

function readSnapshotRestore(
  raw: Record<string, unknown>
): Pick<LabLifecycleOptions, "restoreAll" | "restore"> {
  const restoreAll = readPath(raw.restoreAll);
  const restore = readRestore(raw.restore);
  return {
    ...(restoreAll !== undefined ? { restoreAll } : {}),
    ...(restore ? { restore } : {})
  };
}

/** containerlab CLI flags for the options, in a stable order. */
export function labLifecycleCliFlags(options: LabLifecycleOptions | undefined): string[] {
  if (!options) return [];
  const flags: string[] = [];
  if (options.timeout !== undefined) flags.push("--timeout", options.timeout);
  if (options.nodeFilter && options.nodeFilter.length > 0) {
    flags.push("--node-filter", options.nodeFilter.join(","));
  }
  if (options.maxWorkers !== undefined) flags.push("--max-workers", String(options.maxWorkers));
  if (options.skipPostDeploy === true) flags.push("--skip-post-deploy");
  if (options.skipLabdirAcl === true) flags.push("--skip-labdir-acl");
  if (options.exportTemplate !== undefined) {
    flags.push("--export-template", options.exportTemplate);
  }
  if (options.graceful === true) flags.push("--graceful");
  if (options.keepMgmtNet === true) flags.push("--keep-mgmt-net");
  if (options.varsFile !== undefined) flags.push("--vars", options.varsFile);
  // `--restore-all` has an optional value, so it only takes one after `=`.
  if (options.restoreAll !== undefined) flags.push(`--restore-all=${options.restoreAll}`);
  for (const entry of options.restore ?? []) flags.push(`--restore=${entry.node}=${entry.path}`);
  if (options.namespace !== undefined) flags.push("--namespace", options.namespace);
  if (options.exposeType !== undefined) flags.push("--expose-type", options.exposeType);
  if (options.noPersistence === true) flags.push("--no-persistence");
  if (options.imagePullSecret !== undefined) flags.push("--image-pull-secret", options.imagePullSecret);
  if (options.noTopologyCR === true) flags.push("--no-topology-cr");
  return flags;
}

/**
 * clab-api-server query parameters for the options. The c9s options have
 * none: a clab-api-server with `CLAB_RUNTIME=c9s` sets namespaces, exposure
 * and persistence itself. `timeout` needs a server that lists
 * `lab-lifecycle-timeout`; hosts offer it only where `lifecycleTimeout` is
 * supported.
 */
export function labLifecycleQueryParams(
  options: LabLifecycleOptions | undefined
): Array<[string, string]> {
  if (!options) return [];
  const params: Array<[string, string]> = [];
  if (options.timeout !== undefined) params.push(["timeout", options.timeout]);
  if (options.nodeFilter && options.nodeFilter.length > 0) {
    params.push(["nodeFilter", options.nodeFilter.join(",")]);
  }
  if (options.maxWorkers !== undefined) params.push(["maxWorkers", String(options.maxWorkers)]);
  if (options.skipPostDeploy === true) params.push(["skipPostDeploy", "true"]);
  if (options.skipLabdirAcl === true) params.push(["skipLabdirAcl", "true"]);
  if (options.exportTemplate !== undefined) params.push(["exportTemplate", options.exportTemplate]);
  if (options.graceful === true) params.push(["graceful", "true"]);
  if (options.keepMgmtNet === true) params.push(["keepMgmtNet", "true"]);
  if (options.varsFile !== undefined) params.push(["varsPath", options.varsFile]);
  if (options.restoreAll !== undefined) params.push(["restoreAll", options.restoreAll]);
  for (const entry of options.restore ?? []) params.push(["restore", `${entry.node}=${entry.path}`]);
  return params;
}

/**
 * Destroying some nodes leaves the rest of the lab running, so hosts must not
 * treat it as the lab going away.
 */
export function isPartialDestroy(options: LabLifecycleOptions | undefined): boolean {
  return (options?.nodeFilter?.length ?? 0) > 0;
}

/** Deploys that restore VM snapshots need a lab host that supports it. */
export function restoresSnapshots(options: LabLifecycleOptions | undefined): boolean {
  return options?.restoreAll !== undefined || (options?.restore?.length ?? 0) > 0;
}

/**
 * The deploy options a lab remembers on its lab host, its "lab settings":
 * every deploy, redeploy and apply without options of their own uses them.
 * Options of one run (node filter, snapshot restore, cleanup) stay out.
 */
export const LAB_SETTINGS_FIELDS = [
  "timeout",
  "maxWorkers",
  "skipPostDeploy",
  "skipLabdirAcl",
  "exportTemplate",
  "varsFile",
  "namespace",
  "exposeType",
  "noPersistence",
  "imagePullSecret",
  "noTopologyCR"
] as const satisfies readonly LabLifecycleOptionField[];

export type LabSettingsField = (typeof LAB_SETTINGS_FIELDS)[number];
export type LabSettings = Pick<LabLifecycleOptions, LabSettingsField>;

function pickLabSettings(options: LabLifecycleOptions | undefined): LabSettings | undefined {
  if (!options) return undefined;
  const settings: Record<string, unknown> = {};
  for (const field of LAB_SETTINGS_FIELDS) {
    if (options[field] !== undefined) settings[field] = options[field];
  }
  return Object.keys(settings).length > 0 ? (settings as LabSettings) : undefined;
}

/** Well-formed lab settings a lab runtime takes; undefined when none are left. */
export function normalizeLabSettings(
  value: unknown,
  runtime: LabLifecycleOptionRuntime = "any"
): LabSettings | undefined {
  return pickLabSettings(normalizeLabLifecycleOptions("deploy", value, runtime));
}

/**
 * The options of a lab's settings that an action takes: deploy, redeploy and
 * destroy take theirs (destroy e.g. the namespace), apply those of deploy.
 */
export function labSettingsOptions(
  action: LabLifecycleOptionKind | "apply",
  settings: LabSettings | undefined,
  runtime: LabLifecycleOptionRuntime = "any"
): LabLifecycleOptions | undefined {
  if (!settings) return undefined;
  const kind = action === "apply" ? "deploy" : action;
  const options = normalizeLabLifecycleOptions(kind, settings, runtime);
  return action === "apply" ? pickLabSettings(options) : options;
}

/** The lab settings among options of one run, e.g. to remember them. */
export function labSettingsFromOptions(options: LabLifecycleOptions | undefined): LabSettings | undefined {
  return pickLabSettings(options);
}
