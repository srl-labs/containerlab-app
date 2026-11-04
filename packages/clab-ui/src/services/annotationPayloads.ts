import type { Node } from "@xyflow/react";

import type { TopologyAnnotations } from "../core/types/topology";
import { nodesToAnnotations } from "../annotations/annotationNodeConverters";
import { useGraphStore } from "../stores/graphStore";

type AnnotationPayloadKeys =
  | "freeTextAnnotations"
  | "freeShapeAnnotations"
  | "trafficRateAnnotations"
  | "scriptButtonAnnotations"
  | "groupStyleAnnotations";

export type AnnotationNodesPayload = Pick<TopologyAnnotations, AnnotationPayloadKeys>;

export function buildAnnotationNodesPayload(nodes?: Node[]): AnnotationNodesPayload {
  const graphNodes = nodes ?? useGraphStore.getState().nodes;
  const {
    freeTextAnnotations,
    freeShapeAnnotations,
    trafficRateAnnotations,
    scriptButtonAnnotations,
    groups
  } = nodesToAnnotations(graphNodes);

  return {
    freeTextAnnotations,
    freeShapeAnnotations,
    trafficRateAnnotations,
    scriptButtonAnnotations,
    groupStyleAnnotations: groups
  };
}
