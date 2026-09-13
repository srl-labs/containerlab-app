/**
 * Utility functions for bulk link creation
 * Uses React Flow nodes/edges arrays for graph queries.
 */
import { FilterUtils } from "../../../utils/filterUtils";
import { isSpecialEndpointId } from "../../../core/utilities/LinkTypes";
import type { TopoNode, TopoEdge } from "../../../core/types/graph";
import { allocateEndpoint, type EndpointAllocator } from "../../../utils/endpointAllocator";

export type LinkCandidate = { sourceId: string; targetId: string };

function getNodeLabel(node: TopoNode): string {
  const data = node.data;
  const label: unknown = Reflect.get(data, "label");
  return typeof label === "string" && label.length > 0 ? label : node.id;
}

function applyBackreferences(pattern: string, match: RegExpMatchArray | null): string {
  if (!pattern) return pattern;

  return pattern.replace(
    /\$\$|\$<([^>]+)>|\$(\d+)/g,
    (fullMatch: string, namedGroup?: string, numberedGroup?: string) => {
      if (fullMatch === "$$") return "$";
      if (!match) return fullMatch;

      if (fullMatch.startsWith("$<")) {
        if (
          namedGroup !== undefined &&
          namedGroup.length > 0 &&
          match.groups &&
          Object.prototype.hasOwnProperty.call(match.groups, namedGroup)
        ) {
          return match.groups[namedGroup] ?? "";
        }
        return fullMatch;
      }

      if (numberedGroup !== undefined && numberedGroup.length > 0) {
        const index = Number(numberedGroup);
        if (!Number.isNaN(index) && index < match.length) {
          return match[index] ?? "";
        }
        return fullMatch;
      }

      return fullMatch;
    }
  );
}

function getSourceMatch(
  name: string,
  sourceRegex: RegExp | null,
  fallbackFilter: ReturnType<typeof FilterUtils.createFilter> | null
): RegExpMatchArray | null | undefined {
  if (sourceRegex) {
    const execResult = sourceRegex.exec(name);
    return execResult ?? undefined;
  }

  if (!fallbackFilter) return null;
  return fallbackFilter(name) ? null : undefined;
}

/** Build target name matcher with backreference support (resolved once per source match) */
function buildTargetMatcher(
  targetFilterText: string,
  targetRegex: RegExp | null,
  targetFallbackFilter: (value: string) => boolean,
  sourceMatch: RegExpMatchArray | null
): (targetName: string) => boolean {
  if (targetRegex && sourceMatch) {
    // Apply backreferences from source match
    const expandedPattern = applyBackreferences(targetFilterText, sourceMatch);
    const expandedRegex = FilterUtils.tryCreateRegExp(expandedPattern);
    if (expandedRegex) {
      return (targetName: string) => expandedRegex.test(targetName);
    }
    return () => false;
  }
  return targetFallbackFilter;
}

/** Index existing edges by node id for O(1) pair lookups (both directions) */
function buildEdgeAdjacency(edges: TopoEdge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const add = (from: string, to: string): void => {
    let neighbors = adjacency.get(from);
    if (!neighbors) {
      neighbors = new Set<string>();
      adjacency.set(from, neighbors);
    }
    neighbors.add(to);
  };
  for (const edge of edges) {
    add(edge.source, edge.target);
    add(edge.target, edge.source);
  }
  return adjacency;
}

/** Process a single target node for potential link candidate */
function processTargetNode(
  sourceId: string,
  targetNode: TopoNode,
  targetName: string,
  matchesTarget: (targetName: string) => boolean,
  edgeAdjacency: Map<string, Set<string>>,
  candidates: LinkCandidate[]
): void {
  const targetId = targetNode.id;
  if (sourceId === targetId) return; // Skip self-loops

  if (!matchesTarget(targetName)) return;
  if (edgeAdjacency.get(sourceId)?.has(targetId) === true) return;

  candidates.push({ sourceId, targetId });
}

/**
 * Compute candidate link pairs between source and target nodes.
 * Uses React Flow nodes/edges arrays for graph queries.
 */
export function computeCandidates(
  nodes: TopoNode[],
  edges: TopoEdge[],
  sourceFilterText: string,
  targetFilterText: string
): LinkCandidate[] {
  const candidates: LinkCandidate[] = [];

  // Build source filter
  const sourceRegex = FilterUtils.tryCreateRegExp(sourceFilterText);
  const sourceFallbackFilter = sourceRegex ? null : FilterUtils.createFilter(sourceFilterText);

  // Build target filter (with backreference support)
  const targetRegex = FilterUtils.tryCreateRegExp(targetFilterText);
  const targetFallbackFilter = FilterUtils.createFilter(targetFilterText);

  // Index existing edges once instead of rescanning them per node pair
  const edgeAdjacency = buildEdgeAdjacency(edges);

  // Filter topology nodes (exclude network nodes) and cache their labels
  const topologyNodes = nodes.filter((node) => node.type === "topology-node");
  const nodeLabels = topologyNodes.map((node) => getNodeLabel(node));

  for (let i = 0; i < topologyNodes.length; i++) {
    const sourceId = topologyNodes[i].id;
    const sourceName = nodeLabels[i];

    // Check if source matches filter
    const sourceMatch = getSourceMatch(sourceName, sourceRegex, sourceFallbackFilter);
    if (sourceMatch === undefined) continue; // No match

    // Resolve the target matcher once per source (backreferences depend on the source match)
    const matchesTarget = buildTargetMatcher(
      targetFilterText,
      targetRegex,
      targetFallbackFilter,
      sourceMatch
    );

    // Process all potential target nodes
    for (let j = 0; j < topologyNodes.length; j++) {
      processTargetNode(
        sourceId,
        topologyNodes[j],
        nodeLabels[j],
        matchesTarget,
        edgeAdjacency,
        candidates
      );
    }
  }

  return candidates;
}

/**
 * Build edge elements for bulk link creation.
 * Uses React Flow nodes/edges arrays for endpoint allocation.
 */
export function buildBulkEdges(
  nodes: TopoNode[],
  edges: TopoEdge[],
  candidates: LinkCandidate[]
): TopoEdge[] {
  const allocators = new Map<string, EndpointAllocator>();
  const result: TopoEdge[] = [];

  for (const { sourceId, targetId } of candidates) {
    const sourceEndpoint = allocateEndpoint(allocators, nodes, edges, sourceId);
    const targetEndpoint = allocateEndpoint(allocators, nodes, edges, targetId);

    const edgeId = `${sourceId}:${sourceEndpoint}--${targetId}:${targetEndpoint}`;
    const isSpecialLink = isSpecialEndpointId(sourceId) || isSpecialEndpointId(targetId);
    result.push({
      id: edgeId,
      source: sourceId,
      target: targetId,
      type: "topology-edge",
      data: {
        sourceEndpoint,
        targetEndpoint,
        isSpecialLink
      }
    });
  }

  return result;
}
