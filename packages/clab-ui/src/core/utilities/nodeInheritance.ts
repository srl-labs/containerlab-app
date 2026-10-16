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
    mapEntries: (field) => {
      const entries: Record<string, InheritanceSource> = {};
      for (const layer of layers) {
        const map = layer.config[MAP_FIELDS[field]];
        if (!isRecord(map)) continue;
        for (const key of Object.keys(map)) entries[key] = sourceOf(layer);
      }
      return entries;
    },
    listItems: (field) => {
      const key = LIST_FIELDS[field];
      const items = new Map<string, InheritanceSource>();
      const inherited = inheritedConfig[key];
      if (!Array.isArray(inherited)) return items;
      for (const item of inherited) {
        if (typeof item !== "string") continue;
        const layer = [...layers].reverse().find((entry) => {
          const list = entry.config[key];
          if (!Array.isArray(list)) return false;
          return key === "binds"
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
    }
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
  return Object.fromEntries(
    Object.entries(updates).filter(([field, value]) => !deepEqual(read(data, field), value))
  );
}
