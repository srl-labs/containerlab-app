/**
 * What a node in the editor inherits from defaults, its kind and its group,
 * in editor terms: inherited field values, and the level each value or list
 * entry comes from.
 */
import type { ClabTopology } from "../types/topology";
import type { NodeEditorData } from "../types/editors";
import {
  getInheritanceLayers,
  getMountDestination,
  resolveInheritedConfig,
  type InheritanceLayer
} from "../parsing/NodeConfigResolver";
import { deepEqual } from "../io/YamlDocumentIO";

import { isRecord } from "./typeHelpers";
import { convertToEditorData } from "./nodeEditorConversions";

/** Editor fields that are a single value, with the YAML path they read. */
const SCALAR_FIELDS = {
  type: ["type"],
  image: ["image"],
  startupConfig: ["startup-config"],
  enforceStartupConfig: ["enforce-startup-config"],
  suppressStartupConfig: ["suppress-startup-config"],
  license: ["license"],
  user: ["user"],
  entrypoint: ["entrypoint"],
  cmd: ["cmd"],
  restartPolicy: ["restart-policy"],
  autoRemove: ["auto-remove"],
  startupDelay: ["startup-delay"],
  mgmtNet: ["mgmt-net"],
  networkMode: ["network-mode"],
  ports: ["ports"],
  dnsServers: ["dns", "servers"],
  dnsSearch: ["dns", "search"],
  dnsOptions: ["dns", "options"],
  cpu: ["cpu"],
  cpuSet: ["cpu-set"],
  memory: ["memory"],
  shmSize: ["shm-size"],
  certIssue: ["certificate", "issue"],
  certKeySize: ["certificate", "key-size"],
  certValidity: ["certificate", "validity-duration"],
  sans: ["certificate", "sans"],
  healthCheck: ["healthcheck"],
  imagePullPolicy: ["image-pull-policy"],
  runtime: ["runtime"],
  components: ["components"],
  sfm: ["sfm"]
} as const satisfies Partial<Record<keyof NodeEditorData, readonly string[]>>;

/** Key/value fields merged entry by entry. */
const MAP_FIELDS = { env: "env", labels: "labels", sysctls: "sysctls" } as const;
const MAP_FIELD_NAMES = ["env", "labels", "sysctls"] as const;

/** List fields merged item by item. */
const LIST_FIELDS = {
  binds: "binds",
  envFiles: "env-files",
  exec: "exec",
  capAdd: "cap-add",
  devices: "devices"
} as const;
const LIST_FIELD_NAMES = ["binds", "envFiles", "exec", "capAdd", "devices"] as const;

/** Lists merged by mount destination */
const MOUNT_KEYS = new Set(["binds", "volumes"]);

export type InheritedScalarField = keyof typeof SCALAR_FIELDS;
export type InheritedMapField = keyof typeof MAP_FIELDS;
export type InheritedListField = keyof typeof LIST_FIELDS;

/** Where a value comes from, e.g. "kind nokia_srlinux" or "defaults". */
export interface InheritanceSource {
  level: InheritanceLayer["level"];
  name?: string;
}

export interface NodeInheritance {
  /** Inherited values in editor form */
  values: NodeEditorData;
  /** Level an inherited single-value field comes from */
  fieldSource: (field: InheritedScalarField | "kind" | "group") => InheritanceSource | undefined;
  /** Inherited map entries, by key, with the level each comes from */
  mapEntries: (field: InheritedMapField) => Record<string, InheritanceSource>;
  /** Inherited list items, with the level each comes from */
  listItems: (field: InheritedListField) => Map<string, InheritanceSource>;
  /** Level an inherited kind-specific key (custom-prompt, daemons, ...) comes from */
  kindConfigSource: (key: string) => InheritanceSource | undefined;
  /** Level an inherited value at a YAML path (hostname, config.vars, ...) comes from */
  pathSource: (path: readonly string[]) => InheritanceSource | undefined;
  /** Inherited entries of a merged map at a YAML path (tmpfs, config.vars), by key */
  pathEntries: (path: readonly string[]) => Record<string, InheritanceSource>;
  /** Inherited items of a merged list under a YAML key (volumes, security-opts) */
  keyItems: (key: string) => Map<string, InheritanceSource>;
}

export function describeInheritanceSource(source: InheritanceSource): string {
  return source.name !== undefined ? `${source.level} ${source.name}` : source.level;
}

function readPath(config: Record<string, unknown>, path: readonly string[]): unknown {
  let value: unknown = config;
  for (const key of path) {
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return value;
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  return !Array.isArray(value) || value.length > 0;
}

function sourceOf(layer: InheritanceLayer): InheritanceSource {
  return layer.name !== undefined ? { level: layer.level, name: layer.name } : { level: layer.level };
}

/** Most specific layer that sets `path`. */
function findSource(
  layers: InheritanceLayer[],
  path: readonly string[]
): InheritanceSource | undefined {
  for (let i = layers.length - 1; i >= 0; i--) {
    if (hasValue(readPath(layers[i].config, path))) return sourceOf(layers[i]);
  }
  return undefined;
}

/**
 * Inheritance of a node with the given kind and group (its effective values,
 * as shown in the editor).
 */
export function computeNodeInheritance(
  parsed: ClabTopology,
  kind: string | undefined,
  group: string | undefined
): NodeInheritance {
  const node = { kind: kind ?? undefined, group: group !== "" ? group : undefined };
  const layers = getInheritanceLayers(parsed, node);
  const inheritedConfig = resolveInheritedConfig(parsed, node);
  const values = convertToEditorData({ id: "", extraData: inheritedConfig }) ?? {
    id: "",
    name: ""
  };

  /** Inherited map entries with the most specific level that sets each */
  const entrySources = (path: readonly string[]): Record<string, InheritanceSource> => {
    const entries: Record<string, InheritanceSource> = {};
    for (const layer of layers) {
      const map = readPath(layer.config, path);
      if (!isRecord(map)) continue;
      for (const key of Object.keys(map)) entries[key] = sourceOf(layer);
    }
    return entries;
  };

  /** Inherited list items with the most specific level that adds each */
  const itemSources = (key: string): Map<string, InheritanceSource> => {
    const items = new Map<string, InheritanceSource>();
    const inherited = inheritedConfig[key];
    if (!Array.isArray(inherited)) return items;
    for (const item of inherited) {
      if (typeof item !== "string") continue;
      const layer = [...layers].reverse().find((entry) => {
        const list = entry.config[key];
        if (!Array.isArray(list)) return false;
        return MOUNT_KEYS.has(key)
          ? list.some(
              (candidate) =>
                typeof candidate === "string" &&
                getMountDestination(candidate) === getMountDestination(item)
            )
          : list.includes(item);
      });
      if (layer) items.set(item, sourceOf(layer));
    }
    return items;
  };

  return {
    values,
    fieldSource: (field) => {
      if (field === "kind") {
        if (node.kind === undefined || inheritedConfig.kind !== node.kind) return undefined;
        const group = layers.find((layer) => layer.level === "group");
        return group && hasValue(group.config.kind) ? sourceOf(group) : { level: "defaults" };
      }
      if (field === "group") {
        if (node.group === undefined || inheritedConfig.group !== node.group) return undefined;
        const kindLayer = layers.find((layer) => layer.level === "kind");
        return kindLayer && hasValue(kindLayer.config.group)
          ? sourceOf(kindLayer)
          : { level: "defaults" };
      }
      return findSource(layers, SCALAR_FIELDS[field]);
    },
    mapEntries: (field) => entrySources([MAP_FIELDS[field]]),
    listItems: (field) => itemSources(LIST_FIELDS[field]),
    // containerlab takes a kind-specific value whole from the most specific level
    kindConfigSource: (key) => findSource(layers, [key]),
    pathSource: (path) => findSource(layers, path),
    pathEntries: entrySources,
    keyItems: itemSources
  };
}

function rebaseMap(
  current: Record<string, unknown> | undefined,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const own = Object.fromEntries(
    Object.entries(current ?? {}).filter(([key, value]) => !deepEqual(before?.[key], value))
  );
  const merged = { ...after, ...own };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function rebaseList(
  current: string[] | undefined,
  before: string[] | undefined,
  after: string[] | undefined
): string[] | undefined {
  const own = (current ?? []).filter((item) => !(before ?? []).includes(item));
  const merged = [...(after ?? []).filter((item) => !own.includes(item)), ...own];
  return merged.length > 0 ? merged : undefined;
}

/**
 * Rebase a value of the Other tab: maps entry by entry (nested ones too, like
 * config.vars), lists item by item, anything else whole.
 */
function rebaseValue(current: unknown, before: unknown, after: unknown): unknown {
  if (!hasValue(current) || deepEqual(current, before)) return after;
  if (Array.isArray(current)) {
    const inherited: unknown[] = Array.isArray(before) ? before : [];
    const own: unknown[] = current.filter(
      (item) => !inherited.some((entry) => deepEqual(entry, item))
    );
    const base: unknown[] = Array.isArray(after) ? after : [];
    const merged = [...base.filter((item) => !own.some((entry) => deepEqual(entry, item))), ...own];
    return merged.length > 0 ? merged : undefined;
  }
  if (isRecord(current) && (isRecord(before) || isRecord(after))) {
    return rebaseRecord(current, before, after);
  }
  return current;
}

function rebaseRecord(
  current: Record<string, unknown> | undefined,
  before: unknown,
  after: unknown
): Record<string, unknown> | undefined {
  const inherited = isRecord(before) ? before : {};
  const next = isRecord(after) ? after : {};
  const merged: Record<string, unknown> = { ...next };
  for (const [key, value] of Object.entries(current ?? {})) {
    const rebased = rebaseValue(value, inherited[key], next[key]);
    if (rebased === undefined) delete merged[key];
    else merged[key] = rebased;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * When the kind or group changes, values the node took from the old levels are
 * replaced by what the new levels give; values the node sets itself stay.
 */
export function rebaseInheritedValues(
  data: NodeEditorData,
  before: NodeEditorData,
  after: NodeEditorData
): Partial<NodeEditorData> {
  const updates: Record<string, unknown> = {};
  const read = (source: NodeEditorData, field: string): unknown => Reflect.get(source, field);
  for (const field of Object.keys(SCALAR_FIELDS)) {
    const inheritedBefore = read(before, field);
    if (inheritedBefore === undefined || !deepEqual(read(data, field), inheritedBefore)) continue;
    updates[field] = read(after, field);
  }
  for (const field of Object.keys(SCALAR_FIELDS)) {
    if (field in updates) continue;
    const current = read(data, field);
    const inheritedAfter = read(after, field);
    if (!hasValue(current) && inheritedAfter !== undefined) updates[field] = inheritedAfter;
  }
  for (const field of MAP_FIELD_NAMES) {
    updates[field] = rebaseMap(data[field], before[field], after[field]);
  }
  for (const field of LIST_FIELD_NAMES) {
    updates[field] = rebaseList(data[field], before[field], after[field]);
  }
  updates.kindConfig = rebaseMap(data.kindConfig, before.kindConfig, after.kindConfig);
  updates.otherConfig = rebaseRecord(data.otherConfig, before.otherConfig, after.otherConfig);
  return Object.fromEntries(
    Object.entries(updates).filter(([field, value]) => !deepEqual(read(data, field), value))
  );
}
