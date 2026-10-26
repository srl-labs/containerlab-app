// Where a topology YAML text refers to files on the lab host.
import * as YAML from "yaml";

import { bindSourcePath, type LabFileReferenceKind } from "../host/labFiles";

export interface LabFileReference {
  /** The value as written: a whole bind, a startup config or a license path. */
  value: string;
  kind: LabFileReferenceKind;
  /** The node the value belongs to; undefined in defaults, kinds and groups. */
  nodeName?: string;
  /** Offsets of the file path in the text: the host side of a bind, else the whole value. */
  start: number;
  end: number;
}

const FILE_KEYS = ["startup-config", "license"] as const;

function scalarReference(
  text: string,
  node: unknown,
  kind: LabFileReferenceKind,
  nodeName: string | undefined
): LabFileReference | undefined {
  if (!YAML.isScalar(node) || typeof node.value !== "string" || !node.range) return undefined;
  const value = node.value;
  const path = kind === "bind" ? bindSourcePath(value) : value.trim();
  if (path === undefined || path === "" || value.includes("\n")) return undefined;
  // Quotes and indentation sit between the node's start and its value.
  const offset = text.slice(node.range[0], node.range[1]).indexOf(path);
  if (offset < 0) return undefined;
  const start = node.range[0] + offset;
  return { value, kind, nodeName, start, end: start + path.length };
}

function collectBlock(
  text: string,
  block: unknown,
  nodeName: string | undefined,
  references: LabFileReference[]
): void {
  if (!YAML.isMap(block)) return;
  const binds = block.get("binds", true);
  if (YAML.isSeq(binds)) {
    for (const item of binds.items) {
      const reference = scalarReference(text, item, "bind", nodeName);
      if (reference) references.push(reference);
    }
  }
  for (const key of FILE_KEYS) {
    const reference = scalarReference(text, block.get(key, true), "file", nodeName);
    if (reference) references.push(reference);
  }
}

function collectNamedBlocks(
  text: string,
  blocks: unknown,
  asNodes: boolean,
  references: LabFileReference[]
): void {
  if (!YAML.isMap(blocks)) return;
  for (const pair of blocks.items) {
    const name = YAML.isScalar(pair.key) ? String(pair.key.value) : undefined;
    collectBlock(text, pair.value, asNodes ? name : undefined, references);
  }
}

/**
 * The binds, startup configs and licenses of nodes, kinds, groups and
 * defaults, in text order. Invalid YAML has none.
 */
export function findLabFileReferences(text: string): LabFileReference[] {
  if (!/\b(?:binds|startup-config|license)\s*:/.test(text)) return [];
  const doc = YAML.parseDocument(text);
  if (doc.errors.length > 0 || !YAML.isMap(doc.contents)) return [];
  const topology = doc.contents.get("topology", true);
  if (!YAML.isMap(topology)) return [];

  const references: LabFileReference[] = [];
  collectBlock(text, topology.get("defaults", true), undefined, references);
  collectNamedBlocks(text, topology.get("kinds", true), false, references);
  collectNamedBlocks(text, topology.get("groups", true), false, references);
  collectNamedBlocks(text, topology.get("nodes", true), true, references);
  return references.sort((left, right) => left.start - right.start);
}
