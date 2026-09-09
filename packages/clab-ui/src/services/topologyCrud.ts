/**
 * Topology CRUD Helpers (Host-authoritative)
 *
 * Dispatches topology commands to the host and applies snapshots.
 */

import type { Node } from "@xyflow/react";

import type { NodeSaveData } from "../core/io/NodePersistenceIO";
import type { LinkSaveData } from "../core/io/LinkPersistenceIO";
import type { TopologySessionClient } from "../session";
import type { TopologyHostCommand } from "../core/types/messages";
import { collectNodeGroupMemberships } from "../annotations/groupMembership";
import { useGraphStore } from "../stores/graphStore";
import { buildNetworkNodeAnnotations } from "../utils/networkNodeAnnotations";

import { buildAnnotationNodesPayload } from "./annotationPayloads";
import { executeTopologyCommand } from "./topologyHostCommands";

// Re-export types for convenience
export type { NodeSaveData, LinkSaveData };

const WARN_COMMAND_FAILED = "[Host] Topology command failed";

export { buildNetworkNodeAnnotations };

export interface NodePositionSaveEntry {
  id: string;
  position?: { x: number; y: number };
  geoCoordinates?: { lat: number; lng: number };
}

export function buildSavePositionsCommand(
  positions: NodePositionSaveEntry[]
): Extract<TopologyHostCommand, { command: "savePositions" }> {
  return { command: "savePositions", payload: positions };
}

export async function createNode(
  client: TopologySessionClient,
  nodeData: NodeSaveData
): Promise<void> {
  try {
    await executeTopologyCommand({ command: "addNode", payload: nodeData }, {}, client);
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: addNode`, err);
  }
}

export async function deleteNode(
  client: TopologySessionClient,
  nodeId: string
): Promise<void> {
  try {
    await executeTopologyCommand({ command: "deleteNode", payload: { id: nodeId } }, {}, client);
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: deleteNode`, err);
  }
}

export async function createLink(
  client: TopologySessionClient,
  linkData: LinkSaveData
): Promise<void> {
  try {
    await executeTopologyCommand({ command: "addLink", payload: linkData }, {}, client);
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: addLink`, err);
  }
}

export async function deleteLink(
  client: TopologySessionClient,
  linkData: LinkSaveData
): Promise<void> {
  try {
    await executeTopologyCommand({ command: "deleteLink", payload: linkData }, {}, client);
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: deleteLink`, err);
  }
}

/**
 * Persist network nodes (non-bridge types) via annotations.
 * Assumes the graph store already contains the latest network nodes.
 */
export async function saveNetworkNodesFromGraph(
  client: TopologySessionClient,
  nodes?: Node[]
): Promise<void> {
  try {
    const graphNodes = nodes ?? useGraphStore.getState().nodes;
    const annotations = buildNetworkNodeAnnotations(graphNodes);
    await executeTopologyCommand({
      command: "setAnnotations",
      payload: { networkNodeAnnotations: annotations }
    }, {}, client);
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setAnnotations(networkNodeAnnotations)`, err);
  }
}

/**
 * Save node positions via host command.
 * Note: We set applySnapshot: false because position-only changes should not
 * trigger a full topology reload, which would reset geo-mode positions.
 */
export async function saveNodePositions(
  client: TopologySessionClient,
  positions: NodePositionSaveEntry[]
): Promise<void> {
  try {
    await executeTopologyCommand(
      buildSavePositionsCommand(positions),
      { applySnapshot: false },
      client
    );
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: savePositions`, err);
  }
}

/**
 * Save node positions and annotation nodes in a single host command.
 * This keeps related moves (e.g., groups + members) as one undo entry.
 */
export async function saveNodePositionsWithAnnotations(
  client: TopologySessionClient,
  positions: NodePositionSaveEntry[],
  nodes?: Node[]
): Promise<void> {
  try {
    await executeTopologyCommand(
      {
        command: "savePositionsAndAnnotations",
        payload: {
          positions,
          annotations: buildAnnotationNodesPayload(nodes)
        }
      },
      { applySnapshot: false },
      client
    );
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: savePositionsAndAnnotations`, err);
  }
}

/**
 * Save node positions + group memberships as a single batch command (one undo entry).
 * Used when a node drag may change group membership.
 */
export async function saveNodePositionsWithMemberships(
  client: TopologySessionClient,
  positions: NodePositionSaveEntry[]
): Promise<void> {
  try {
    const memberships = collectNodeGroupMemberships(useGraphStore.getState().nodes);
    await executeTopologyCommand(
      {
        command: "batch",
        payload: {
          commands: [
            { command: "savePositions", payload: positions },
            {
              command: "setNodeGroupMemberships",
              payload: memberships.map((m) => ({ nodeId: m.id, groupId: m.groupId }))
            }
          ]
        }
      },
      { applySnapshot: false },
      client
    );
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: savePositionsWithMemberships(batch)`, err);
  }
}
