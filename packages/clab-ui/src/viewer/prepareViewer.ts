import { TopologyParser } from "../core/parsing/TopologyParser";
import { applyGraphLabelMigrations } from "../core/parsing/GraphLabelMigrator";
import type { TopologySnapshot } from "../core/types/messages";
import type { TopologyAnnotations } from "../core/types/topology";
import { isRecord } from "../core/utilities/typeHelpers";
import { migrateGeneratedNetworkNodeAnnotations } from "../core/io/TopologyIO";
import { parseViewerSource } from "./describeTopology";
import { buildEdgeAnnotationLookup, findEdgeAnnotationInLookup } from "../annotations/edgeAnnotations";
import { DEFAULT_ENDPOINT_LABEL_OFFSET, parseEndpointLabelOffset } from "../annotations/endpointLabelOffset";

function isAnnotations(value: unknown): value is TopologyAnnotations {
  if (!isRecord(value)) return false;
  const arrays = ["nodeAnnotations", "networkNodeAnnotations", "edgeAnnotations", "aliasEndpointAnnotations", "groupStyleAnnotations", "freeTextAnnotations", "freeShapeAnnotations", "trafficRateAnnotations"];
  return arrays.every(key => value[key] === undefined || (Array.isArray(value[key]) && value[key].every(isRecord))) &&
    (value.viewerSettings === undefined || isRecord(value.viewerSettings));
}

/** The same graph parser and legacy graph labels as the editor, with no host or file I/O. */
export function prepareViewer(yaml: string, annotationsSource?: string) {
  const { topology, description } = parseViewerSource(yaml);
  const value: unknown = annotationsSource !== undefined && annotationsSource.trim() !== "" ? JSON.parse(annotationsSource) : {};
  if (!isAnnotations(value)) throw new Error("Topology annotations must be a JSON object with annotation arrays");
  migrateGeneratedNetworkNodeAnnotations(value, new Set(Object.keys(topology.topology?.nodes ?? {})));
  const parsed = TopologyParser.parseToReactFlowFromParsed(topology, { annotations: value });
  const annotations = applyGraphLabelMigrations(value, parsed.graphLabelMigrations);
  const edgeAnnotations = buildEdgeAnnotationLookup(annotations.edgeAnnotations);
  const defaultOffset = parseEndpointLabelOffset(annotations.viewerSettings?.endpointLabelOffset) ?? DEFAULT_ENDPOINT_LABEL_OFFSET;
  const edges = parsed.topology.edges.map(edge => {
    const data = edge.data;
    if (data === undefined) return edge;
    const annotation = findEdgeAnnotationInLookup(edgeAnnotations, {
      id: edge.id, source: edge.source, target: edge.target,
      sourceEndpoint: data.sourceEndpoint, targetEndpoint: data.targetEndpoint
    });
    const enabled = annotation?.endpointLabelOffsetEnabled ?? true;
    return {
      ...edge,
      data: {
        ...data,
        endpointLabelOffsetEnabled: enabled,
        endpointLabelOffset: enabled ? (parseEndpointLabelOffset(annotation?.endpointLabelOffset) ?? defaultOffset) : 0
      }
    };
  });
  const snapshot: TopologySnapshot = {
    revision: 1,
    ...parsed.topology,
    edges,
    annotations,
    yamlFileName: "topology.clab.yml",
    annotationsFileName: "topology.clab.yml.annotations.json",
    yamlContent: yaml,
    annotationsContent: annotationsSource ?? "{}",
    labName: parsed.labName,
    mode: "view",
    deploymentState: "undeployed",
    canUndo: false,
    canRedo: false
  };
  return { snapshot, description };
}
