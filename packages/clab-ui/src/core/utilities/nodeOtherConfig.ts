/**
 * Node keys without a hand-built form (hostname, privileged, volumes, tmpfs,
 * config.vars, ...). The editor keeps them by YAML key in `otherConfig` and
 * the Other tab builds their fields from the schema.
 */
import * as YAML from "yaml";

import { containerlabSchema, kindSpecificConfig } from "../schema/bundledSchema";
import { parseNodeConfigFields, type NodeConfigField } from "../schema/NodeConfigFields";

import { isRecord } from "./typeHelpers";

/** Node keys the editor tabs edit with forms of their own, in the order a new node writes them */
export const NODE_FORM_KEYS = [
  "kind",
  "type",
  "image",
  "group",
  "startup-config",
  "enforce-startup-config",
  "suppress-startup-config",
  "license",
  "binds",
  "env",
  "env-files",
  "labels",
  "user",
  "entrypoint",
  "cmd",
  "exec",
  "restart-policy",
  "auto-remove",
  "startup-delay",
  "mgmt-ipv4",
  "mgmt-ipv6",
  "mgmt-net",
  "network-mode",
  "ports",
  "dns",
  "aliases",
  "memory",
  "cpu",
  "cpu-set",
  "shm-size",
  "cap-add",
  "sysctls",
  "devices",
  "certificate",
  "healthcheck",
  "image-pull-policy",
  "runtime",
  "components",
  "sfm",
  "stages",
  "credentials"
] as const;

/** Fields of the Other tab, in schema order */
export const OTHER_CONFIG_FIELDS: readonly NodeConfigField[] = parseNodeConfigFields(
  containerlabSchema,
  new Set<string>([...NODE_FORM_KEYS, ...kindSpecificConfig.keys])
);

/** YAML keys the editor keeps in `otherConfig` */
export const OTHER_CONFIG_KEYS: readonly string[] = [
  ...new Set(OTHER_CONFIG_FIELDS.map((field) => field.path[0]))
];

/** The value at a path below the node, e.g. `["config", "vars"]` */
export function readConfigPath(
  config: Record<string, unknown> | undefined,
  path: readonly string[]
): unknown {
  let value: unknown = config;
  for (const key of path) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return value;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Object.keys(value).length === 0;
}

/**
 * A copy of `config` with the value at `path` replaced; an empty value removes
 * the key, and maps left empty on the way are removed too.
 */
export function writeConfigPath(
  config: Record<string, unknown> | undefined,
  path: readonly string[],
  value: unknown
): Record<string, unknown> | undefined {
  const [key, ...rest] = path;
  const next = { ...config };
  const child = rest.length > 0 ? writeConfigPath(getRecord(next[key]), rest, value) : value;
  if (isEmpty(child)) delete next[key];
  else next[key] = child;
  return Object.keys(next).length > 0 ? next : undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** The Other tab keys of a node's YAML, by key */
export function parseOtherConfig(
  extra: Record<string, unknown>
): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {};
  for (const key of OTHER_CONFIG_KEYS) {
    if (extra[key] !== undefined && extra[key] !== null) config[key] = extra[key];
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

function cleanText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  return text === "" ? undefined : text;
}

/** A field value as YAML should hold it: text trimmed, blank rows and keys dropped */
function cleanFieldValue(field: NodeConfigField, value: unknown): unknown {
  const { control } = field;
  if (control.type === "stringList" && Array.isArray(value)) {
    const items = value.map(cleanText).filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (control.type === "map" && isRecord(value)) {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key.trim(), control.values === "text" ? cleanText(entry) ?? "" : entry])
      .filter(([key]) => key !== "");
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  return cleanText(value);
}

/**
 * The YAML keys to write for `otherConfig`; keys without a value are null
 * (removed). Parts of a key no field covers are written back unchanged.
 */
export function serializeOtherConfig(otherConfig: unknown): Record<string, unknown> {
  let config = isRecord(otherConfig) ? otherConfig : undefined;
  for (const field of OTHER_CONFIG_FIELDS) {
    const value = readConfigPath(config, field.path);
    if (value !== undefined) {
      config = writeConfigPath(config, field.path, cleanFieldValue(field, value));
    }
  }
  const result: Record<string, unknown> = {};
  for (const key of OTHER_CONFIG_KEYS) {
    const value = config?.[key];
    result[key] = isEmpty(value) ? null : value;
  }
  return result;
}

const YAML_TEXT_OPTIONS = {
  collectionStyle: "flow",
  flowCollectionPadding: false,
  lineWidth: 0
} as const;

/** A YAML value as one line of text: `65001`, `[2, 4]`, `"65001"` for a string */
export function formatYamlValue(value: unknown): string {
  if (value === undefined) return "";
  const text = YAML.stringify(value, YAML_TEXT_OPTIONS).trim();
  // Multi-line strings; JSON is YAML too and keeps them on one line
  return text.includes("\n") ? JSON.stringify(value) : text;
}

/** Text typed for a YAML value; text that is not valid YAML stays a string */
export function parseYamlValue(text: string): unknown {
  if (text.trim() === "") return "";
  try {
    return YAML.parse(text) as unknown;
  } catch {
    return text;
  }
}
