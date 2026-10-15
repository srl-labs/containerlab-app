/**
 * Reads and writes the lab-level keys the Lab Settings form edits: `name`,
 * `prefix`, `mgmt` (one map or a list of networks) and `topology.defaults.mgmt-net`.
 * Writes merge into the existing nodes, so keys the form does not own, comments
 * and key order are kept.
 */
import * as YAML from "yaml";

import type {
  LabSettings,
  LabSettingsUpdate,
  MgmtNetworkUpdate,
  MgmtSettings,
  MgmtSettingsUpdate
} from "../types/labSettings";

const MGMT_NET_KEY = "mgmt-net";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mapToSettings(node: unknown): MgmtSettings {
  if (!YAML.isMap(node)) return {};
  const json: unknown = node.toJSON();
  return isRecord(json) ? json : {};
}

export function extractLabSettings(doc: YAML.Document.Parsed): LabSettings {
  const settings: LabSettings = {};
  const nameValue = doc.get("name");
  const prefixValue = doc.get("prefix");
  const mgmtRaw = doc.get("mgmt");

  if (typeof nameValue === "string" && nameValue !== "") settings.name = nameValue;
  if (typeof prefixValue === "string") settings.prefix = prefixValue;
  if (YAML.isSeq(mgmtRaw)) {
    settings.mgmtNetworks = mgmtRaw.items.map(mapToSettings);
  } else if (YAML.isMap(mgmtRaw)) {
    settings.mgmt = mapToSettings(mgmtRaw);
  }

  const defaultMgmtNet = doc.getIn(["topology", "defaults", MGMT_NET_KEY]);
  if (typeof defaultMgmtNet === "string" && defaultMgmtNet !== "") {
    settings.defaultMgmtNet = defaultMgmtNet;
  }

  return settings;
}

export function applyLabSettingsUpdate(doc: YAML.Document, update: LabSettingsUpdate): void {
  const rootMap = doc.contents;
  if (!rootMap || !YAML.isMap(rootMap)) {
    throw new Error("YAML document root is not a map");
  }

  if (update.name !== undefined) {
    setScalarKey(doc, rootMap, "name", update.name);
  }

  if (update.prefix !== undefined) {
    if (update.prefix === null) {
      deleteKey(rootMap, "prefix");
    } else {
      setScalarKey(doc, rootMap, "prefix", update.prefix, "name");
    }
  }

  if (update.mgmt !== undefined) {
    applyMgmtNetworks(doc, rootMap, update.mgmt);
  }

  if (update.mgmtNetRenames !== undefined) {
    renameMgmtNetReferences(rootMap, update.mgmtNetRenames);
  }

  if (update.defaultMgmtNet !== undefined) {
    applyDefaultMgmtNet(doc, rootMap, update.defaultMgmtNet);
  }
}

function findPair(map: YAML.YAMLMap, key: string): YAML.Pair | undefined {
  return map.items.find((pair) => YAML.isScalar(pair.key) && pair.key.value === key);
}

function getMap(map: YAML.YAMLMap, key: string): YAML.YAMLMap | undefined {
  const value = findPair(map, key)?.value;
  return YAML.isMap(value) ? value : undefined;
}

function setKeyAfter(map: YAML.YAMLMap, key: string, value: YAML.Node, afterKey: string): void {
  const existing = findPair(map, key);
  if (existing) {
    existing.value = value;
    return;
  }
  const afterIndex = map.items.findIndex(
    (pair) => YAML.isScalar(pair.key) && pair.key.value === afterKey
  );
  const newPair = new YAML.Pair(new YAML.Scalar(key), value);
  if (afterIndex >= 0) {
    map.items.splice(afterIndex + 1, 0, newPair);
  } else {
    map.items.push(newPair);
  }
}

function deleteKey(map: YAML.YAMLMap, key: string): void {
  const index = map.items.findIndex((pair) => YAML.isScalar(pair.key) && pair.key.value === key);
  if (index >= 0) {
    map.items.splice(index, 1);
  }
}

function setKey(map: YAML.YAMLMap, key: string, value: YAML.Node): void {
  const existing = findPair(map, key);
  if (existing) {
    existing.value = value;
  } else {
    map.items.push(new YAML.Pair(new YAML.Scalar(key), value));
  }
}

/** Sets a scalar value, keeping the existing node (and its comments) when there is one. */
function setScalarKey(
  doc: YAML.Document,
  map: YAML.YAMLMap,
  key: string,
  value: unknown,
  afterKey?: string
): void {
  const existing = findPair(map, key);
  if (existing && YAML.isScalar(existing.value)) {
    if (existing.value.value !== value) existing.value.value = value;
    return;
  }
  const node = doc.createNode(value);
  if (afterKey !== undefined) {
    setKeyAfter(map, key, node, afterKey);
  } else {
    setKey(map, key, node);
  }
}

/** Merges form changes into one management network map. */
function applyMgmtChanges(doc: YAML.Document, mgmtMap: YAML.YAMLMap, changes: MgmtSettingsUpdate) {
  const entries: Array<[string, unknown]> = Object.entries(changes);
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (value === null) {
      deleteKey(mgmtMap, key);
    } else if (key === "driver-opts" && isRecord(value)) {
      mergeStringMap(doc, mgmtMap, key, value);
    } else {
      setScalarKey(doc, mgmtMap, key, value);
    }
  }
}

function existingMgmtMaps(value: unknown): YAML.YAMLMap[] {
  if (YAML.isMap(value)) return [value];
  if (YAML.isSeq(value)) {
    return value.items.map((item) => (YAML.isMap(item) ? item : new YAML.YAMLMap()));
  }
  return [];
}

/**
 * Writes the management networks. Each entry reuses the map it was loaded from,
 * so keys the form does not show (macvlan, ipam, tailscale, ...) survive edits,
 * reordering and switching between the map and the list form.
 */
function applyMgmtNetworks(
  doc: YAML.Document,
  rootMap: YAML.YAMLMap,
  networks: MgmtNetworkUpdate[]
): void {
  const mgmtPair = findPair(rootMap, "mgmt");
  const existing = existingMgmtMaps(mgmtPair?.value);
  const wasList = mgmtPair !== undefined && YAML.isSeq(mgmtPair.value);

  const maps = networks.map(({ source, changes }) => {
    const map = (source !== undefined ? existing[source] : undefined) ?? new YAML.YAMLMap();
    applyMgmtChanges(doc, map, changes);
    return map;
  });

  if (maps.length === 0 || (maps.length === 1 && maps[0].items.length === 0)) {
    deleteKey(rootMap, "mgmt");
    return;
  }

  let value: YAML.Node;
  if (maps.length === 1 && !wasList) {
    value = maps[0];
  } else if (mgmtPair && YAML.isSeq(mgmtPair.value)) {
    mgmtPair.value.items = maps;
    value = mgmtPair.value;
  } else {
    const seq = new YAML.YAMLSeq();
    seq.items = maps;
    value = seq;
  }

  if (mgmtPair) {
    mgmtPair.value = value;
  } else {
    setKeyAfter(rootMap, "mgmt", value, findPair(rootMap, "prefix") ? "prefix" : "name");
  }
}

function mergeStringMap(
  doc: YAML.Document,
  parent: YAML.YAMLMap,
  key: string,
  update: Record<string, unknown>
): void {
  let map = getMap(parent, key);
  if (!map) {
    map = new YAML.YAMLMap();
    setKey(parent, key, map);
  }
  for (const [entryKey, entryValue] of Object.entries(update)) {
    if (entryValue === null) {
      deleteKey(map, entryKey);
    } else {
      setScalarKey(doc, map, entryKey, entryValue);
    }
  }
  if (map.items.length === 0) deleteKey(parent, key);
}

/** Maps of the topology that can carry `mgmt-net`: defaults, kinds, groups and nodes. */
function mgmtNetHolders(rootMap: YAML.YAMLMap): YAML.YAMLMap[] {
  const topology = getMap(rootMap, "topology");
  if (!topology) return [];
  const holders: YAML.YAMLMap[] = [];
  const defaults = getMap(topology, "defaults");
  if (defaults) holders.push(defaults);
  for (const section of ["kinds", "groups", "nodes"]) {
    const sectionMap = getMap(topology, section);
    if (!sectionMap) continue;
    for (const pair of sectionMap.items) {
      if (YAML.isMap(pair.value)) holders.push(pair.value);
    }
  }
  return holders;
}

/** Renames `mgmt-net` references in one pass, so swapping two names works. */
function renameMgmtNetReferences(rootMap: YAML.YAMLMap, renames: Record<string, string>): void {
  for (const holder of mgmtNetHolders(rootMap)) {
    const pair = findPair(holder, MGMT_NET_KEY);
    if (!pair || !YAML.isScalar(pair.value) || typeof pair.value.value !== "string") continue;
    const renamed = Object.prototype.hasOwnProperty.call(renames, pair.value.value)
      ? renames[pair.value.value]
      : undefined;
    if (renamed !== undefined) pair.value.value = renamed;
  }
}

function applyDefaultMgmtNet(
  doc: YAML.Document,
  rootMap: YAML.YAMLMap,
  value: string | null
): void {
  const topology = getMap(rootMap, "topology");
  if (value === null) {
    const defaults = topology ? getMap(topology, "defaults") : undefined;
    if (!topology || !defaults) return;
    deleteKey(defaults, MGMT_NET_KEY);
    if (defaults.items.length === 0) deleteKey(topology, "defaults");
    return;
  }
  if (!topology) return;
  let defaults = getMap(topology, "defaults");
  if (!defaults) {
    defaults = new YAML.YAMLMap();
    topology.items.unshift(new YAML.Pair(new YAML.Scalar("defaults"), defaults));
  }
  setScalarKey(doc, defaults, MGMT_NET_KEY, value);
}
