/**
 * Node configuration resolver for Containerlab inheritance.
 * Pure functions - no VS Code dependencies.
 *
 * Follows containerlab's rules (types/topology.go): a node inherits from its
 * group, then its kind, then the topology defaults. Most keys take the value of
 * the most specific level that sets them; maps and lists are merged across all
 * levels, and a few keys are never inherited.
 */

import type { ClabTopology, ClabNode } from "../types/topology";
import { isRecord } from "../utilities/typeHelpers";

/** Node data key with the level each inherited value comes from. */
export const INHERITED_FROM_KEY = "inheritedFrom";

export type InheritanceLevel = "defaults" | "kind" | "group";

/** One level a node inherits from, with the name of the kind or group. */
export interface InheritanceLayer {
  level: InheritanceLevel;
  /** Kind or group name; absent for defaults */
  name?: string;
  config: ClabNode;
}

/** Maps merged key by key; a more specific level wins per key. */
const MERGED_MAP_KEYS = new Set(["env", "labels", "sysctls", "tmpfs"]);

/** Lists joined across levels without duplicates. */
const MERGED_LIST_KEYS = new Set(["env-files", "devices", "cap-add", "exec", "security-opts"]);

/** Mount lists merged by destination path; a more specific level wins per path. */
const MOUNT_LIST_KEYS = new Set(["binds", "volumes"]);

/** Keys containerlab reads from the node only. */
const NODE_ONLY_KEYS = new Set(["mgmt-ipv4", "mgmt-ipv6", "aliases"]);

/** Numeric keys where 0 means "not set", so a less specific value still applies. */
const ZERO_IS_UNSET_KEYS = new Set(["cpu", "startup-delay"]);

/**
 * Flags containerlab reads through a pointer: `false` counts as set, and a node
 * written without a definition (`node1:`) takes them from the defaults only.
 */
const FLAG_KEYS = new Set([
  "privileged",
  "enforce-startup-config",
  "suppress-startup-config",
  "auto-remove"
]);

/** How the node is written in the topology. */
export interface ResolveNodeOptions {
  /**
   * The node has no definition (`node1:` without a body). containerlab then
   * reads flags from the defaults only and gives it no `config`.
   */
  emptyDefinition?: boolean;
}

/** Whether a node can inherit `key` from defaults, kinds or groups. */
function isInheritableKey(key: string): boolean {
  return !NODE_ONLY_KEYS.has(key);
}

function isSet(key: string, value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value === 0 && ZERO_IS_UNSET_KEYS.has(key)) return false;
  return true;
}

/** Looks up a kind; exact match first, then case-insensitive (sorted, like containerlab). */
export function findKindConfig(
  kinds: Record<string, ClabNode> | undefined,
  kind: string | undefined
): { name: string; config: ClabNode } | undefined {
  if (!kinds || kind === undefined || kind === "") return undefined;
  const exact = kinds[kind];
  if (isRecord(exact)) return { name: kind, config: exact };
  const lower = kind.toLowerCase();
  const name = Object.keys(kinds)
    .sort()
    .find((key) => key.toLowerCase() === lower);
  const config = name !== undefined ? kinds[name] : undefined;
  return name !== undefined && isRecord(config) ? { name, config } : undefined;
}

function findGroupConfig(
  groups: Record<string, ClabNode> | undefined,
  group: string | undefined
): ClabNode | undefined {
  if (!groups || group === undefined || group === "") return undefined;
  const config = groups[group];
  return isRecord(config) ? config : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The kind of a node: its own, else its group's, else the default group's,
 * else the default kind.
 */
export function resolveNodeKindName(parsed: ClabTopology, node: ClabNode): string | undefined {
  const { defaults = {}, groups } = parsed.topology ?? {};
  return (
    nonEmptyString(node.kind) ??
    nonEmptyString(findGroupConfig(groups, nonEmptyString(node.group))?.kind) ??
    nonEmptyString(findGroupConfig(groups, nonEmptyString(defaults.group))?.kind) ??
    nonEmptyString(defaults.kind)
  );
}

/** The group of a node: its own, else its kind's, else the default group. */
export function resolveNodeGroupName(parsed: ClabTopology, node: ClabNode): string | undefined {
  const { defaults = {}, kinds } = parsed.topology ?? {};
  return (
    nonEmptyString(node.group) ??
    nonEmptyString(findKindConfig(kinds, resolveNodeKindName(parsed, node))?.config.group) ??
    nonEmptyString(defaults.group)
  );
}

/** The levels a node inherits from, least specific first: defaults, kind, group. */
export function getInheritanceLayers(parsed: ClabTopology, node: ClabNode): InheritanceLayer[] {
  const { defaults, kinds, groups } = parsed.topology ?? {};
  const layers: InheritanceLayer[] = [];
  if (isRecord(defaults)) layers.push({ level: "defaults", config: defaults });
  const kind = findKindConfig(kinds, resolveNodeKindName(parsed, node));
  if (kind) layers.push({ level: "kind", name: kind.name, config: kind.config });
  const groupName = resolveNodeGroupName(parsed, node);
  const group = findGroupConfig(groups, groupName);
  if (group) layers.push({ level: "group", name: groupName, config: group });
  return layers;
}

/**
 * The blocks merged into one key: a node without a definition takes flags
 * from the defaults only and has no `config` at all.
 */
function blocksForKey(
  key: string,
  layers: InheritanceLayer[],
  options: ResolveNodeOptions
): InheritanceLayer[] {
  if (options.emptyDefinition !== true) return layers;
  if (key === "config") return [];
  if (FLAG_KEYS.has(key)) return layers.filter((layer) => layer.level === "defaults");
  return layers;
}

/** Destination path of a bind (`src:dst[:opts]`) or volume (`name:dst[:opts]`). */
export function getMountDestination(entry: string): string {
  const parts = entry.split(":");
  return parts.length > 1 ? parts[1] : parts[0];
}

function mergeMaps(values: unknown[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const value of values) {
    if (isRecord(value)) Object.assign(merged, value);
  }
  return merged;
}

function mergeLists(values: unknown[]): unknown[] {
  const merged: unknown[] = [];
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!merged.includes(item)) merged.push(item);
    }
  }
  return merged;
}

/** Mounts by destination; a later (more specific) entry replaces an earlier one in place. */
function mergeMounts(values: unknown[]): unknown[] {
  const merged: unknown[] = [];
  const indexByDestination = new Map<string, number>();
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item !== "string") continue;
      const destination = getMountDestination(item);
      const index = indexByDestination.get(destination);
      if (index === undefined) {
        indexByDestination.set(destination, merged.length);
        merged.push(item);
      } else {
        merged[index] = item;
      }
    }
  }
  return merged;
}

/** Deep merge used for `config.vars`. */
function mergeDeep(values: unknown[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const value of values) {
    if (!isRecord(value)) continue;
    for (const [key, entry] of Object.entries(value)) {
      const previous = merged[key];
      merged[key] = isRecord(previous) && isRecord(entry) ? mergeDeep([previous, entry]) : entry;
    }
  }
  return merged;
}

/** Certificate fields are merged one by one, like CertificateConfig.Merge. */
function mergeCertificates(values: unknown[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const value of values) {
    if (!isRecord(value)) continue;
    for (const [key, entry] of Object.entries(value)) {
      if (isSet(key, entry) && entry !== 0) merged[key] = entry;
    }
  }
  return merged;
}

/**
 * Stages add up across levels, like Stages.Merge: each level appends its
 * wait-for entries (skipping one already waited for) and exec commands.
 */
function mergeStages(values: unknown[]): Record<string, unknown> {
  const merged: Record<string, { "wait-for"?: unknown[]; exec?: unknown[] }> = {};
  for (const value of values) {
    if (!isRecord(value)) continue;
    for (const [name, stage] of Object.entries(value)) {
      if (!isRecord(stage)) continue;
      const target = (merged[name] ??= {});
      const waitFor = Array.isArray(stage["wait-for"]) ? stage["wait-for"] : [];
      for (const entry of waitFor) {
        const known = target["wait-for"]?.some((existing) => isSameWaitFor(existing, entry));
        if (known !== true) (target["wait-for"] ??= []).push(entry);
      }
      if (Array.isArray(stage.exec) && stage.exec.length > 0) {
        target.exec = [...(target.exec ?? []), ...stage.exec];
      }
    }
  }
  return merged;
}

function isSameWaitFor(a: unknown, b: unknown): boolean {
  return isRecord(a) && isRecord(b) && a.node === b.node && a.stage === b.stage;
}

/**
 * Username and password come together from the most specific level that sets
 * either; the identity file is looked up on its own.
 */
function mergeCredentials(values: unknown[]): Record<string, unknown> | undefined {
  const has = (value: unknown) => isSet("credentials", value);
  const levels = values.filter(isRecord).reverse();
  const login = levels.find((credentials) => has(credentials.username) || has(credentials.password));
  const identity = levels.find((credentials) => has(credentials["identity-file"]));
  if (!login && !identity) return undefined;
  const merged: Record<string, unknown> = {};
  if (login) {
    if (has(login.username)) merged.username = login.username;
    if (has(login.password)) merged.password = login.password;
  }
  if (identity) merged["identity-file"] = identity["identity-file"];
  return merged;
}

/** `config.vars` merges deeply; other `config` keys come from the most specific level. */
function mergeConfigBlocks(values: unknown[]): Record<string, unknown> {
  const merged = mergeMaps(values);
  const vars = values.map((value) => (isRecord(value) ? value.vars : undefined));
  if (vars.some(isRecord)) merged.vars = mergeDeep(vars);
  return merged;
}

function mergeKey(key: string, values: unknown[]): unknown {
  if (MERGED_MAP_KEYS.has(key)) return mergeMaps(values);
  if (MERGED_LIST_KEYS.has(key)) return mergeLists(values);
  if (MOUNT_LIST_KEYS.has(key)) return mergeMounts(values);
  if (key === "certificate") return mergeCertificates(values);
  if (key === "config") return mergeConfigBlocks(values);
  if (key === "stages") return mergeStages(values);
  if (key === "credentials") return mergeCredentials(values);
  for (let i = values.length - 1; i >= 0; i--) {
    if (!isSet(key, values[i])) continue;
    const value = values[i];
    return key === "type" && typeof value === "string" ? value.trim() : value;
  }
  return undefined;
}

/**
 * Merges the inherited layers and the node's own block (if any), least
 * specific first. `kind` and `group` are left to the caller, since they follow
 * their own lookup.
 */
function mergeBlocks(
  layers: InheritanceLayer[],
  node: ClabNode | undefined,
  options: ResolveNodeOptions
): ClabNode {
  const keys = new Set<string>();
  for (const block of [...layers.map((layer) => layer.config), node ?? {}]) {
    for (const key of Object.keys(block)) keys.add(key);
  }
  const merged: ClabNode = {};
  for (const key of keys) {
    if (key === "kind" || key === "group") continue;
    const inherited = isInheritableKey(key) ? blocksForKey(key, layers, options) : [];
    const blocks = [...inherited.map((layer) => layer.config), ...(node ? [node] : [])];
    const values = blocks.map((block) => block[key]).filter((value) => isSet(key, value));
    if (values.length === 0) continue;
    const value = mergeKey(key, values);
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/**
 * The configuration a node inherits from defaults, its kind and its group,
 * without the node's own values. `kind` and `group` hold the names the node
 * resolves to when it does not set them itself.
 */
export function resolveInheritedConfig(
  parsed: ClabTopology,
  node: ClabNode,
  options: ResolveNodeOptions = {}
): ClabNode {
  const layers = getInheritanceLayers(parsed, node);
  const inherited = mergeBlocks(layers, undefined, options);
  const { defaults = {}, groups } = parsed.topology ?? {};
  const kind =
    nonEmptyString(findGroupConfig(groups, nonEmptyString(node.group))?.kind) ??
    nonEmptyString(findGroupConfig(groups, nonEmptyString(defaults.group))?.kind) ??
    nonEmptyString(defaults.kind);
  if (kind !== undefined) inherited.kind = kind;
  const group = resolveNodeGroupName(parsed, { ...node, group: undefined });
  if (group !== undefined) inherited.group = group;
  return inherited;
}

/**
 * Applies Containerlab inheritance rules to compute the effective
 * configuration for a node. The precedence order is:
 * node -> group -> kind -> defaults.
 */
export function resolveNodeConfig(
  parsed: ClabTopology,
  node: ClabNode,
  options: ResolveNodeOptions = {}
): ClabNode {
  const layers = getInheritanceLayers(parsed, node);
  const merged = mergeBlocks(layers, node, options);
  for (const key of NODE_ONLY_KEYS) {
    if (key in node) merged[key] = node[key];
  }
  const kind = resolveNodeKindName(parsed, node);
  const group = resolveNodeGroupName(parsed, node);
  return {
    ...merged,
    ...(kind !== undefined ? { kind } : {}),
    ...(group !== undefined ? { group } : {}),
    labels: isRecord(merged.labels) ? merged.labels : {}
  };
}

/**
 * For every key the node inherits, the level it comes from: the most specific
 * level that sets it (group, then kind, then defaults). Keys the node sets
 * itself are left out, even when other levels add entries to them.
 */
export function resolveInheritedFrom(
  parsed: ClabTopology,
  node: ClabNode,
  options: ResolveNodeOptions = {}
): Record<string, InheritanceLevel> {
  const result: Record<string, InheritanceLevel> = {};
  const layers = getInheritanceLayers(parsed, node);
  for (let i = layers.length - 1; i >= 0; i--) {
    const { level, config } = layers[i];
    for (const [key, value] of Object.entries(config)) {
      // A kind's own `kind` or a group's own `group` key means nothing.
      if (key === level) continue;
      if (!isInheritableKey(key) || !isSet(key, value)) continue;
      if (isSet(key, node[key]) || key in result) continue;
      if (!blocksForKey(key, layers, options).includes(layers[i])) continue;
      result[key] = level;
    }
  }
  return result;
}

/**
 * The part of `value` the node has to write itself, given what it inherits.
 * Merged maps and lists keep only the entries the inherited value lacks;
 * other keys return undefined when the node value equals the inherited one.
 */
export function subtractInherited(
  key: string,
  value: unknown,
  inherited: unknown,
  equals: (a: unknown, b: unknown) => boolean
): unknown {
  // containerlab reads 0 as "not set" for these, so writing it changes nothing.
  if (!isSet(key, value)) return undefined;
  // Stages add up, so the node's own entries are kept as written.
  if (key === "stages") return value;
  if ((MERGED_MAP_KEYS.has(key) || key === "certificate") && isRecord(value)) {
    return subtractEntries(value, inherited, equals);
  }
  if ((MERGED_LIST_KEYS.has(key) || MOUNT_LIST_KEYS.has(key)) && Array.isArray(value)) {
    const base = Array.isArray(inherited) ? inherited : [];
    const own = value.filter((item) => !base.some((entry) => equals(entry, item)));
    return own.length > 0 ? own : undefined;
  }
  if (key === "config" && isRecord(value)) return subtractConfig(value, inherited, equals);
  return equals(value, inherited) ? undefined : value;
}

/** `config.vars` merges deeply, so nested maps keep only the entries the node changes */
function subtractDeep(
  value: Record<string, unknown>,
  inherited: unknown,
  equals: (a: unknown, b: unknown) => boolean
): Record<string, unknown> | undefined {
  const base = isRecord(inherited) ? inherited : {};
  const own: Record<string, unknown> = {};
  for (const [entry, entryValue] of Object.entries(value)) {
    const baseValue = base[entry];
    if (equals(baseValue, entryValue)) continue;
    const nested =
      isRecord(entryValue) && isRecord(baseValue)
        ? subtractDeep(entryValue, baseValue, equals)
        : entryValue;
    if (nested !== undefined) own[entry] = nested;
  }
  return Object.keys(own).length > 0 ? own : undefined;
}

/** The `config` block: vars deeply, other keys whole */
function subtractConfig(
  value: Record<string, unknown>,
  inherited: unknown,
  equals: (a: unknown, b: unknown) => boolean
): Record<string, unknown> | undefined {
  const base = isRecord(inherited) ? inherited : {};
  const own: Record<string, unknown> = {};
  for (const [entry, entryValue] of Object.entries(value)) {
    if (entry === "vars" && isRecord(entryValue)) {
      const vars = subtractDeep(entryValue, base.vars, equals);
      if (vars !== undefined) own.vars = vars;
    } else if (!equals(base[entry], entryValue)) {
      own[entry] = entryValue;
    }
  }
  return Object.keys(own).length > 0 ? own : undefined;
}

/** Map entries (or certificate fields) that differ from the inherited ones */
function subtractEntries(
  value: Record<string, unknown>,
  inherited: unknown,
  equals: (a: unknown, b: unknown) => boolean
): Record<string, unknown> | undefined {
  const base = isRecord(inherited) ? inherited : {};
  const own = Object.fromEntries(
    Object.entries(value).filter(([entry, entryValue]) => !equals(base[entry], entryValue))
  );
  return Object.keys(own).length > 0 ? own : undefined;
}

/**
 * The `stages` each level gives the node, in the order containerlab merges
 * them: defaults, kind, then group. Stages add up instead of overriding, so
 * every level is kept.
 */
export function resolveInheritedStages(
  parsed: ClabTopology,
  node: ClabNode
): Array<{ level: InheritanceLevel; stages: Record<string, unknown> }> {
  const result: Array<{ level: InheritanceLevel; stages: Record<string, unknown> }> = [];
  for (const { level, config } of getInheritanceLayers(parsed, node)) {
    if (isRecord(config.stages)) result.push({ level, stages: config.stages });
  }
  return result;
}
