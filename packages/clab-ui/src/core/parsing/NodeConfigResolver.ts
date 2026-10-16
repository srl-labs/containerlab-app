/**
 * Node configuration resolver for Containerlab inheritance.
 * Pure functions - no VS Code dependencies.
 */

import type { ClabTopology, ClabNode } from "../types/topology";
import { isRecord } from "../utilities/typeHelpers";

/** Node data key with the level each inherited value comes from. */
export const INHERITED_FROM_KEY = "inheritedFrom";

export type InheritanceLevel = "defaults" | "kind" | "group";

/**
 * Gets a section from the topology configuration.
 */
function getSection(
  source: Record<string, ClabNode> | undefined,
  key: string | undefined
): ClabNode {
  if (source === undefined || key === undefined || key.length === 0) return {};
  return source[key] ?? {};
}

/**
 * Resolves the kind name through inheritance.
 */
function resolveKindName(
  node: ClabNode,
  groupCfg: ClabNode,
  defaults: ClabNode
): string | undefined {
  return node.kind ?? groupCfg.kind ?? defaults.kind;
}

/**
 * Merges node labels from multiple sources.
 */
function mergeNodeLabels(...labels: unknown[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const label of labels) {
    if (!isRecord(label)) continue;
    Object.assign(merged, label);
  }
  return merged;
}

/**
 * Applies Containerlab inheritance rules to compute the effective
 * configuration for a node. The precedence order is:
 * node -> group -> kind -> defaults.
 */
export function resolveNodeConfig(parsed: ClabTopology, node: ClabNode): ClabNode {
  const { defaults = {}, groups, kinds } = parsed.topology ?? {};

  const groupCfg = getSection(groups, node.group);
  const kindName = resolveKindName(node, groupCfg, defaults);
  const kindCfg = getSection(kinds, kindName);

  return {
    ...defaults,
    ...kindCfg,
    ...groupCfg,
    ...node,
    kind: kindName,
    labels: mergeNodeLabels(defaults.labels, kindCfg.labels, groupCfg.labels, node.labels)
  };
}

/**
 * For every key the node inherits, the level it comes from. Follows the same
 * precedence as resolveNodeConfig: group, then kind, then defaults.
 */
export function resolveInheritedFrom(
  parsed: ClabTopology,
  node: ClabNode
): Record<string, InheritanceLevel> {
  const { defaults = {}, groups, kinds } = parsed.topology ?? {};
  const groupCfg = getSection(groups, node.group);
  const kindCfg = getSection(kinds, resolveKindName(node, groupCfg, defaults));
  const levels: Array<[InheritanceLevel, ClabNode]> = [
    ["group", groupCfg],
    ["kind", kindCfg],
    ["defaults", defaults]
  ];
  const result: Record<string, InheritanceLevel> = {};
  for (const [level, section] of levels) {
    for (const key of Object.keys(section)) {
      if (!(key in node) && !(key in result)) result[key] = level;
    }
  }
  return result;
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
  const { defaults = {}, groups, kinds } = parsed.topology ?? {};
  const groupCfg = getSection(groups, node.group);
  const kindCfg = getSection(kinds, resolveKindName(node, groupCfg, defaults));
  const levels: Array<[InheritanceLevel, ClabNode]> = [
    ["defaults", defaults],
    ["kind", kindCfg],
    ["group", groupCfg]
  ];
  const result: Array<{ level: InheritanceLevel; stages: Record<string, unknown> }> = [];
  for (const [level, section] of levels) {
    if (isRecord(section.stages)) result.push({ level, stages: section.stages });
  }
  return result;
}
