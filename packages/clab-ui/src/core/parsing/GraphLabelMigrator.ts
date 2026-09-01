/**
 * Graph label migrator for detecting and converting graph-* YAML labels to annotations.
 * Pure functions - no VS Code dependencies, no I/O.
 */

import type { ClabTopology, TopologyAnnotations, NodeAnnotation } from "../types/topology";
import { createEmptyAnnotations } from "../annotations/types";
import { getRecordUnknown, getString } from "../utilities/typeHelpers";

import type { GraphLabelMigration } from "./types";

// ============================================================================
// Detection
// ============================================================================

/** graph-* label keys that trigger migration to annotations */
const GRAPH_LABEL_KEYS = [
  "graph-posX",
  "graph-posY",
  "graph-icon",
  "graph-group",
  "graph-level",
  "graph-groupLabelPos",
  "graph-geoCoordinateLat",
  "graph-geoCoordinateLng"
] as const;

/**
 * Checks if a node has graph-* labels that need migration.
 */
function nodeHasGraphLabels(labels: Record<string, unknown> | undefined): boolean {
  if (labels === undefined) return false;
  return GRAPH_LABEL_KEYS.some((key) => labels[key] !== undefined && labels[key] !== null);
}

function getNonEmptyLabel(labels: Record<string, unknown>, key: string): string | undefined {
  const value = getString(labels[key]);
  if (value === undefined || value === "") return undefined;
  return value;
}

function parseNumericPair(
  first: string | undefined,
  second: string | undefined
): { first: number; second: number } | undefined {
  if (first === undefined || second === undefined) return undefined;
  return {
    first: Number.parseFloat(first) || 0,
    second: Number.parseFloat(second) || 0
  };
}

// ============================================================================
// Migration Building
// ============================================================================

/**
 * Builds an annotation object from graph-* labels.
 */
function buildAnnotationFromLabels(
  nodeName: string,
  labels: Record<string, unknown>
): GraphLabelMigration | null {
  if (!nodeHasGraphLabels(labels)) return null;
  const posPair = parseNumericPair(
    getNonEmptyLabel(labels, "graph-posX"),
    getNonEmptyLabel(labels, "graph-posY")
  );
  const geoPair = parseNumericPair(
    getNonEmptyLabel(labels, "graph-geoCoordinateLat"),
    getNonEmptyLabel(labels, "graph-geoCoordinateLng")
  );
  const icon = getNonEmptyLabel(labels, "graph-icon");
  const group = getNonEmptyLabel(labels, "graph-group");
  const level = getNonEmptyLabel(labels, "graph-level");
  const groupLabelPos = getNonEmptyLabel(labels, "graph-groupLabelPos");

  return {
    nodeId: nodeName,
    ...(posPair !== undefined ? { position: { x: posPair.first, y: posPair.second } } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(group !== undefined ? { group } : {}),
    ...(level !== undefined ? { level } : {}),
    ...(groupLabelPos !== undefined ? { groupLabelPos } : {}),
    ...(geoPair !== undefined
      ? { geoCoordinates: { lat: geoPair.first, lng: geoPair.second } }
      : {})
  };
}

/**
 * Converts a GraphLabelMigration to a NodeAnnotation.
 */
function migrationToNodeAnnotation(migration: GraphLabelMigration): NodeAnnotation {
  const annotation: NodeAnnotation = { id: migration.nodeId };
  if (migration.position) {
    annotation.position = migration.position;
  }
  if (migration.icon !== undefined && migration.icon !== "") {
    annotation.icon = migration.icon;
  }
  if (migration.group !== undefined && migration.group !== "") {
    annotation.group = migration.group;
  }
  if (migration.level !== undefined && migration.level !== "") {
    annotation.level = migration.level;
  }
  if (migration.groupLabelPos !== undefined && migration.groupLabelPos !== "") {
    annotation.groupLabelPos = migration.groupLabelPos;
  }
  if (migration.geoCoordinates) {
    annotation.geoCoordinates = migration.geoCoordinates;
  }
  return annotation;
}

// ============================================================================
// Detection and Collection
// ============================================================================

/**
 * Detects graph-* label migrations needed for a topology.
 * Returns migrations for nodes that have graph-* labels but no existing annotation.
 */
export function detectGraphLabelMigrations(
  parsed: ClabTopology,
  annotations?: TopologyAnnotations
): GraphLabelMigration[] {
  const migrations: GraphLabelMigration[] = [];
  const nodes = parsed.topology?.nodes;
  if (!nodes) return migrations;

  const existingAnnotations = new Set(annotations?.nodeAnnotations?.map((na) => na.id) ?? []);

  for (const [nodeName, nodeObj] of Object.entries(nodes)) {
    // Skip if node already has an annotation
    if (existingAnnotations.has(nodeName)) continue;
    // Skip if node has no graph-* labels
    const nodeRecord = getRecordUnknown(nodeObj);
    if (nodeRecord === undefined) continue;
    const labels = getRecordUnknown(nodeRecord.labels);
    if (labels === undefined) continue;
    if (!nodeHasGraphLabels(labels)) continue;

    const migration = buildAnnotationFromLabels(nodeName, labels);
    if (migration) {
      migrations.push(migration);
    }
  }

  return migrations;
}

/**
 * Creates base annotations from existing annotations.
 */
function createBaseAnnotations(annotations: TopologyAnnotations | undefined): TopologyAnnotations {
  const base = createEmptyAnnotations();
  if (!annotations) return base;
  const nodeAnnotations = annotations.nodeAnnotations ?? base.nodeAnnotations ?? [];
  return {
    ...base,
    ...annotations,
    nodeAnnotations: [...nodeAnnotations]
  };
}

/**
 * Applies graph label migrations to annotations.
 * Returns a new annotations object with migrations applied.
 */
export function applyGraphLabelMigrations(
  annotations: TopologyAnnotations | undefined,
  migrations: GraphLabelMigration[]
): TopologyAnnotations {
  const result = createBaseAnnotations(annotations);
  const nodeAnnotations = result.nodeAnnotations ?? [];

  for (const migration of migrations) {
    const newAnnotation = migrationToNodeAnnotation(migration);
    nodeAnnotations.push(newAnnotation);
  }
  result.nodeAnnotations = nodeAnnotations;

  return result;
}
