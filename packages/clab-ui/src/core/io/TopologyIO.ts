/**
 * TopologyIO - Orchestration layer for topology persistence
 *
 * Combines YAML AST editing with annotations management.
 * Provides batch operations and save queueing.
 * Used by both VS Code extension and dev server.
 */

import * as YAML from "yaml";

import type {
  ClabTopology,
  NetworkNodeAnnotation,
  NodeAnnotation,
  TopologyAnnotations
} from "../types/topology";
import {
  PREFIX_DUMMY,
  PREFIX_MACVLAN,
  PREFIX_VXLAN,
  PREFIX_VXLAN_STITCH,
  STR_HOST,
  STR_MGMT_NET,
  applyInterfacePatternMigrations
} from "../utilities";

import type { FileSystemAdapter, SaveResult, IOLogger } from "./types";
import { noopLogger, ERROR_SERVICE_NOT_INIT, ERROR_NO_YAML_PATH } from "./types";
import type { AnnotationsIO } from "./AnnotationsIO";
import { writeYamlFile, parseYamlDocument } from "./YamlDocumentIO";
import type { NodeSaveData, NodeAnnotationData } from "./NodePersistenceIO";
import {
  addNodeToDoc,
  editNodeInDoc,
  deleteNodeFromDoc,
  applyAnnotationData
} from "./NodePersistenceIO";
import type { LinkSaveData } from "./LinkPersistenceIO";
import { addLinkToDoc, editLinkInDoc, deleteLinkFromDoc } from "./LinkPersistenceIO";
import { isRecord } from "../utilities/typeHelpers";

// Types are available from ./NodePersistenceIO and ./LinkPersistenceIO directly

function isRecordOfRecords(value: unknown): value is Record<string, Record<string, unknown>> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => isRecord(entry));
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toOptionalNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function parseTopologyForInheritance(raw: unknown): ClabTopology {
  if (!isRecord(raw)) return {};
  const topologyRaw = raw.topology;
  if (!isRecord(topologyRaw)) return {};

  const topology: NonNullable<ClabTopology["topology"]> = {};
  if (isRecord(topologyRaw.defaults)) {
    topology.defaults = topologyRaw.defaults;
  }
  if (isRecordOfRecords(topologyRaw.kinds)) {
    topology.kinds = topologyRaw.kinds;
  }
  if (isRecordOfRecords(topologyRaw.groups)) {
    topology.groups = topologyRaw.groups;
  }

  return { topology };
}

/**
 * Helper to update position and/or geo coordinates on an annotation.
 * Only updates fields that are provided - this allows GeoMap mode to update
 * only geo coordinates without overwriting the preset position.
 */
function updateNodeAnnotationPosition(
  annotation: {
    position?: { x: number; y: number };
    geoCoordinates?: { lat: number; lng: number };
  },
  position?: { x: number; y: number },
  geoCoordinates?: { lat: number; lng: number }
): void {
  if (position) {
    annotation.position = position;
  }
  if (geoCoordinates) {
    annotation.geoCoordinates = geoCoordinates;
  }
}

/**
 * Helper to create a new node annotation with position and/or geo coordinates.
 * At least one of position or geoCoordinates should be provided.
 */
function createNodeAnnotationWithPosition(
  id: string,
  position?: { x: number; y: number },
  geoCoordinates?: { lat: number; lng: number }
): NodeAnnotation {
  const annotation: NodeAnnotation = { id };
  if (position) {
    annotation.position = position;
  }
  if (geoCoordinates) {
    annotation.geoCoordinates = geoCoordinates;
  }
  return annotation;
}

function inferGeneratedNetworkAnnotationType(
  id: string
): NetworkNodeAnnotation["type"] | undefined {
  if (id.startsWith(`${STR_HOST}:`)) return STR_HOST;
  if (id.startsWith(`${STR_MGMT_NET}:`)) return STR_MGMT_NET;
  if (id.startsWith(PREFIX_MACVLAN)) return "macvlan";
  if (id.startsWith(PREFIX_VXLAN_STITCH)) return "vxlan-stitch";
  if (id.startsWith(PREFIX_VXLAN)) return "vxlan";
  if (id.startsWith(PREFIX_DUMMY)) return "dummy";
  return undefined;
}

function createNetworkNodeAnnotationWithPosition(
  id: string,
  type: NetworkNodeAnnotation["type"],
  fallbackNodeAnnotation?: NodeAnnotation,
  position?: { x: number; y: number },
  geoCoordinates?: { lat: number; lng: number }
): NetworkNodeAnnotation {
  const annotation: NetworkNodeAnnotation = {
    id,
    type,
    label: fallbackNodeAnnotation?.label ?? id,
    position: position ?? fallbackNodeAnnotation?.position ?? { x: 0, y: 0 }
  };
  const coordinates = geoCoordinates ?? fallbackNodeAnnotation?.geoCoordinates;
  if (coordinates) {
    annotation.geoCoordinates = coordinates;
  }
  if (fallbackNodeAnnotation?.group) {
    annotation.group = fallbackNodeAnnotation.group;
  }
  if (fallbackNodeAnnotation?.level) {
    annotation.level = fallbackNodeAnnotation.level;
  }
  return annotation;
}

/**
 * Move generated external endpoint positions out of nodeAnnotations.
 *
 * Older saves could store ids like "macvlan:ens33" as regular node annotations,
 * but the parser resolves those nodes only from networkNodeAnnotations.
 */
export function migrateGeneratedNetworkNodeAnnotations(annotations: TopologyAnnotations): boolean {
  const nodeAnnotations = annotations.nodeAnnotations ?? [];
  if (nodeAnnotations.length === 0) return false;

  annotations.networkNodeAnnotations ??= [];
  const regularNodeAnnotations: NodeAnnotation[] = [];
  let modified = false;

  for (const annotation of nodeAnnotations) {
    const generatedNetworkType = inferGeneratedNetworkAnnotationType(annotation.id);
    if (!generatedNetworkType) {
      regularNodeAnnotations.push(annotation);
      continue;
    }

    modified = true;
    const existingNetworkAnnotation = annotations.networkNodeAnnotations.find(
      (entry) => entry.id === annotation.id
    );
    if (existingNetworkAnnotation) {
      continue;
    }
    annotations.networkNodeAnnotations.push(
      createNetworkNodeAnnotationWithPosition(annotation.id, generatedNetworkType, annotation)
    );
  }

  if (modified) {
    annotations.nodeAnnotations = regularNodeAnnotations;
  }

  return modified;
}

/**
 * Options for creating a TopologyIO instance
 */
export interface TopologyIOOptions {
  fs: FileSystemAdapter;
  annotationsIO: AnnotationsIO;
  setInternalUpdate?: (updating: boolean) => void;
  logger?: IOLogger;
}

/**
 * TopologyIO - Orchestrates saving topology changes to YAML files
 *
 * Features:
 * - Batch operations (defers saves until endBatch)
 * - Save queueing to prevent concurrent writes
 * - Integrated annotations management
 */
export class TopologyIO {
  private fs: FileSystemAdapter;
  private annotationsIO: AnnotationsIO;
  private setInternalUpdate?: (updating: boolean) => void;
  private logger: IOLogger;

  // State
  private doc: YAML.Document.Parsed | null = null;
  private yamlFilePath: string = "";
  private batchDepth = 0;
  private pendingSave = false;
  private saveQueue: Promise<SaveResult> = Promise.resolve({ success: true });

  constructor(options: TopologyIOOptions) {
    this.fs = options.fs;
    this.annotationsIO = options.annotationsIO;
    this.setInternalUpdate = options.setInternalUpdate;
    this.logger = options.logger ?? noopLogger;
  }

  /**
   * Initializes the service with a YAML document
   */
  initialize(doc: YAML.Document.Parsed, yamlFilePath: string): void {
    this.doc = doc;
    this.yamlFilePath = yamlFilePath;
  }

  /**
   * Initializes the service by reading and parsing a YAML file
   */
  async initializeFromFile(yamlFilePath: string): Promise<SaveResult> {
    try {
      const content = await this.fs.readFile(yamlFilePath);
      const doc = parseYamlDocument(content);
      this.initialize(doc, yamlFilePath);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Checks if the service is initialized
   */
  isInitialized(): boolean {
    return this.doc !== null && this.yamlFilePath !== "";
  }

  /**
   * Gets the current YAML file path
   */
  getYamlFilePath(): string {
    return this.yamlFilePath;
  }

  /**
   * Gets the current YAML document
   */
  getDocument(): YAML.Document.Parsed | null {
    return this.doc;
  }

  /**
   * Begin a batch operation (defers saves until endBatch)
   */
  beginBatch(): void {
    this.batchDepth += 1;
  }

  /**
   * End a batch operation and flush pending saves
   */
  async endBatch(): Promise<SaveResult> {
    if (this.batchDepth > 0) {
      this.batchDepth -= 1;
    }
    if (this.batchDepth === 0 && this.pendingSave) {
      this.pendingSave = false;
      return this.save();
    }
    return { success: true };
  }

  /**
   * Save if not in batch mode, otherwise mark as pending
   */
  private async saveMaybeDeferred(): Promise<SaveResult> {
    if (this.batchDepth > 0) {
      this.pendingSave = true;
      return { success: true };
    }
    return this.save();
  }

  /**
   * Adds a new node and saves to YAML
   */
  async addNode(nodeData: NodeSaveData): Promise<SaveResult> {
    if (!this.doc) {
      return { success: false, error: ERROR_SERVICE_NOT_INIT };
    }

    const result = addNodeToDoc(this.doc, nodeData, this.logger);
    if (result.success) {
      await this.saveMaybeDeferred();

      // Save position and annotation data to annotations if provided
      const nodeId = nodeData.name || nodeData.id;
      if (nodeData.position && nodeId) {
        const annotationData = this.buildNodeAnnotationData(nodeData.extraData, true);
        await this.saveNodePosition(nodeId, nodeData.position, annotationData);
      }
    }
    return result;
  }

  /**
   * Updates an existing node and saves to YAML
   */
  async editNode(nodeData: NodeSaveData): Promise<SaveResult> {
    if (!this.doc) {
      return { success: false, error: ERROR_SERVICE_NOT_INIT };
    }

    const topoObj = parseTopologyForInheritance(this.doc.toJS());
    const result = editNodeInDoc(this.doc, nodeData, topoObj, this.logger);
    if (!result.success) return result;

    await this.saveMaybeDeferred();
    if (result.renamed) {
      await this.renameNodeAnnotations(result.renamed.oldId, result.renamed.newId);
    }
    await this.persistEditedNodeAnnotations(nodeData, result.renamed);
    return result;
  }

  private buildNodeAnnotationData(
    extraData: NodeSaveData["extraData"],
    includeGroupId = false
  ): NodeAnnotationData | undefined {
    if (!extraData) return undefined;
    return {
      label: toOptionalNullableString(extraData.label),
      icon: toOptionalString(extraData.topoViewerRole),
      iconColor: toOptionalString(extraData.iconColor),
      iconCornerRadius: toOptionalNumber(extraData.iconCornerRadius),
      labelPosition: toOptionalNullableString(extraData.labelPosition),
      direction: toOptionalNullableString(extraData.direction),
      labelBackgroundColor: toOptionalNullableString(extraData.labelBackgroundColor),
      interfacePattern: toOptionalString(extraData.interfacePattern),
      groupId: includeGroupId ? toOptionalString(extraData.groupId) : undefined
    };
  }

  private hasPersistableAnnotationData(
    annotationData: NodeAnnotationData | undefined
  ): annotationData is NodeAnnotationData {
    if (!annotationData) return false;
    return (
      annotationData.label !== undefined ||
      Boolean(annotationData.icon) ||
      Boolean(annotationData.iconColor) ||
      annotationData.iconCornerRadius !== undefined ||
      annotationData.labelPosition !== undefined ||
      annotationData.direction !== undefined ||
      annotationData.labelBackgroundColor !== undefined ||
      Boolean(annotationData.interfacePattern)
    );
  }

  private async persistEditedNodeAnnotations(
    nodeData: NodeSaveData,
    renamed?: { oldId: string; newId: string }
  ): Promise<void> {
    const nodeId = (renamed?.newId ?? nodeData.name) || nodeData.id;
    if (!nodeId) return;

    const annotationData = this.buildNodeAnnotationData(nodeData.extraData);
    if (!this.hasPersistableAnnotationData(annotationData)) return;
    await this.saveNodeAnnotations(nodeId, annotationData);
  }

  /**
   * Helper to find or create a node annotation entry
   */
  private ensureNodeAnnotation(annotations: TopologyAnnotations, nodeId: string): NodeAnnotation {
    annotations.nodeAnnotations ??= [];

    let existing = annotations.nodeAnnotations.find((n) => n.id === nodeId);
    if (!existing) {
      existing = { id: nodeId };
      annotations.nodeAnnotations.push(existing);
    }
    return existing;
  }

  /**
   * Saves annotation data for a node (icon, color, etc.) without changing position
   */
  private async saveNodeAnnotations(
    nodeId: string,
    annotationData: NodeAnnotationData
  ): Promise<void> {
    await this.annotationsIO.modifyAnnotations(this.yamlFilePath, (annotations) => {
      const node = this.ensureNodeAnnotation(annotations, nodeId);
      applyAnnotationData(node, annotationData);
      return annotations;
    });
  }

  /**
   * Renames a node's annotations from old ID to new ID
   */
  private async renameNodeAnnotations(oldId: string, newId: string): Promise<void> {
    await this.annotationsIO.modifyAnnotations(this.yamlFilePath, (annotations) => {
      if (annotations.nodeAnnotations) {
        const nodeAnnotation = annotations.nodeAnnotations.find((n) => n.id === oldId);
        if (nodeAnnotation) {
          nodeAnnotation.id = newId;
        }
      }
      return annotations;
    });
  }

  /**
   * Removes a node and saves to YAML
   */
  async deleteNode(nodeId: string): Promise<SaveResult> {
    if (!this.doc) {
      return { success: false, error: ERROR_SERVICE_NOT_INIT };
    }

    // Try to delete as a regular YAML node first
    const result = deleteNodeFromDoc(this.doc, nodeId, this.logger);
    if (result.success) {
      await this.saveMaybeDeferred();
      // Also remove from annotations
      await this.removeNodeAnnotations(nodeId);
      return result;
    }

    // If not found as a regular node, try to delete as a network node
    // Network nodes (host, vxlan, dummy, etc.) are represented as links, not nodes
    const networkResult = this.deleteNetworkNode(nodeId);
    if (networkResult.success) {
      await this.saveMaybeDeferred();
    }
    // Always try to remove network node annotations, even if no links were found.
    // Network nodes can exist in annotations before any links are created.
    await this.removeNetworkNodeAnnotations(nodeId);
    // Return success if either links were deleted OR annotations were potentially removed
    return { success: true };
  }

  /**
   * Deletes a network node by removing all links that reference it.
   * Network nodes have IDs like:
   * - host:eth0 (from host-interface property)
   * - vxlan:vxlan0, vxlan-stitch:vxlan0
   * - mgmt-net:net0
   * - macvlan:0
   * - dummy0
   */
  private deleteNetworkNode(nodeId: string): SaveResult {
    if (!this.doc) {
      return { success: false, error: ERROR_SERVICE_NOT_INIT };
    }

    const links = this.doc.getIn(["topology", "links"], true);
    if (!YAML.isSeq(links)) {
      return { success: false, error: `Network node '${nodeId}' not found (no links in topology)` };
    }
    const linksSeq = links;

    const initialCount = linksSeq.items.length;
    linksSeq.items = linksSeq.items.filter((item) => !this.linkMatchesNetworkNode(item, nodeId));

    const deleted = initialCount - linksSeq.items.length;
    if (deleted === 0) {
      return { success: false, error: `Network node '${nodeId}' not found in topology links` };
    }

    this.logger.info(`[SaveTopology] Deleted ${deleted} links for network node: ${nodeId}`);
    return { success: true };
  }

  /**
   * Checks if a link item matches a network node ID.
   */
  private linkMatchesNetworkNode(item: unknown, nodeId: string): boolean {
    if (!YAML.isMap(item)) return false;
    const linkMap = item;

    const linkType = linkMap.get("type");
    if (linkType === undefined || linkType === null) return false;
    const typeStr = YAML.isScalar(linkType) ? String(linkType.value) : String(linkType);

    const expectedId = this.buildExpectedNetworkNodeId(typeStr, linkMap, nodeId);
    return expectedId === nodeId;
  }

  /**
   * Builds the expected network node ID for a link based on its type.
   */
  private buildExpectedNetworkNodeId(
    typeStr: string,
    linkMap: YAML.YAMLMap,
    nodeId: string
  ): string | null {
    if (typeStr === "host") {
      const hostInterface = linkMap.get("host-interface");
      if (hostInterface !== undefined && hostInterface !== null) {
        const ifaceStr = YAML.isScalar(hostInterface)
          ? String(hostInterface.value)
          : String(hostInterface);
        return `host:${ifaceStr}`;
      }
      return null;
    }

    // For counter-based types, match by prefix
    const prefixMatches: Record<string, string> = {
      "mgmt-net": "mgmt-net:",
      macvlan: "macvlan:",
      vxlan: "vxlan:",
      "vxlan-stitch": "vxlan-stitch:",
      dummy: "dummy"
    };

    const prefix = prefixMatches[typeStr];
    if (prefix && nodeId.startsWith(prefix)) {
      return nodeId;
    }

    return null;
  }

  /**
   * Removes a node's annotations
   */
  private async removeNodeAnnotations(nodeId: string): Promise<void> {
    await this.annotationsIO.modifyAnnotations(this.yamlFilePath, (annotations) => {
      if (annotations.nodeAnnotations) {
        annotations.nodeAnnotations = annotations.nodeAnnotations.filter((n) => n.id !== nodeId);
      }
      return annotations;
    });
  }

  /**
   * Removes a network node's annotations
   */
  private async removeNetworkNodeAnnotations(nodeId: string): Promise<void> {
    await this.annotationsIO.modifyAnnotations(this.yamlFilePath, (annotations) => {
      if (annotations.networkNodeAnnotations) {
        annotations.networkNodeAnnotations = annotations.networkNodeAnnotations.filter(
          (n) => n.id !== nodeId
        );
      }
      return annotations;
    });
  }

  /**
   * Adds a new link and saves to YAML
   */
  async addLink(linkData: LinkSaveData): Promise<SaveResult> {
    if (!this.doc) {
      return { success: false, error: ERROR_SERVICE_NOT_INIT };
    }

    const result = addLinkToDoc(this.doc, linkData, this.logger);
    if (result.success) {
      await this.saveMaybeDeferred();
    }
    return result;
  }

  /**
   * Updates an existing link and saves to YAML
   */
  async editLink(linkData: LinkSaveData): Promise<SaveResult> {
    if (!this.doc) {
      return { success: false, error: ERROR_SERVICE_NOT_INIT };
    }

    const result = editLinkInDoc(this.doc, linkData, this.logger);
    if (result.success) {
      await this.saveMaybeDeferred();
    }
    return result;
  }

  /**
   * Removes a link and saves to YAML
   */
  async deleteLink(linkData: LinkSaveData): Promise<SaveResult> {
    if (!this.doc) {
      return { success: false, error: ERROR_SERVICE_NOT_INIT };
    }

    const result = deleteLinkFromDoc(this.doc, linkData, this.logger);
    if (result.success) {
      await this.saveMaybeDeferred();
    }
    return result;
  }

  /**
   * Saves the current document to disk (queued to prevent concurrent writes)
   */
  async save(): Promise<SaveResult> {
    if (!this.doc) {
      return { success: false, error: ERROR_SERVICE_NOT_INIT };
    }
    // Queue saves to prevent concurrent writes that corrupt the file
    this.saveQueue = this.saveQueue
      .then(async () => {
        if (!this.doc) {
          return { success: false, error: ERROR_SERVICE_NOT_INIT };
        }
        return writeYamlFile(this.doc, this.yamlFilePath, {
          fs: this.fs,
          setInternalUpdate: this.setInternalUpdate,
          logger: this.logger
        });
      })
      .catch(() => ({ success: false, error: "Save queue error" }));
    return this.saveQueue;
  }

  /**
   * Saves a node's position and optional annotation data to the annotations file
   */
  async saveNodePosition(
    nodeId: string,
    position: { x: number; y: number },
    annotationData?: NodeAnnotationData
  ): Promise<void> {
    await this.annotationsIO.modifyAnnotations(this.yamlFilePath, (annotations) => {
      const node = this.ensureNodeAnnotation(annotations, nodeId);
      node.position = position;
      applyAnnotationData(node, annotationData);
      return annotations;
    });
  }

  /**
   * Saves multiple node positions to annotations file.
   * Network nodes are saved to networkNodeAnnotations, regular nodes to nodeAnnotations.
   *
   * In GeoMap mode, only geoCoordinates should be provided (position is omitted)
   * to avoid overwriting the preset position.
   */
  async savePositions(
    positions: Array<{
      id: string;
      position?: { x: number; y: number };
      geoCoordinates?: { lat: number; lng: number };
    }>
  ): Promise<SaveResult> {
    if (!this.yamlFilePath) {
      return { success: false, error: ERROR_NO_YAML_PATH };
    }

    try {
      await this.annotationsIO.modifyAnnotations(this.yamlFilePath, (annotations) => {
        annotations.nodeAnnotations ??= [];
        annotations.networkNodeAnnotations ??= [];
        migrateGeneratedNetworkNodeAnnotations(annotations);

        // Index annotations by id (first occurrence wins, matching .find semantics)
        const networkNodeById = new Map<string, NetworkNodeAnnotation>();
        for (const annotation of annotations.networkNodeAnnotations) {
          if (!networkNodeById.has(annotation.id)) networkNodeById.set(annotation.id, annotation);
        }
        const nodeById = new Map<string, NodeAnnotation>();
        for (const annotation of annotations.nodeAnnotations) {
          if (!nodeById.has(annotation.id)) nodeById.set(annotation.id, annotation);
        }

        for (const { id, position, geoCoordinates } of positions) {
          // Check if this is a network node (exists in networkNodeAnnotations)
          const networkNode = networkNodeById.get(id);
          if (networkNode) {
            updateNodeAnnotationPosition(networkNode, position, geoCoordinates);
            continue;
          }

          const generatedNetworkType = inferGeneratedNetworkAnnotationType(id);
          if (generatedNetworkType) {
            const staleNodeAnnotation = nodeById.get(id);
            const networkAnnotation = createNetworkNodeAnnotationWithPosition(
              id,
              generatedNetworkType,
              staleNodeAnnotation,
              position,
              geoCoordinates
            );
            annotations.networkNodeAnnotations.push(networkAnnotation);
            networkNodeById.set(id, networkAnnotation);
            annotations.nodeAnnotations = annotations.nodeAnnotations.filter((n) => n.id !== id);
            nodeById.delete(id);
            continue;
          }

          // Update or add to nodeAnnotations
          const existing = nodeById.get(id);
          if (existing) {
            updateNodeAnnotationPosition(existing, position, geoCoordinates);
          } else {
            const created = createNodeAnnotationWithPosition(id, position, geoCoordinates);
            annotations.nodeAnnotations.push(created);
            nodeById.set(id, created);
          }
        }

        return annotations;
      });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Migrates interface patterns to annotations for nodes that don't have them.
   */
  async migrateInterfacePatterns(
    migrations: Array<{ nodeId: string; interfacePattern: string }>
  ): Promise<void> {
    if (migrations.length === 0) return;

    await this.annotationsIO.modifyAnnotations(this.yamlFilePath, (annotations) => {
      const result = applyInterfacePatternMigrations(annotations, migrations);

      if (result.modified) {
        this.logger.info(`[TopologyIO] Migrated interface patterns for ${migrations.length} nodes`);
      }

      return result.annotations;
    });
  }
}
