/**
 * Shared Topology Parser
 *
 * This module provides a VS Code-free topology parser that can be used by both
 * the production extension and the dev server. It converts containerlab YAML
 * topologies to ReactFlow nodes and edges.
 *
 * @example Basic usage (dev server)
 * ```typescript
 * import { TopologyParser } from '@shared/parsing';
 * const result = TopologyParser.parseToReactFlow(yamlContent, { annotations });
 * // result.topology contains { nodes: TopoNode[], edges: TopoEdge[] }
 * ```
 *
 * @example With container enrichment (VS Code extension)
 * ```typescript
 * import { TopologyParser } from '@shared/parsing';
 * import { ContainerDataAdapter } from './ContainerDataAdapter';
 *
 * const adapter = new ContainerDataAdapter(clabTreeData);
 * const result = TopologyParser.parseToReactFlow(yamlContent, {
 *   annotations,
 *   containerDataProvider: adapter,
 *   logger: vscodeLogger
 * });
 * ```
 *
 * For internal utilities, import directly from sub-modules:
 * - `./NodeElementBuilder` - node element building
 * - `./EdgeElementBuilder` - edge element building
 * - `./SpecialNodeHandler` - special node handling (host, mgmt, vxlan)
 * - `./AliasNodeHandler` - bridge alias handling
 * - `./LinkNormalizer` - link endpoint normalization
 * - `./DistributedSrosMapper` - SR OS distributed interface mapping
 * - `./GraphLabelMigrator` - graph label migration
 */

// Re-export topology types for convenience
export type { NetemState } from "./types";
