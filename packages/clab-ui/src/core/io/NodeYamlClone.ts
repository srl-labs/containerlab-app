/**
 * NodeYamlClone - Copy a node's own YAML for copy / paste / duplicate
 *
 * Copy captures the keys written on the node itself (not values inherited
 * from defaults, kinds or groups) together with their comments. Paste inserts
 * that YAML under the new name and adjusts the fields that are bound to the
 * node's identity.
 */

import * as YAML from "yaml";

import { isRecord } from "../utilities/typeHelpers";

/** The YAML of a copied node, as carried by the clipboard */
export interface NodeYamlSource {
  /** Name of the node the YAML was copied from */
  name: string;
  /** The node's own map, serialised as a standalone YAML document */
  yaml: string;
  /** Comment written above the node's name, if any */
  comment?: string;
}

/** Effective values of the copied node, used when the target cannot resolve them */
export interface PastedNodeFallback {
  kind?: string | null;
  image?: string | null;
}

const MAX_PORT = 65535;

export function isNodeYamlSource(value: unknown): value is NodeYamlSource {
  if (!isRecord(value)) return false;
  if (typeof value.name !== "string" || typeof value.yaml !== "string") return false;
  return value.comment === undefined || typeof value.comment === "string";
}

function keyName(key: unknown): unknown {
  return YAML.isScalar(key) ? key.value : key;
}

function findPair(map: YAML.YAMLMap, name: string): YAML.Pair | undefined {
  return map.items.find((pair) => keyName(pair.key) === name);
}

/**
 * Replaces aliases with copies of what they point to and drops anchors, so the
 * node can be written into another document on its own.
 */
function detachNode<T extends YAML.Node>(doc: YAML.Document, node: T): T {
  YAML.visit(node, {
    Alias(_, alias) {
      const copy = alias.resolve(doc)?.clone();
      return YAML.isNode(copy) ? copy : doc.createNode(null);
    },
    Node(_, item) {
      if (item.anchor !== undefined) item.anchor = undefined;
    }
  });
  return node;
}

function toDetachedMap(doc: YAML.Document, value: unknown): YAML.YAMLMap | undefined {
  // Shorthand `node1:` with no keys
  if (value === null || value === undefined) return new YAML.YAMLMap();
  if (YAML.isScalar(value)) {
    return value.value === null ? new YAML.YAMLMap() : undefined;
  }
  const resolved = YAML.isAlias(value) ? value.resolve(doc) : value;
  if (!YAML.isMap(resolved)) return undefined;
  const copy = resolved.clone();
  return YAML.isMap(copy) ? detachNode(doc, copy) : undefined;
}

/**
 * Reads the own YAML of the named nodes from a topology file.
 * Nodes that are not plain maps in `topology.nodes` are left out.
 */
export function extractNodeYamlSources(
  yamlContent: string,
  nodeNames: readonly string[]
): Map<string, NodeYamlSource> {
  const sources = new Map<string, NodeYamlSource>();
  if (!yamlContent || nodeNames.length === 0) return sources;

  const doc = YAML.parseDocument(yamlContent);
  if (doc.errors.length > 0) return sources;
  const nodesMap = doc.getIn(["topology", "nodes"], true);
  if (!YAML.isMap(nodesMap)) return sources;

  for (const name of nodeNames) {
    const pair = findPair(nodesMap, name);
    if (!pair) continue;
    const map = toDetachedMap(doc, pair.value);
    if (!map) continue;
    map.flow = false;

    const out = new YAML.Document();
    out.contents = map;
    const source: NodeYamlSource = { name, yaml: out.toString() };
    const comment = YAML.isScalar(pair.key) ? pair.key.commentBefore : undefined;
    if (comment !== undefined && comment !== null && comment.length > 0) {
      source.comment = comment;
    }
    sources.set(name, source);
  }

  return sources;
}

// ============================================================================
// Inheritance lookup in the target topology
// ============================================================================

function readRecord(doc: YAML.Document, path: readonly string[]): Record<string, unknown> {
  const node = doc.getIn(path, true);
  if (!YAML.isMap(node)) return {};
  const value: unknown = node.toJS(doc);
  return isRecord(value) ? value : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function lookupEntry(
  entries: Record<string, unknown>,
  name: string | undefined,
  ignoreCase: boolean
): Record<string, unknown> | undefined {
  if (name === undefined) return undefined;
  const exact = entries[name];
  if (isRecord(exact)) return exact;
  if (!ignoreCase) return undefined;
  const lower = name.toLowerCase();
  const match = Object.keys(entries).find((key) => key.toLowerCase() === lower);
  const value = match !== undefined ? entries[match] : undefined;
  return isRecord(value) ? value : undefined;
}

/** Resolves kind and image the way containerlab does: node > group > kind > defaults */
function resolveInTarget(
  doc: YAML.Document,
  own: Record<string, unknown>
): { kind?: string; image?: string } {
  const defaults = readRecord(doc, ["topology", "defaults"]);
  const kinds = readRecord(doc, ["topology", "kinds"]);
  const groups = readRecord(doc, ["topology", "groups"]);

  const group = lookupEntry(groups, readString(own.group) ?? readString(defaults.group), false);
  const kind = readString(own.kind) ?? readString(group?.kind) ?? readString(defaults.kind);
  const kindDefaults = lookupEntry(kinds, kind, true);
  const image =
    readString(own.image) ??
    readString(group?.image) ??
    readString(kindDefaults?.image) ??
    readString(defaults.image);
  return { kind, image };
}

// ============================================================================
// Host port handling
// ============================================================================

interface HostPortSpec {
  start: number;
  end: number;
  format: (start: number, end: number) => string;
}

/**
 * Parses the host side of a docker port spec
 * (`[ip:]hostPort[-end]:containerPort[/proto]`). Returns undefined when the
 * spec does not pin a host port.
 */
function parseHostPortSpec(spec: string): HostPortSpec | undefined {
  const slash = spec.lastIndexOf("/");
  const proto = slash >= 0 ? spec.slice(slash) : "";
  const body = slash >= 0 ? spec.slice(0, slash) : spec;

  let ip = "";
  let rest = body;
  if (body.startsWith("[")) {
    const close = body.indexOf("]:");
    if (close < 0) return undefined;
    ip = body.slice(0, close + 2);
    rest = body.slice(close + 2);
  }

  const parts = rest.split(":");
  if (parts.length === 3 && ip === "") {
    ip = `${parts[0]}:`;
    parts.shift();
  }
  if (parts.length !== 2) return undefined;

  const [host, container] = parts;
  const match = /^(\d+)(?:-(\d+))?$/.exec(host);
  if (!match) return undefined;
  const start = Number.parseInt(match[1], 10);
  const end = match[2] ? Number.parseInt(match[2], 10) : start;
  if (end < start) return undefined;

  return {
    start,
    end,
    format: (nextStart, nextEnd) =>
      `${ip}${nextEnd === nextStart ? String(nextStart) : `${nextStart}-${nextEnd}`}:${container}${proto}`
  };
}

function addUsedPorts(used: Set<number>, ports: unknown): void {
  if (!Array.isArray(ports)) return;
  for (const entry of ports) {
    if (typeof entry !== "string") continue;
    const spec = parseHostPortSpec(entry);
    if (!spec) continue;
    for (let port = spec.start; port <= spec.end; port++) used.add(port);
  }
}

/** Host ports already pinned anywhere in the target topology */
function collectUsedHostPorts(doc: YAML.Document): Set<number> {
  const used = new Set<number>();
  addUsedPorts(used, readRecord(doc, ["topology", "defaults"]).ports);
  for (const path of [
    ["topology", "kinds"],
    ["topology", "groups"],
    ["topology", "nodes"]
  ]) {
    for (const entry of Object.values(readRecord(doc, path))) {
      if (isRecord(entry)) addUsedPorts(used, entry.ports);
    }
  }
  return used;
}

function rangeIsFree(used: Set<number>, start: number, end: number): boolean {
  for (let port = start; port <= end; port++) {
    if (used.has(port)) return false;
  }
  return true;
}

/**
 * Moves pinned host ports that are already taken to the next free port
 * (or range). Entries that cannot be moved are removed.
 */
function bumpHostPorts(nodeMap: YAML.YAMLMap, used: Set<number>): void {
  const ports = nodeMap.get("ports", true);
  if (!YAML.isSeq(ports)) return;

  ports.items = ports.items.filter((item) => {
    if (!YAML.isScalar(item) || typeof item.value !== "string") return true;
    const spec = parseHostPortSpec(item.value);
    if (!spec) return true;

    const width = spec.end - spec.start;
    let start = spec.start;
    while (start + width <= MAX_PORT && !rangeIsFree(used, start, start + width)) {
      start += 1;
    }
    if (start + width > MAX_PORT) return false;

    if (start !== spec.start) item.value = spec.format(start, start + width);
    for (let port = start; port <= start + width; port++) used.add(port);
    return true;
  });

  if (ports.items.length === 0) nodeMap.delete("ports");
}

// ============================================================================
// Paste
// ============================================================================

function renameScalarIfEqual(node: unknown, oldName: string, newName: string): void {
  if (YAML.isScalar(node) && node.value === oldName) node.value = newName;
}

/**
 * Adjusts the fields that are bound to the copied node's identity:
 * - `mgmt-ipv4` / `mgmt-ipv6` are removed so the new node gets an address from
 *   the management network instead of reusing (or guessing) one.
 * - `hostname` and label values that equal the old node name are renamed.
 * - pinned host ports that are already taken in the target are moved.
 * Paths (startup-config, binds, license, ...) are kept as written.
 */
function applyPasteIdentity(
  doc: YAML.Document,
  nodeMap: YAML.YAMLMap,
  oldName: string,
  newName: string
): void {
  nodeMap.delete("mgmt-ipv4");
  nodeMap.delete("mgmt-ipv6");

  if (oldName !== newName) {
    renameScalarIfEqual(nodeMap.get("hostname", true), oldName, newName);
    const labels = nodeMap.get("labels", true);
    if (YAML.isMap(labels)) {
      for (const pair of labels.items) renameScalarIfEqual(pair.value, oldName, newName);
    }
  }

  bumpHostPorts(nodeMap, collectUsedHostPorts(doc));
}

/**
 * Keeps the node deployable when the target topology cannot resolve its kind
 * or image (e.g. pasted into a lab without the same defaults/kinds/groups).
 * Values the target can resolve itself are not written.
 */
function fillUnresolved(
  doc: YAML.Document,
  nodeMap: YAML.YAMLMap,
  fallback: PastedNodeFallback
): void {
  const own: unknown = nodeMap.toJS(doc);
  const resolved = resolveInTarget(doc, isRecord(own) ? own : {});
  const fallbackImage = readString(fallback.image);

  if (resolved.image === undefined && fallbackImage !== undefined) {
    nodeMap.items.unshift(doc.createPair("image", fallbackImage));
  }
  if (resolved.kind === undefined) {
    const kind = readString(fallback.kind) ?? "nokia_srlinux";
    nodeMap.items.unshift(doc.createPair("kind", kind));
  }
}

/**
 * Builds the YAML pair for a pasted node from its copied YAML.
 * Throws when the copied YAML cannot be parsed into a map.
 */
export function createPastedNodePair(
  doc: YAML.Document,
  source: NodeYamlSource,
  newName: string,
  fallback: PastedNodeFallback = {}
): YAML.Pair<YAML.Scalar, YAML.YAMLMap> {
  const parsed = YAML.parseDocument(source.yaml);
  if (parsed.errors.length > 0) {
    throw new Error(`Invalid copied YAML for node "${source.name}": ${parsed.errors[0].message}`);
  }
  const nodeMap = toDetachedMap(parsed, parsed.contents);
  if (!nodeMap) {
    throw new Error(`Copied YAML for node "${source.name}" is not a map`);
  }
  nodeMap.flow = false;

  applyPasteIdentity(doc, nodeMap, source.name, newName);
  fillUnresolved(doc, nodeMap, fallback);

  const key = doc.createNode(newName) as YAML.Scalar;
  if (source.comment !== undefined && source.comment.length > 0) {
    key.commentBefore = source.comment;
  }
  return new YAML.Pair(key, nodeMap);
}
