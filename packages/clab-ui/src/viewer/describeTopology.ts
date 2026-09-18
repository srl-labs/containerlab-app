import { isMap, isNode, LineCounter, parseDocument } from "yaml";
import type { ClabTopology } from "../core/types/topology";
import type { ViewerNodeInfo } from "./publicTypes";

export type { ViewerNodeInfo } from "./publicTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function sourceLines(key: unknown, value: unknown, counter: LineCounter) {
  const keyRange = isNode(key) ? key.range : undefined;
  const valueRange = isNode(value) ? value.range : undefined;
  const start = keyRange?.[0] ?? 0;
  const end = valueRange?.[1] ?? keyRange?.[1] ?? start;
  return {
    startLine: counter.linePos(start).line,
    endLine: counter.linePos(Math.max(start, end - 1)).line
  };
}

/** Source ranges come from the YAML parser, including quoted names and flow mappings. */
export function describeTopology(source: string): { nodes: ViewerNodeInfo[]; links: number } {
  return parseViewerSource(source).description;
}

/** Parse once for both the graph and its source-linked inspector. */
export function parseViewerSource(source: string) {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter, merge: true });
  if (document.errors.length > 0) throw new Error(document.errors[0].message);
  const data: unknown = document.toJS({ maxAliasCount: 100 });
  const topology = record(record(data).topology);
  const nodeMap = document.getIn(["topology", "nodes"], true);
  if (!isMap(nodeMap) || nodeMap.items.length === 0) {
    throw new Error("Add a topology.nodes mapping with at least one node.");
  }
  const nodeDefinitions = record(topology.nodes);
  const defaults = record(topology.defaults);
  const kinds = record(topology.kinds);
  const nodes = nodeMap.items.map((pair) => {
    const id = String(pair.key);
    const node = record(nodeDefinitions[id]);
    const kind = String(node.kind ?? defaults.kind ?? "unspecified");
    const image = String(node.image ?? record(kinds[kind]).image ?? defaults.image ?? "");
    return {
      id, kind, image,
      ...sourceLines(pair.key, pair.value, lineCounter)
    };
  });
  return {
    topology: data as ClabTopology,
    description: { nodes, links: Array.isArray(topology.links) ? topology.links.length : 0 }
  };
}
