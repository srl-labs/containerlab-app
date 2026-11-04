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
    scriptButtonAnnotations: [],
    groupStyleAnnotations: [],
    networkNodeAnnotations: [],
    nodeAnnotations: [],
    edgeAnnotations: [],
    aliasEndpointAnnotations: [],
    viewerSettings: {}
  };
}

/**
 * Annotations for a lab without an annotations file. New labs start with boxed nodes;
 * an existing file that sets no node style keeps the icon style.
 */
export function createNewLabAnnotations(): TopologyAnnotations {
  return { ...createEmptyAnnotations(), viewerSettings: { nodeStyle: "boxed" } };
}
