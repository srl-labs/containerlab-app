/**
 * Kind-specific config keys of a node in the editor (`custom-prompt`,
 * `daemons`, `breakouts`, ...). The editor keeps them by their YAML key in
 * `kindConfig`; SR OS `components` and `sfm` have their own editor fields.
 */
import { kindSpecificConfig } from "../schema/bundledSchema";
import type { KindConfigField } from "../schema/KindSpecificConfig";

import { isRecord } from "./typeHelpers";

/** Kind-specific keys with their own NodeEditorData field */
const EDITOR_FIELD_KEYS = new Set(["components", "sfm"]);

/** Kind-specific keys the editor keeps in `kindConfig`, in schema order */
export const KIND_CONFIG_KEYS: readonly string[] = kindSpecificConfig.keys.filter(
  (key) => !EDITOR_FIELD_KEYS.has(key)
);

/** Every kind-specific YAML key, including `components` and `sfm` */
export const KIND_SPECIFIC_KEYS: ReadonlySet<string> = new Set(kindSpecificConfig.keys);

/** Kinds whose components follow the SR OS card / MDA / XIOM layout of the Components tab */
const SROS_COMPONENT_KINDS = new Set(["nokia_srsim", "nokia_sros"]);

export function hasSrosComponents(kind: string | undefined): boolean {
  return kind !== undefined && SROS_COMPONENT_KINDS.has(kind.trim().toLowerCase());
}

/** The kind-specific keys of a node's YAML, by key */
export function parseKindConfig(extra: Record<string, unknown>): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {};
  for (const key of KIND_CONFIG_KEYS) {
    if (extra[key] !== undefined && extra[key] !== null) config[key] = extra[key];
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

function cleanItem(item: unknown): unknown {
  if (typeof item === "string") {
    const text = item.trim();
    return text === "" ? undefined : text;
  }
  if (typeof item === "number") return Number.isFinite(item) ? item : undefined;
  if (isRecord(item)) {
    const entries = Object.entries(item).filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    );
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  return item ?? undefined;
}

/**
 * A kind-specific value as YAML should hold it: text trimmed, blank list rows
 * dropped, and null when nothing is left (the key is removed). `false` stays,
 * since several kind-specific flags default to true.
 */
export function cleanKindConfigValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    const items = value.map(cleanItem).filter((item) => item !== undefined);
    return items.length > 0 ? items : null;
  }
  return cleanItem(value) ?? null;
}

/** The YAML keys to write for `kindConfig`; keys without a value are null (removed). */
export function serializeKindConfig(kindConfig: unknown): Record<string, unknown> {
  const config = isRecord(kindConfig) ? kindConfig : {};
  const result: Record<string, unknown> = {};
  for (const key of KIND_CONFIG_KEYS) result[key] = cleanKindConfigValue(config[key]);
  return result;
}

/**
 * Drop the keys a kind does not accept, e.g. after the kind changed;
 * containerlab refuses to deploy a node with them.
 */
export function pruneKindConfig(
  kindConfig: Record<string, unknown> | undefined,
  kind: string | undefined
): Record<string, unknown> | undefined {
  if (!kindConfig || kind === undefined || kind === "") return kindConfig;
  const kept = Object.entries(kindConfig).filter(([key]) => kindSpecificConfig.accepts(kind, key));
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/**
 * Fields of the Kind tab. Without a kind (topology defaults or a group without
 * one) every key any kind accepts is offered, like containerlab allows there.
 * SR OS components and SFM are left to the Components tab.
 */
export function kindConfigFormFields(kind: string | undefined): KindConfigField[] {
  const fields =
    kind === undefined || kind === ""
      ? kindSpecificConfig.allFields()
      : kindSpecificConfig.fieldsForKind(kind);
  const sros = hasSrosComponents(kind);
  return fields.filter(
    (field) => field.control !== undefined && !(sros && EDITOR_FIELD_KEYS.has(field.key))
  );
}

/** Kinds a key belongs to, e.g. "nokia_srsim, nokia_sros" */
export function kindsAcceptingKey(key: string): string {
  return kindSpecificConfig.kindsAccepting(key).join(", ");
}

/** Component keys (cpu, ram, max-nics, env, ...) the kind accepts */
export function kindComponentKeys(kind: string | undefined): ReadonlySet<string> {
  return kind === undefined ? new Set() : kindSpecificConfig.componentKeys(kind);
}
