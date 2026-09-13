/**
 * AppContent helpers.
 */
import React from "react";

import type { TopoEdge, TopoNode } from "../../core/types/graph";
import { getRecordUnknown } from "../../core/utilities/typeHelpers";
import { convertToEditorData, convertToNetworkEditorData } from "../../core/utilities";
import {
  findEdgeAnnotationInLookup,
  type EdgeAnnotationLookup
} from "../../annotations/edgeAnnotations";
import { convertToLinkEditorData } from "../../utils/linkEditorConversions";
import { parseEndpointLabelOffset } from "../../annotations/endpointLabelOffset";

interface SelectionStateSlice {
  selectedNode: string | null;
  selectedEdge: string | null;
  editingImpairment: string | null;
  editingNode: string | null;
  editingEdge: string | null;
  editingNetwork: string | null;
  endpointLabelOffset: number;
}

type EdgeRawData = { id: string; source: string; target: string } & Record<string, unknown>;
type NodeRawData = { id: string } & Record<string, unknown>;

/** Extract edge raw data by ID */
function getEdgeRawData(edgeId: string | null, edges: TopoEdge[]): EdgeRawData | null {
  if (edgeId === null || edgeId.length === 0) return null;
  const edge = edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...getRecordUnknown(edge.data)
  };
}

function getNodeRawData(nodeId: string | null, nodes: TopoNode[]): NodeRawData | null {
  if (nodeId === null || nodeId.length === 0) return null;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const data = getRecordUnknown(node.data);
  if (data === undefined) {
    return { id: node.id };
  }
  return { id: node.id, ...data };
}

export function useCustomNodeErrorToast(
  customNodeError: unknown,
  addToast: (message: string, type?: "success" | "error" | "info", duration?: number) => void,
  clearCustomNodeError: () => void
): void {
  React.useEffect(() => {
    if (customNodeError === null || customNodeError === undefined) return;
    const errorMsg = typeof customNodeError === "string" ? customNodeError : "Unknown error";
    addToast(`Failed to save custom node: ${errorMsg}`, "error", 5000);
    clearCustomNodeError();
  }, [customNodeError, addToast, clearCustomNodeError]);
}

export function useFilteredGraphElements(
  nodes: TopoNode[],
  edges: TopoEdge[],
  showDummyLinks: boolean
): { filteredNodes: TopoNode[]; filteredEdges: TopoEdge[] } {
  const filteredNodes = React.useMemo(() => {
    if (showDummyLinks) return nodes;
    return nodes.filter((node) => !node.id.startsWith("dummy"));
  }, [nodes, showDummyLinks]);

  const filteredEdges = React.useMemo(() => {
    if (showDummyLinks) return edges;
    const dummyNodeIds = new Set(
      nodes.filter((node) => node.id.startsWith("dummy")).map((node) => node.id)
    );
    return edges.filter((edge) => !dummyNodeIds.has(edge.source) && !dummyNodeIds.has(edge.target));
  }, [nodes, edges, showDummyLinks]);

  return { filteredNodes, filteredEdges };
}

export function useSelectionData(
  state: SelectionStateSlice,
  nodes: TopoNode[],
  edges: TopoEdge[],
  edgeAnnotationLookup: EdgeAnnotationLookup
) {
  const selectedNodeData = React.useMemo(
    () => getNodeRawData(state.selectedNode, nodes),
    [state.selectedNode, nodes]
  );

  const selectedLinkData = React.useMemo(
    () => getEdgeRawData(state.selectedEdge, edges),
    [state.selectedEdge, edges]
  );

  const selectedLinkImpairmentData = React.useMemo(
    () => getEdgeRawData(state.editingImpairment, edges),
    [state.editingImpairment, edges]
  );

  const editingNodeRawData = React.useMemo(
    () => getNodeRawData(state.editingNode, nodes),
    [state.editingNode, nodes]
  );

  const editingNetworkRawData = React.useMemo(
    () => getNodeRawData(state.editingNetwork, nodes),
    [state.editingNetwork, nodes]
  );

  const editingLinkRawData = React.useMemo(
    () => getEdgeRawData(state.editingEdge, edges),
    [state.editingEdge, edges]
  );

  const editingNodeData = React.useMemo(
    () => convertToEditorData(editingNodeRawData),
    [editingNodeRawData]
  );
  const editingNodeInheritedProps = React.useMemo(() => {
    const extra = getRecordUnknown(editingNodeRawData?.["extraData"]);
    const inherited = extra?.inherited;
    return Array.isArray(inherited)
      ? inherited.filter((p): p is string => typeof p === "string")
      : [];
  }, [editingNodeRawData]);
  const editingNetworkData = React.useMemo(
    () => convertToNetworkEditorData(editingNetworkRawData),
    [editingNetworkRawData]
  );
  const editingLinkData = React.useMemo(() => {
    const base = convertToLinkEditorData(editingLinkRawData);
    if (!base) return null;
    const annotation = findEdgeAnnotationInLookup(edgeAnnotationLookup, {
      id: base.id,
      source: base.source,
      target: base.target,
      sourceEndpoint: base.sourceEndpoint,
      targetEndpoint: base.targetEndpoint
    });
    const offset =
      parseEndpointLabelOffset(annotation?.endpointLabelOffset) ?? state.endpointLabelOffset;
    const enabled =
      annotation?.endpointLabelOffsetEnabled ??
      (annotation?.endpointLabelOffset !== undefined ? true : false);
    return {
      ...base,
      endpointLabelOffsetEnabled: enabled,
      endpointLabelOffset: offset
    };
  }, [editingLinkRawData, edgeAnnotationLookup, state.endpointLabelOffset]);

  return {
    selectedNodeData,
    selectedLinkData,
    selectedLinkImpairmentData,
    editingNodeData,
    editingNetworkData,
    editingLinkData,
    editingNodeInheritedProps
  };
}
