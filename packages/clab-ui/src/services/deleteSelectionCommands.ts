/**
 * Pure helpers for batch-deleting the current canvas selection: collect the
 * selected ids, split them by node kind, apply local graph deletions, and
 * build the topology-host commands that persist the result.
 */
import type { TopoEdge, TopoNode, TopologyHostCommand } from "../core/types";
import {
  FREE_TEXT_NODE_TYPE,
  FREE_SHAPE_NODE_TYPE,
  TRAFFIC_RATE_NODE_TYPE,
  GROUP_NODE_TYPE,
  nodesToAnnotations,
  collectNodeGroupMemberships
} from "../annotations";
import { toLinkSaveData } from "./linkSaveData";

export interface DeleteMenuHandlers {
  handleDeleteNode: (nodeId: string) => void;
  handleDeleteLink: (edgeId: string) => void;
}

export interface DeleteGraphActions {
  removeNodeAndEdges: (nodeId: string) => void;
  removeEdge: (edgeId: string) => void;
}

export function collectSelectedIds(
  nodes: Array<{ id: string; selected?: boolean }>,
  edges: Array<{ id: string; selected?: boolean }>,
  selectedNodeId?: string | null,
  selectedEdgeId?: string | null
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set(nodes.filter((node) => node.selected === true).map((node) => node.id));
  const edgeIds = new Set(edges.filter((edge) => edge.selected === true).map((edge) => edge.id));

  if (selectedNodeId != null && selectedNodeId.length > 0) nodeIds.add(selectedNodeId);
  if (selectedEdgeId != null && selectedEdgeId.length > 0) edgeIds.add(selectedEdgeId);

  return { nodeIds, edgeIds };
}

export function splitNodeIdsByType(
  nodeIds: Set<string>,
  nodesById: Map<string, { type?: string }>
): {
  graphNodeIds: string[];
  groupIds: string[];
  textIds: string[];
  shapeIds: string[];
  trafficRateIds: string[];
} {
  const graphNodeIds: string[] = [];
  const groupIds: string[] = [];
  const textIds: string[] = [];
  const shapeIds: string[] = [];
  const trafficRateIds: string[] = [];

  for (const nodeId of nodeIds) {
    const node = nodesById.get(nodeId);
    if (!node) continue;
    switch (node.type) {
      case GROUP_NODE_TYPE:
        groupIds.push(nodeId);
        break;
      case FREE_TEXT_NODE_TYPE:
        textIds.push(nodeId);
        break;
      case FREE_SHAPE_NODE_TYPE:
        shapeIds.push(nodeId);
        break;
      case TRAFFIC_RATE_NODE_TYPE:
        trafficRateIds.push(nodeId);
        break;
      default:
        graphNodeIds.push(nodeId);
    }
  }

  return { graphNodeIds, groupIds, textIds, shapeIds, trafficRateIds };
}

export function applyGraphDeletions(
  graphActions: DeleteGraphActions,
  menuHandlers: DeleteMenuHandlers,
  graphNodeIds: string[],
  edgeIds: Set<string>
): void {
  for (const nodeId of graphNodeIds) {
    graphActions.removeNodeAndEdges(nodeId);
    menuHandlers.handleDeleteNode(nodeId);
  }

  for (const edgeId of edgeIds) {
    graphActions.removeEdge(edgeId);
    menuHandlers.handleDeleteLink(edgeId);
  }
}

export function buildDeleteCommands(
  graphNodeIds: string[],
  edgeIds: Set<string>,
  edgesById: Map<string, TopoEdge>
): TopologyHostCommand[] {
  const commands: TopologyHostCommand[] = [];

  for (const nodeId of graphNodeIds) {
    commands.push({ command: "deleteNode", payload: { id: nodeId } });
  }

  for (const edgeId of edgeIds) {
    const edge = edgesById.get(edgeId);
    if (!edge) continue;
    commands.push({ command: "deleteLink", payload: toLinkSaveData(edge) });
  }

  return commands;
}

export function buildAnnotationSaveCommand(graphNodesForSave: TopoNode[]): TopologyHostCommand {
  const { freeTextAnnotations, freeShapeAnnotations, trafficRateAnnotations, groups } =
    nodesToAnnotations(graphNodesForSave);
  const memberships = collectNodeGroupMemberships(graphNodesForSave);

  return {
    command: "setAnnotationsWithMemberships",
    payload: {
      annotations: {
        freeTextAnnotations,
        freeShapeAnnotations,
        trafficRateAnnotations,
        groupStyleAnnotations: groups
      },
      memberships: memberships.map((entry) => ({
        nodeId: entry.id,
        groupId: entry.groupId
      }))
    }
  };
}
