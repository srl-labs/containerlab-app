/**
 * Writes the sections nodes inherit from: `topology.defaults`,
 * `topology.kinds.<kind>` and `topology.groups.<group>`. Changes merge into the
 * existing maps, so keys the editor does not show, comments and key order stay.
 */
import * as YAML from "yaml";

import type { InheritanceSectionUpdate } from "../types/inheritance";
import { setOrDelete } from "../io/YamlDocumentIO";

/** Section keys are placed before these keys of `topology` when they are created. */
const SECTION_ORDER = ["defaults", "kinds", "groups", "nodes", "links"];

function createBlockMap(): YAML.YAMLMap {
  const map = new YAML.YAMLMap();
  map.flow = false;
  return map;
}

function keyOf(pair: YAML.Pair): unknown {
  return YAML.isScalar(pair.key) ? pair.key.value : pair.key;
}

function findPair(map: YAML.YAMLMap, key: string): YAML.Pair | undefined {
  return map.items.find((pair) => keyOf(pair) === key);
}

/** Returns the map under `key`, creating it (as a block map) when missing. */
function ensureMap(parent: YAML.YAMLMap, key: string, order?: string[]): YAML.YAMLMap {
  const pair = findPair(parent, key);
  if (pair && YAML.isMap(pair.value)) {
    pair.value.flow = false;
    return pair.value;
  }
  const map = createBlockMap();
  if (pair) {
    pair.value = map;
    return map;
  }
  const newPair = new YAML.Pair(new YAML.Scalar(key), map);
  const rank = order?.indexOf(key) ?? -1;
  const before =
    rank >= 0
      ? parent.items.findIndex((item) => {
          const itemRank = order?.indexOf(String(keyOf(item))) ?? -1;
          return itemRank > rank;
        })
      : -1;
  if (before >= 0) parent.items.splice(before, 0, newPair);
  else parent.items.push(newPair);
  return map;
}

function topologyMap(doc: YAML.Document): YAML.YAMLMap {
  if (YAML.isMap(doc.contents)) return ensureMap(doc.contents, "topology");
  const root = createBlockMap();
  doc.contents = root;
  return ensureMap(root, "topology");
}

function sectionParentKey(level: "kind" | "group"): "kinds" | "groups" {
  return level === "kind" ? "kinds" : "groups";
}

function deleteKey(map: YAML.YAMLMap, key: string): void {
  const index = map.items.findIndex((pair) => keyOf(pair) === key);
  if (index >= 0) map.items.splice(index, 1);
}

/** Points every `group: <from>` in nodes, kinds and defaults at `to`. */
function renameGroupReferences(topology: YAML.YAMLMap, from: string, to: string): void {
  const holders: YAML.YAMLMap[] = [];
  const defaults = findPair(topology, "defaults")?.value;
  if (YAML.isMap(defaults)) holders.push(defaults);
  for (const parentKey of ["kinds", "nodes"]) {
    const parent = findPair(topology, parentKey)?.value;
    if (!YAML.isMap(parent)) continue;
    for (const pair of parent.items) {
      if (YAML.isMap(pair.value)) holders.push(pair.value);
    }
  }
  for (const holder of holders) {
    const pair = findPair(holder, "group");
    if (!pair) continue;
    if (YAML.isScalar(pair.value) && pair.value.value === from) pair.value.value = to;
  }
}

function removeSection(topology: YAML.YAMLMap, parentKey: string, name: string): void {
  const parent = findPair(topology, parentKey)?.value;
  if (!YAML.isMap(parent)) return;
  deleteKey(parent, name);
  if (parent.items.length === 0) deleteKey(topology, parentKey);
}

/** Finds or creates the section map an update writes to. */
function sectionMap(
  topology: YAML.YAMLMap,
  update: InheritanceSectionUpdate
): YAML.YAMLMap | undefined {
  if (update.level === "defaults") return ensureMap(topology, "defaults", SECTION_ORDER);
  const name = update.name?.trim();
  if (name === undefined || name === "") throw new Error(`A ${update.level} needs a name`);
  const parentKey = sectionParentKey(update.level);

  if (update.remove === true) {
    removeSection(topology, parentKey, name);
    return undefined;
  }

  const parent = ensureMap(topology, parentKey, SECTION_ORDER);
  const rename = update.rename?.trim();
  if (rename !== undefined && rename !== "" && rename !== name) {
    if (findPair(parent, rename)) {
      throw new Error(`A ${update.level} named "${rename}" already exists`);
    }
    const pair = findPair(parent, name);
    if (pair) pair.key = new YAML.Scalar(rename);
    if (update.level === "group") renameGroupReferences(topology, name, rename);
    return ensureMap(parent, rename);
  }
  return ensureMap(parent, name);
}

/** Applies one defaults, kind or group edit to the topology document. */
export function applyInheritanceSectionUpdate(
  doc: YAML.Document,
  update: InheritanceSectionUpdate
): void {
  const topology = topologyMap(doc);
  const section = sectionMap(topology, update);
  if (!section) return;
  for (const [key, value] of Object.entries(update.changes ?? {})) {
    if (value === undefined) continue;
    // A kind section's own `kind` and a group's own `group` would mean nothing.
    if (key === update.level) continue;
    if (value === null) {
      deleteKey(section, key);
      continue;
    }
    setOrDelete(doc, section, key, value);
  }
}
