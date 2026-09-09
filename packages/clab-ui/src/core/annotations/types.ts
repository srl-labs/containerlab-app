/**
 * Annotation type definitions for the shared annotations module.
 * Types are available from shared/types/topology directly.
 */

import type { TopologyAnnotations as _TopologyAnnotations } from "../types/topology";

export type TopologyAnnotations = _TopologyAnnotations;

/**
 * Default empty annotations object.
 */
export function createEmptyAnnotations(): TopologyAnnotations {
  return {
    freeTextAnnotations: [],
    freeShapeAnnotations: [],
    trafficRateAnnotations: [],
    groupStyleAnnotations: [],
    networkNodeAnnotations: [],
    nodeAnnotations: [],
    edgeAnnotations: [],
    aliasEndpointAnnotations: [],
    viewerSettings: {}
  };
}
