/**
 * Utility functions for converting between NodeEditorData (camelCase) and
 * YAML extraData format (kebab-case)
 */

import type {
  NodeEditorData,
  HealthCheckConfig,
  NodeScalarValue,
  SrosComponent
} from "../types/editors";
import type { NodeSaveData } from "../io/NodePersistenceIO";
import { deepEqual } from "../io/YamlDocumentIO";

import {
  getString,
  getNumber,
  getBoolean,
  getStringArray,
  getRecordUnknown,
  getScalarRecord,
  isRecord
} from "./typeHelpers";
import { normalizeNodeBoxAppearance } from "./nodeBoxAppearance";

// ============================================================================
// Value normalization shared by the editor and the conversions
// ============================================================================

/** Image pull policies as containerlab spells them */
export const IMAGE_PULL_POLICIES = ["Always", "Never", "IfNotPresent"] as const;

/** Restart policies accepted by containerlab */
export const RESTART_POLICIES = ["no", "always", "on-failure", "unless-stopped"] as const;

/** Container runtimes containerlab supports */
export const CONTAINER_RUNTIMES = ["docker", "podman"] as const;

/** Prefix of the network mode that shares another container's network namespace */
export const CONTAINER_NETWORK_MODE_PREFIX = "container:";

/**
 * Map an image pull policy onto the containerlab spelling. containerlab reads
 * the value case-insensitively, so `always` and `IfNotPresent` are the same
 * policy. Unknown values are returned unchanged.
 */
export function normalizeImagePullPolicy(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[-_\s]/g, "");
  return IMAGE_PULL_POLICIES.find((policy) => policy.toLowerCase() === key) ?? value;
}

/** Map a restart policy onto its lowercase spelling; unknown values are returned unchanged. */
export function normalizeRestartPolicy(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const key = value.trim().toLowerCase();
  return RESTART_POLICIES.find((policy) => policy === key) ?? value;
}

/** Go duration as accepted by time.ParseDuration, e.g. `720h` or `1h30m` */
const GO_DURATION_PATTERN = /^[-+]?(0|((\d+(\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h))+)$/;

/** Check that a value is a Go duration (containerlab's certificate validity-duration) */
export function isGoDuration(value: string): boolean {
  return GO_DURATION_PATTERN.test(value.trim());
}

/**
 * Read a healthcheck test command as a list. A plain string (written by older
 * editor versions) becomes a CMD-SHELL test, like Docker does for a string test.
 */
export function normalizeHealthcheckTest(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .filter(
        (entry): entry is string | number | boolean =>
          typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
      )
      .map((entry) => String(entry));
  }
  if (typeof value !== "string") return undefined;
  const command = value.trim();
  if (command === "") return [];
  const [first] = command.split(/\s+/);
  const rest = command.slice(first.length).trim();
  if (first === "NONE") return ["NONE"];
  if (first === "CMD") return ["CMD", ...rest.split(/\s+/).filter((arg) => arg !== "")];
  if (first === "CMD-SHELL") return rest === "" ? ["CMD-SHELL"] : ["CMD-SHELL", rest];
  return ["CMD-SHELL", command];
}

// ============================================================================
// YAML -> NodeEditorData (for loading into editor)
// ============================================================================

/** Parse basic properties from extraData (with fallback to top-level data) */
function parseBasicProps(
  rawData: Record<string, unknown>,
  extra: Record<string, unknown>
): Pick<
  NodeEditorData,
  | "id"
  | "name"
  | "kind"
  | "type"
  | "image"
  | "icon"
  | "iconColor"
  | "iconCornerRadius"
  | "labelPosition"
  | "direction"
  | "labelBackgroundColor"
  | "box"
> {
  return {
    id: getString(rawData.id) ?? "",
    name: getString(rawData.name) ?? getString(rawData.id) ?? "",
    // Check extraData first, then fall back to top-level data (for mock/dev mode)
    kind: getString(extra.kind) ?? getString(rawData.kind),
    type: getString(extra.type) ?? getString(rawData.type),
    image: getString(extra.image) ?? getString(rawData.image),
    // ReactFlow node data uses "role", parsed element format uses "topoViewerRole"
    icon: getString(rawData.role) ?? getString(rawData.topoViewerRole) ?? "",
    iconColor: getString(rawData.iconColor),
    iconCornerRadius: getNumber(rawData.iconCornerRadius),
    labelPosition: getString(rawData.labelPosition) ?? getString(extra.labelPosition),
    direction: getString(rawData.direction) ?? getString(extra.direction),
    labelBackgroundColor:
      getString(rawData.labelBackgroundColor) ?? getString(extra.labelBackgroundColor),
    box: normalizeNodeBoxAppearance(rawData.box) ?? normalizeNodeBoxAppearance(extra.box)
  };
}

/** Parse configuration properties from extraData */
function parseConfigProps(
  extra: Record<string, unknown>
): Pick<
  NodeEditorData,
  | "startupConfig"
  | "enforceStartupConfig"
  | "suppressStartupConfig"
  | "license"
  | "binds"
  | "env"
  | "envFiles"
  | "labels"
> {
  return {
    startupConfig: getString(extra["startup-config"]),
    enforceStartupConfig: getBoolean(extra["enforce-startup-config"]),
    suppressStartupConfig: getBoolean(extra["suppress-startup-config"]),
    license: getString(extra.license),
    binds: getStringArray(extra.binds),
    env: getScalarRecord(extra.env),
    envFiles: getStringArray(extra["env-files"]),
    labels: getScalarRecord(extra.labels)
  };
}

/** Parse runtime properties from extraData */
function parseRuntimeProps(
  extra: Record<string, unknown>
): Pick<
  NodeEditorData,
  "user" | "entrypoint" | "cmd" | "exec" | "restartPolicy" | "autoRemove" | "startupDelay"
> {
  return {
    user: getString(extra.user),
    entrypoint: getString(extra.entrypoint),
    cmd: getString(extra.cmd),
    exec: getStringArray(extra.exec),
    restartPolicy: normalizeRestartPolicy(getString(extra["restart-policy"])),
    autoRemove: getBoolean(extra["auto-remove"]),
    startupDelay: getNumber(extra["startup-delay"])
  };
}

/** Parse the dns map ({servers, search, options}) from extraData */
function parseDnsProps(
  dnsRaw: unknown
): Pick<NodeEditorData, "dnsServers" | "dnsSearch" | "dnsOptions"> {
  // Older editor versions wrote a bare list of servers
  if (Array.isArray(dnsRaw)) return { dnsServers: getStringArray(dnsRaw) };
  const dns = getRecordUnknown(dnsRaw);
  return {
    dnsServers: getStringArray(dns?.servers),
    dnsSearch: getStringArray(dns?.search),
    dnsOptions: getStringArray(dns?.options)
  };
}

/** Parse network properties from extraData */
function parseNetworkProps(
  extra: Record<string, unknown>
): Pick<
  NodeEditorData,
  | "mgmtIpv4"
  | "mgmtIpv6"
  | "networkMode"
  | "ports"
  | "dnsServers"
  | "dnsSearch"
  | "dnsOptions"
  | "aliases"
> {
  return {
    mgmtIpv4: getString(extra["mgmt-ipv4"]),
    mgmtIpv6: getString(extra["mgmt-ipv6"]),
    networkMode: getString(extra["network-mode"]),
    ports: getStringArray(extra.ports),
    ...parseDnsProps(extra.dns),
    aliases: getStringArray(extra.aliases)
  };
}

/** Parse resource/advanced properties from extraData */
function parseAdvancedProps(
  extra: Record<string, unknown>
): Pick<
  NodeEditorData,
  | "cpu"
  | "cpuSet"
  | "memory"
  | "shmSize"
  | "capAdd"
  | "sysctls"
  | "devices"
  | "imagePullPolicy"
  | "runtime"
> {
  return {
    cpu: getNumber(extra.cpu),
    cpuSet: getString(extra["cpu-set"]),
    memory: getString(extra.memory),
    shmSize: getString(extra["shm-size"]),
    capAdd: getStringArray(extra["cap-add"]),
    sysctls: getScalarRecord(extra.sysctls),
    devices: getStringArray(extra.devices),
    imagePullPolicy: normalizeImagePullPolicy(getString(extra["image-pull-policy"])),
    runtime: getString(extra.runtime)
  };
}

/** Read a key size given as a number or a numeric string */
function parseKeySize(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

/** Parse certificate properties from extraData */
function parseCertProps(
  extra: Record<string, unknown>
): Pick<NodeEditorData, "certIssue" | "certKeySize" | "certValidity" | "sans"> {
  const certRaw = getRecordUnknown(extra.certificate);
  if (!certRaw) return {};

  return {
    certIssue: certRaw.issue !== undefined ? Boolean(certRaw.issue) : undefined,
    certKeySize: parseKeySize(certRaw["key-size"]),
    certValidity: getString(certRaw["validity-duration"]),
    // Older editor versions wrote the list as `SANs`
    sans: getStringArray(certRaw.sans ?? certRaw.SANs)
  };
}

/** Parse healthcheck properties from extraData */
function parseHealthCheckProps(extra: Record<string, unknown>): {
  healthCheck?: HealthCheckConfig;
} {
  const healthcheckRaw = getRecordUnknown(extra.healthcheck);
  if (!healthcheckRaw) return {};

  return {
    healthCheck: {
      test: normalizeHealthcheckTest(healthcheckRaw.test),
      startPeriod: getNumber(healthcheckRaw["start-period"]),
      interval: getNumber(healthcheckRaw.interval),
      timeout: getNumber(healthcheckRaw.timeout),
      retries: getNumber(healthcheckRaw.retries)
    }
  };
}

/** Parse MDA items from an array */
function parseMdaItems(arr: unknown[]): { slot?: number; type?: string }[] {
  return arr
    .filter((m): m is Record<string, unknown> => m !== null && typeof m === "object")
    .map((m) => ({
      slot: getNumber(m.slot),
      type: getString(m.type)
    }));
}

/** Component keys the Components tab edits; everything else is kept as it is */
const EDITED_COMPONENT_KEYS = new Set(["slot", "type", "sfm", "mda", "xiom"]);

/** Collect the component keys the editor does not own (env, cpu, ram, max-nics, ...) */
function parseComponentExtra(c: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(c).filter(([key]) => !EDITED_COMPONENT_KEYS.has(key));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Parse a single SROS component */
function parseComponent(c: Record<string, unknown>): SrosComponent {
  const slot = c.slot;
  const component: SrosComponent = {
    slot: typeof slot === "string" || typeof slot === "number" ? slot : undefined,
    type: getString(c.type),
    mda: Array.isArray(c.mda) ? parseMdaItems(c.mda) : undefined,
    xiom: Array.isArray(c.xiom)
      ? c.xiom
          .filter((x): x is Record<string, unknown> => x !== null && typeof x === "object")
          .map((x) => ({
            slot: getNumber(x.slot),
            type: getString(x.type),
            mda: Array.isArray(x.mda) ? parseMdaItems(x.mda) : undefined
          }))
      : undefined
  };
  const extra = parseComponentExtra(c);
  if (extra) component.extra = extra;
  return component;
}

/** Parse SROS components and the node-level SFM from extraData */
function parseComponentsProps(
  extra: Record<string, unknown>
): Pick<NodeEditorData, "components" | "sfm"> {
  const componentsRaw = Array.isArray(extra.components)
    ? extra.components.filter((c): c is Record<string, unknown> => isRecord(c))
    : [];
  // Older editor versions wrote the SFM into every component instead of the node
  const legacySfm = componentsRaw.map((c) => getString(c.sfm)).find((sfm) => sfm !== undefined);
  const sfm = getString(extra.sfm) ?? legacySfm;

  const components = componentsRaw.map(parseComponent);
  return {
    ...(components.length > 0 ? { components } : {}),
    ...(sfm !== undefined ? { sfm } : {})
  };
}

/**
 * Converts raw node data (from the graph/YAML) to NodeEditorData format
 * Maps from YAML kebab-case properties (in extraData) to camelCase NodeEditorData
 */
export function convertToEditorData(
  rawData: Record<string, unknown> | null
): NodeEditorData | null {
  if (!rawData) return null;
  const extra = getRecordUnknown(rawData.extraData) ?? {};

  return {
    ...parseBasicProps(rawData, extra),
    ...parseConfigProps(extra),
    ...parseRuntimeProps(extra),
    ...parseNetworkProps(extra),
    ...parseAdvancedProps(extra),
    ...parseCertProps(extra),
    ...parseHealthCheckProps(extra),
    ...parseComponentsProps(extra)
  };
}

// ============================================================================
// NodeEditorData -> YAML extraData (for saving to YAML)
// ============================================================================

/** YAML extraData type matching TopologyIO */
export interface YamlExtraData {
  kind?: string;
  type?: string | null;
  image?: string | null;
  group?: string | null;
  "startup-config"?: string | null;
  "enforce-startup-config"?: boolean | null;
  "suppress-startup-config"?: boolean | null;
  license?: string | null;
  binds?: string[] | null;
  env?: Record<string, unknown> | null;
  "env-files"?: string[] | null;
  labels?: Record<string, unknown> | null;
  user?: string | null;
  entrypoint?: string | null;
  cmd?: string | null;
  exec?: string[] | null;
  "restart-policy"?: string | null;
  "auto-remove"?: boolean | null;
  "startup-delay"?: number | null;
  "mgmt-ipv4"?: string | null;
  "mgmt-ipv6"?: string | null;
  "network-mode"?: string | null;
  ports?: string[] | null;
  dns?: Record<string, string[]> | null;
  aliases?: string[] | null;
  cpu?: number | null;
  "cpu-set"?: string | null;
  memory?: string | null;
  "shm-size"?: string | null;
  "cap-add"?: string[] | null;
  sysctls?: Record<string, unknown> | null;
  devices?: string[] | null;
  certificate?: Record<string, unknown> | null;
  healthcheck?: Record<string, unknown> | null;
  "image-pull-policy"?: string | null;
  runtime?: string | null;
  components?: unknown[] | null;
  sfm?: string | null;
  [key: string]: unknown;
}

/** Options for converting editor data to YAML */
export interface EditorYamlOptions {
  /**
   * Write explicit `false` and `0` values instead of dropping them. Used when
   * saving an existing node, where such a value overrides an inherited default.
   */
  keepExplicitDefaults?: boolean;
}

// ============================================================================
// Helper functions for clearable field conversion
// These helpers reduce cognitive complexity by encapsulating the null-or-value pattern
// ============================================================================

/** Convert a string field: returns value if truthy, null if empty (for deletion) */
function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    return value === "" ? null : value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

/** Convert a list field: drops blank rows, returns null if nothing is left (for deletion) */
function toListOrNull(value: unknown): string[] | null {
  const list = getStringArray(value)?.filter((entry) => entry.trim() !== "") ?? [];
  return list.length > 0 ? list : null;
}

/** Keep only scalar values and drop rows without a key */
function cleanScalarRecord(obj: Record<string, unknown>): Record<string, NodeScalarValue> {
  const result: Record<string, NodeScalarValue> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.trim() === "") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}

/** Convert a record field: returns value if non-empty, null if empty (for deletion) */
function toRecordOrNull(obj: Record<string, unknown>): Record<string, unknown> | null {
  const cleaned = cleanScalarRecord(obj);
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

/**
 * Convert a boolean field. `true` is always written. `false` is written only
 * with keepExplicitDefaults, otherwise it is dropped (null) because most
 * containerlab booleans default to false.
 */
function toBooleanOrNull(value: unknown, options: EditorYamlOptions): boolean | null {
  if (value === true) return true;
  if (value === false && options.keepExplicitDefaults === true) return false;
  return null;
}

/**
 * Convert a number field. Empty strings, NaN and undefined result in null
 * (deletion). 0 is kept only with keepExplicitDefaults.
 */
function toNumberOrNull(value: unknown, options: EditorYamlOptions): number | null {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (isNaN(num)) return null;
  if (num === 0 && options.keepExplicitDefaults !== true) return null;
  return num;
}

/** Convert basic properties to YAML format */
function convertBasicToYaml(data: Record<string, unknown>, extraData: YamlExtraData): void {
  const kind = toStringOrNull(data.kind);
  if (kind !== null) extraData.kind = kind;
  // String fields: set value if non-empty, null if empty string (to trigger deletion)
  // Use 'in' check to detect when user explicitly cleared the field (set to undefined)
  if ("type" in data) extraData.type = toStringOrNull(data.type);
  if ("image" in data) extraData.image = toStringOrNull(data.image);
  if ("group" in data) extraData.group = toStringOrNull(data.group);
}

/** Convert startup config properties to YAML format */
function convertStartupConfigToYaml(
  data: Record<string, unknown>,
  extraData: YamlExtraData,
  options: EditorYamlOptions
): void {
  if ("startupConfig" in data) extraData["startup-config"] = toStringOrNull(data.startupConfig);
  if ("enforceStartupConfig" in data) {
    extraData["enforce-startup-config"] = toBooleanOrNull(data.enforceStartupConfig, options);
  }
  if ("suppressStartupConfig" in data) {
    extraData["suppress-startup-config"] = toBooleanOrNull(data.suppressStartupConfig, options);
  }
  if ("license" in data) extraData.license = toStringOrNull(data.license);
}

/** Convert container config properties to YAML format */
function convertContainerConfigToYaml(
  data: Record<string, unknown>,
  extraData: YamlExtraData
): void {
  if (getStringArray(data.binds) !== undefined) extraData.binds = toListOrNull(data.binds);
  const env = getRecordUnknown(data.env);
  if (env !== undefined) {
    extraData.env = toRecordOrNull(env);
  }
  if (getStringArray(data.envFiles) !== undefined) {
    extraData["env-files"] = toListOrNull(data.envFiles);
  }
  const labels = getRecordUnknown(data.labels);
  if (labels !== undefined) {
    extraData.labels = toRecordOrNull(labels);
  }
}

/** Convert configuration properties to YAML format */
function convertConfigToYaml(
  data: Record<string, unknown>,
  extraData: YamlExtraData,
  options: EditorYamlOptions
): void {
  convertStartupConfigToYaml(data, extraData, options);
  convertContainerConfigToYaml(data, extraData);
}

/** Convert runtime properties to YAML format */
function convertRuntimeToYaml(
  data: Record<string, unknown>,
  extraData: YamlExtraData,
  options: EditorYamlOptions
): void {
  if ("user" in data) extraData.user = toStringOrNull(data.user);
  if ("entrypoint" in data) extraData.entrypoint = toStringOrNull(data.entrypoint);
  if ("cmd" in data) extraData.cmd = toStringOrNull(data.cmd);
  if (getStringArray(data.exec) !== undefined) extraData.exec = toListOrNull(data.exec);
  if ("restartPolicy" in data) extraData["restart-policy"] = toStringOrNull(data.restartPolicy);
  if ("autoRemove" in data) {
    extraData["auto-remove"] = toBooleanOrNull(data.autoRemove, options);
  }
  // Use 'in' check to detect when user explicitly cleared the field (set to undefined)
  if ("startupDelay" in data) {
    extraData["startup-delay"] = toNumberOrNull(data.startupDelay, options);
  }
}

/** Convert the DNS servers, search domains and options to the YAML dns map */
function convertDnsToYaml(data: Record<string, unknown>, extraData: YamlExtraData): void {
  if (
    data.dnsServers === undefined &&
    data.dnsSearch === undefined &&
    data.dnsOptions === undefined
  )
    return;

  const dns: Record<string, string[]> = {};
  const servers = toListOrNull(data.dnsServers);
  if (servers !== null) dns.servers = servers;
  const search = toListOrNull(data.dnsSearch);
  if (search !== null) dns.search = search;
  const dnsOptions = toListOrNull(data.dnsOptions);
  if (dnsOptions !== null) dns.options = dnsOptions;

  extraData.dns = Object.keys(dns).length > 0 ? dns : null;
}

/** Convert network properties to YAML format */
function convertNetworkToYaml(data: Record<string, unknown>, extraData: YamlExtraData): void {
  if ("mgmtIpv4" in data) extraData["mgmt-ipv4"] = toStringOrNull(data.mgmtIpv4);
  if ("mgmtIpv6" in data) extraData["mgmt-ipv6"] = toStringOrNull(data.mgmtIpv6);
  if ("networkMode" in data) extraData["network-mode"] = toStringOrNull(data.networkMode);
  if (getStringArray(data.ports) !== undefined) extraData.ports = toListOrNull(data.ports);
  convertDnsToYaml(data, extraData);
  if (getStringArray(data.aliases) !== undefined) extraData.aliases = toListOrNull(data.aliases);
}

/** Convert resource limit properties to YAML format */
function convertResourceLimitsToYaml(
  data: Record<string, unknown>,
  extraData: YamlExtraData,
  options: EditorYamlOptions
): void {
  if ("cpu" in data) {
    extraData.cpu = toNumberOrNull(data.cpu, options);
  }
  if ("cpuSet" in data) extraData["cpu-set"] = toStringOrNull(data.cpuSet);
  if ("memory" in data) extraData.memory = toStringOrNull(data.memory);
  if ("shmSize" in data) extraData["shm-size"] = toStringOrNull(data.shmSize);
}

/** Convert container capabilities and sysctls to YAML format */
function convertCapabilitiesToYaml(data: Record<string, unknown>, extraData: YamlExtraData): void {
  if (getStringArray(data.capAdd) !== undefined) extraData["cap-add"] = toListOrNull(data.capAdd);
  const sysctls = getRecordUnknown(data.sysctls);
  if (sysctls !== undefined) {
    extraData.sysctls = toRecordOrNull(sysctls);
  }
  if (getStringArray(data.devices) !== undefined) extraData.devices = toListOrNull(data.devices);
}

/** Convert advanced/resource properties to YAML format */
function convertAdvancedToYaml(
  data: Record<string, unknown>,
  extraData: YamlExtraData,
  options: EditorYamlOptions
): void {
  convertResourceLimitsToYaml(data, extraData, options);
  convertCapabilitiesToYaml(data, extraData);
  if ("imagePullPolicy" in data)
    extraData["image-pull-policy"] = toStringOrNull(data.imagePullPolicy);
  if ("runtime" in data) extraData.runtime = toStringOrNull(data.runtime);
}

/** Convert certificate properties to YAML format */
function convertCertToYaml(
  data: Record<string, unknown>,
  extraData: YamlExtraData,
  options: EditorYamlOptions
): void {
  // Check if ANY certificate field is defined (even if empty - we need to know if user touched them)
  const hasCertFields =
    data.certIssue !== undefined ||
    data.certKeySize !== undefined ||
    data.certValidity !== undefined ||
    data.sans !== undefined;
  if (!hasCertFields) return;

  const cert: Record<string, unknown> = {};
  const issue = toBooleanOrNull(data.certIssue, options);
  if (issue !== null) cert.issue = issue;
  // containerlab reads key-size as an integer
  const keySize = toNumberOrNull(data.certKeySize, {});
  if (keySize !== null && keySize > 0) cert["key-size"] = keySize;
  const validity = toStringOrNull(data.certValidity)?.trim();
  if (validity !== undefined && validity !== "") cert["validity-duration"] = validity;
  const sans = toListOrNull(data.sans);
  if (sans !== null) cert.sans = sans;

  // If all fields are empty, signal deletion; otherwise set the certificate object
  if (Object.keys(cert).length > 0) {
    extraData.certificate = cert;
  } else {
    // All certificate fields were cleared - delete the certificate
    extraData.certificate = null;
  }
}

/** Convert healthcheck properties to YAML format */
function convertHealthcheckToYaml(
  data: Record<string, unknown>,
  extraData: YamlExtraData,
  options: EditorYamlOptions
): void {
  const hc = getRecordUnknown(data.healthCheck);
  if (hc === undefined) return;

  const healthcheck: Record<string, unknown> = {};
  // containerlab reads the test as a list, e.g. [CMD-SHELL, "cat /etc/os-release"]
  const test = toListOrNull(normalizeHealthcheckTest(hc.test));
  if (test !== null) healthcheck.test = test;
  const startPeriod = toNumberOrNull(hc.startPeriod, options);
  if (startPeriod !== null) healthcheck["start-period"] = startPeriod;
  const interval = toNumberOrNull(hc.interval, options);
  if (interval !== null) healthcheck.interval = interval;
  const timeout = toNumberOrNull(hc.timeout, options);
  if (timeout !== null) healthcheck.timeout = timeout;
  const retries = toNumberOrNull(hc.retries, options);
  if (retries !== null) healthcheck.retries = retries;

  // If all fields are empty, signal deletion; otherwise set the healthcheck object
  if (Object.keys(healthcheck).length > 0) {
    extraData.healthcheck = healthcheck;
  } else {
    // All healthcheck fields were cleared - delete the healthcheck
    extraData.healthcheck = null;
  }
}

/** Check if a component object has any meaningful properties */
function isNonEmptyComponent(comp: Record<string, unknown>): boolean {
  return Object.keys(comp).length > 0;
}

/** Convert MDA array to YAML format */
function convertMdaArray(
  mdaList: Array<{ slot?: string | number; type?: string }>
): Array<Record<string, unknown>> {
  return mdaList
    .map((m) => {
      const mda: Record<string, unknown> = {};
      if (m.slot !== undefined) mda.slot = m.slot;
      if (m.type !== undefined && m.type !== "") mda.type = m.type;
      return mda;
    })
    .filter(isNonEmptyComponent);
}

/** Convert a single SROS component to YAML format, returns null if empty */
function convertSingleComponent(c: SrosComponent): Record<string, unknown> | null {
  // Keys the editor does not show (env, cpu, ...) are written back unchanged
  const comp: Record<string, unknown> = { ...c.extra };

  if (c.slot !== undefined && c.slot !== "") comp.slot = c.slot;
  if (c.type !== undefined && c.type !== "") comp.type = c.type;

  if (c.mda && c.mda.length > 0) {
    const mdaList = convertMdaArray(c.mda);
    if (mdaList.length > 0) comp.mda = mdaList;
  }

  if (c.xiom && c.xiom.length > 0) {
    const xiomList = c.xiom
      .map((x) => {
        const xiom: Record<string, unknown> = {};
        if (x.slot !== undefined) xiom.slot = x.slot;
        if (x.type !== undefined && x.type !== "") xiom.type = x.type;
        if (x.mda && x.mda.length > 0) {
          const xMdaList = convertMdaArray(x.mda);
          if (xMdaList.length > 0) xiom.mda = xMdaList;
        }
        return xiom;
      })
      .filter(isNonEmptyComponent);
    if (xiomList.length > 0) comp.xiom = xiomList;
  }

  return isNonEmptyComponent(comp) ? comp : null;
}

/**
 * Convert components to YAML format. Components are kind-specific
 * (nokia_srsim, nokia_sros, nokia_srlinux) and are written for every kind.
 */
function convertComponentsToYaml(data: Record<string, unknown>, extraData: YamlExtraData): void {
  if ("sfm" in data) extraData.sfm = toStringOrNull(data.sfm);

  if (!Array.isArray(data.components)) return;
  const components = data.components.filter(
    (entry): entry is SrosComponent => entry !== null && typeof entry === "object"
  );

  // Convert components, filtering out empty ones; nothing left signals deletion
  const converted = components
    .map(convertSingleComponent)
    .filter((c): c is Record<string, unknown> => c !== null);
  extraData.components = converted.length > 0 ? converted : null;
}

/**
 * Convert NodeEditorData (camelCase) to extraData format (kebab-case) for YAML
 */
export function convertEditorDataToYaml(
  data: Record<string, unknown>,
  options: EditorYamlOptions = {}
): YamlExtraData {
  const extraData: YamlExtraData = {};

  convertBasicToYaml(data, extraData);
  convertConfigToYaml(data, extraData, options);
  convertRuntimeToYaml(data, extraData, options);
  convertNetworkToYaml(data, extraData);
  convertAdvancedToYaml(data, extraData, options);
  convertCertToYaml(data, extraData, options);
  convertHealthcheckToYaml(data, extraData, options);
  convertComponentsToYaml(data, extraData);

  return extraData;
}

// ============================================================================
// Edited node -> changed YAML keys
// ============================================================================

const SAVE_YAML_OPTIONS: EditorYamlOptions = { keepExplicitDefaults: true };

/** Checkbox fields that can hold an explicit `false` */
const BOOLEAN_FIELDS = [
  "enforceStartupConfig",
  "suppressStartupConfig",
  "autoRemove",
  "certIssue"
] as const;

/** Key/value fields whose values keep their YAML type */
const SCALAR_RECORD_FIELDS = ["env", "labels", "sysctls"] as const;

const NUMBER_TEXT_PATTERN = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;

/**
 * Give an edited key/value entry its original type back while the text still
 * reads as that type, so `ip_forward: 1` stays a number when edited to `0`.
 */
function restoreScalarType(value: NodeScalarValue, original: unknown): NodeScalarValue {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (typeof original === "number" && NUMBER_TEXT_PATTERN.test(text)) return Number(text);
  if (typeof original === "boolean" && (text === "true" || text === "false")) {
    return text === "true";
  }
  return value;
}

function restoreScalarRecord(
  current: Record<string, NodeScalarValue> | undefined,
  baseline: Record<string, NodeScalarValue> | undefined
): Record<string, NodeScalarValue> | undefined {
  if (!current || !baseline) return current;
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => [key, restoreScalarType(value, baseline[key])])
  );
}

/**
 * Align the edited data with what was loaded where the form cannot tell the
 * difference: an unchecked box that was not checked before stays unset (so no
 * `false` appears), and edited key/value entries keep their original type.
 */
function settleAgainstBaseline(data: NodeEditorData, baseline: NodeEditorData): NodeEditorData {
  const settled: NodeEditorData = { ...data };
  for (const field of BOOLEAN_FIELDS) {
    if (settled[field] === false && baseline[field] !== true) {
      settled[field] = baseline[field];
    }
  }
  for (const field of SCALAR_RECORD_FIELDS) {
    settled[field] = restoreScalarRecord(settled[field], baseline[field]);
  }
  return settled;
}

/**
 * Convert edited node data to the YAML keys that changed against the data the
 * editor was opened with. Unchanged keys are left out so the node YAML keeps
 * them as written (including comments, kind-specific keys and values the
 * editor only shows). A key the user cleared is set to null (deletion).
 */
export function convertEditorChangesToYaml(
  data: NodeEditorData,
  baseline: NodeEditorData
): YamlExtraData {
  const before = convertEditorDataToYaml({ ...baseline }, SAVE_YAML_OPTIONS);
  const after = convertEditorDataToYaml(
    { ...settleAgainstBaseline(data, baseline) },
    SAVE_YAML_OPTIONS
  );

  const changed: YamlExtraData = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const previous = before[key] ?? null;
    const next = after[key] ?? null;
    if (!deepEqual(previous, next)) {
      changed[key] = next;
    }
  }
  return changed;
}

// ============================================================================
// NodeEditorData -> NodeSaveData (for TopologyIO service)
// ============================================================================

function mapDefaultToNull(
  value: string | undefined,
  defaultValue: string
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value === defaultValue ? null : value;
}

function normalizeLabelBackgroundColor(value: string | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    return null;
  }

  const normalizedValue = trimmedValue.replace(/\s+/g, "").toLowerCase();
  if (normalizedValue === "rgba(0,0,0,0.7)") {
    return null;
  }

  return trimmedValue;
}

/**
 * Convert NodeEditorData to NodeSaveData format for TopologyIO.
 * This is used when saving node editor changes via the services.
 *
 * @param data - NodeEditorData from the editor panel
 * @param oldName - Optional original name if node is being renamed
 * @param baseline - Data the editor was opened with; when given, only the YAML
 *   keys that changed are saved and everything else in the node is left alone
 * @returns NodeSaveData for TopologyIO.editNode()
 */
export function convertEditorDataToNodeSaveData(
  data: NodeEditorData,
  oldName?: string,
  baseline?: NodeEditorData | null
): NodeSaveData {
  const yamlExtraData = baseline
    ? convertEditorChangesToYaml(data, baseline)
    : convertEditorDataToYaml({ ...data }, SAVE_YAML_OPTIONS);
  const labelPosition = mapDefaultToNull(data.labelPosition, "bottom");
  const direction = mapDefaultToNull(data.direction, "right");
  const labelBackgroundColor = normalizeLabelBackgroundColor(data.labelBackgroundColor);

  // Build the extraData with annotation props.
  const extraData: NodeSaveData["extraData"] = {
    ...yamlExtraData,
    // Annotation properties (saved to annotations.json, not YAML)
    topoViewerRole: data.icon,
    iconColor: data.iconColor ?? null,
    iconCornerRadius: data.iconCornerRadius,
    interfacePattern: data.interfacePattern,
    labelPosition,
    direction,
    labelBackgroundColor,
    box: normalizeNodeBoxAppearance(data.box) ?? null
  };

  const saveData: NodeSaveData = {
    id: data.id,
    name: data.name,
    extraData
  };

  // If renaming, include the old name so TopologyIO can find and rename the node
  if (oldName !== undefined && oldName !== "" && oldName !== data.name) {
    (saveData as NodeSaveData & { oldName?: string }).oldName = oldName;
  }

  return saveData;
}
