/**
 * Annotation Save Helpers (Host-authoritative)
 */

import type { Node } from "@xyflow/react";

import type { EdgeAnnotation, TopologyAnnotations } from "../core/types/topology";
import type { TopologySessionClient } from "../session";

import { buildAnnotationNodesPayload } from "./annotationPayloads";
import { executeTopologyCommand, executeTopologyCommands } from "./topologyHostCommands";

const WARN_COMMAND_FAILED = "[Host] Annotation command failed";

export interface SaveAnnotationNodesOptions {
  /** Skip re-applying snapshot to avoid position snapback during continuous updates */
  applySnapshot?: boolean;
}

export async function saveAnnotationNodesFromGraph(
  client: TopologySessionClient,
  nodes?: Node[],
  options: SaveAnnotationNodesOptions = {}
): Promise<void> {
  try {
    await executeTopologyCommand(
      {
        command: "setAnnotations",
        payload: buildAnnotationNodesPayload(nodes)
      },
      { applySnapshot: options.applySnapshot ?? true },
      client
    );
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setAnnotations(annotationNodes)`, err);
  }
}

export async function saveAnnotationNodesWithMemberships(
  client: TopologySessionClient,
  memberships: Array<{ id: string; groupId?: string }>,
  nodes?: Node[]
): Promise<void> {
  try {
    await executeTopologyCommand({
      command: "setAnnotationsWithMemberships",
      payload: {
        annotations: buildAnnotationNodesPayload(nodes),
        memberships: memberships.map((m) => ({ nodeId: m.id, groupId: m.groupId ?? null }))
      }
    }, {}, client);
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setAnnotationsWithMemberships`, err);
  }
}

export async function saveEdgeAnnotations(
  client: TopologySessionClient,
  annotations: EdgeAnnotation[]
): Promise<void> {
  try {
    await executeTopologyCommand({ command: "setEdgeAnnotations", payload: annotations }, {}, client);
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setEdgeAnnotations`, err);
  }
}

export async function saveViewerSettings(
  client: TopologySessionClient,
  settings: NonNullable<TopologyAnnotations["viewerSettings"]>
): Promise<void> {
  try {
    await executeTopologyCommand({ command: "setViewerSettings", payload: settings }, {}, client);
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setViewerSettings`, err);
  }
}

export async function saveAnnotationNodesAndViewerSettings(
  client: TopologySessionClient,
  nodes: Node[],
  settings: NonNullable<TopologyAnnotations["viewerSettings"]>
): Promise<void> {
  try {
    await executeTopologyCommands(
      [
        {
          command: "setAnnotations",
          payload: buildAnnotationNodesPayload(nodes)
        },
        {
          command: "setViewerSettings",
          payload: settings
        }
      ],
      {},
      client
    );
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setAnnotations + setViewerSettings`, err);
  }
}

export async function saveAllNodeGroupMemberships(
  client: TopologySessionClient,
  memberships: Array<{ id: string; groupId?: string }>
): Promise<void> {
  try {
    // Avoid snapshot re-apply here to prevent position snapback when membership changes
    // are sent separately from position saves during drag/drop.
    await executeTopologyCommand(
      {
        command: "setNodeGroupMemberships",
        payload: memberships.map((m) => ({ nodeId: m.id, groupId: m.groupId ?? null }))
      },
      { applySnapshot: false },
      client
    );
  } catch (err) {
    console.error(`${WARN_COMMAND_FAILED}: setNodeGroupMemberships`, err);
  }
}
