/**
 * LinkPersistenceIO - Pure YAML AST operations for link CRUD
 *
 * Contains only the YAML manipulation logic without file I/O.
 * Used by both VS Code extension and dev server.
 */

import * as YAML from "yaml";

import type { SaveResult, IOLogger } from "./types";
import { ERROR_LINKS_NOT_SEQ, noopLogger } from "./types";
import { HOSTY_TYPES, SINGLE_ENDPOINT_TYPES } from "../utilities/LinkTypes";
import { isRecord } from "../utilities/typeHelpers";
import { createQuotedScalar, deepEqual, setOrDelete } from "./YamlDocumentIO";

/**
 * Gets the links sequence from a YAML document, returning an error result if not found.
 */
function getLinksSeqOrError(
  doc: YAML.Document.Parsed
): { linksSeq: YAML.YAMLSeq } | { error: SaveResult } {
  const linksNode = doc.getIn(["topology", "links"], true);
  if (!YAML.isSeq(linksNode)) {
    return { error: { success: false, error: ERROR_LINKS_NOT_SEQ } };
  }
  return { linksSeq: linksNode };
}

/**
 * Gets the links sequence, returning it directly or the error SaveResult if not found.
 * Helper to reduce code duplication for the common pattern of error checking.
 */
function getValidatedLinksSeq(doc: YAML.Document.Parsed): YAML.YAMLSeq | SaveResult {
  const result = getLinksSeqOrError(doc);
  if ("error" in result) return result.error;
  return result.linksSeq;
}

/** Link data for save operations */
export interface LinkSaveData {
  id: string;
  source: string;
  target: string;
  sourceEndpoint?: string;
  targetEndpoint?: string;
  extraData?: {
    extType?: string;
    extMtu?: string | number;
    extHostInterface?: string;
    extMode?: string;
    extRemote?: string;
    extVni?: string | number;
    extDstPort?: string | number;
    extSrcPort?: string | number;
    /** MAC of the node-side endpoint of a single-endpoint link (network node editor) */
    extMac?: string;
    extSourceMac?: string;
    extTargetMac?: string;
    extSourceIpv4?: string;
    extSourceIpv6?: string;
    extTargetIpv4?: string;
    extTargetIpv6?: string;
    extVars?: Record<string, unknown>;
    extLabels?: Record<string, unknown>;
    [key: string]: unknown;
  };
  // Original values for finding the link when endpoints change
  originalSource?: string;
  originalTarget?: string;
  originalSourceEndpoint?: string;
  originalTargetEndpoint?: string;
}

function hasText(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/**
 * Creates a link entry in brief format: endpoints: ["node1:eth1", "node2:eth1"]
 */
function createBriefLink(doc: YAML.Document, linkData: LinkSaveData): YAML.YAMLMap {
  const linkMap = new YAML.YAMLMap();
  linkMap.flow = false;

  const srcStr = hasText(linkData.sourceEndpoint)
    ? `${linkData.source}:${linkData.sourceEndpoint}`
    : linkData.source;
  const dstStr = hasText(linkData.targetEndpoint)
    ? `${linkData.target}:${linkData.targetEndpoint}`
    : linkData.target;

  const endpointsSeq = new YAML.YAMLSeq();
  endpointsSeq.flow = true;
  endpointsSeq.add(createQuotedScalar(doc, srcStr));
  endpointsSeq.add(createQuotedScalar(doc, dstStr));

  linkMap.set("endpoints", endpointsSeq);
  return linkMap;
}

/** Prefixes that indicate a special/visualization node (not a real YAML node) */
const SPECIAL_NODE_PREFIXES = [
  "host:",
  "mgmt-net:",
  "macvlan:",
  "vxlan:",
  "vxlan-stitch:",
  "dummy"
];

/**
 * Check if a node ID represents a special/visualization node.
 */
function isSpecialNode(nodeId: string): boolean {
  return SPECIAL_NODE_PREFIXES.some((prefix) => nodeId.startsWith(prefix));
}

function pickEndpointValue<T>(useTarget: boolean, sourceValue: T, targetValue: T): T {
  return useTarget ? targetValue : sourceValue;
}

function setEndpointField(
  doc: YAML.Document,
  epMap: YAML.YAMLMap,
  key: string,
  value: string | undefined,
  quoted = false
): void {
  if (!hasText(value)) return;
  epMap.set(key, quoted ? createQuotedScalar(doc, value) : doc.createNode(value));
}

/**
 * Creates a single endpoint map for special link types.
 * The endpoint should reference the REAL containerlab node, not the visualization node.
 * We detect which side is the real node by checking for special node prefixes.
 */
function createSingleEndpointMap(
  doc: YAML.Document,
  linkData: LinkSaveData,
  extra: LinkSaveData["extraData"],
  _linkType: string
): YAML.YAMLMap {
  const epMap = new YAML.YAMLMap();
  epMap.flow = false;

  // Determine which side is the real node (the one without special prefix)
  const sourceIsSpecial = isSpecialNode(linkData.source);
  const useTarget = sourceIsSpecial;

  const node = pickEndpointValue(useTarget, linkData.source, linkData.target);
  const iface = pickEndpointValue(useTarget, linkData.sourceEndpoint, linkData.targetEndpoint);
  const mac = hasText(extra?.extMac)
    ? extra.extMac
    : pickEndpointValue(useTarget, extra?.extSourceMac, extra?.extTargetMac);
  const ipv4 = pickEndpointValue(useTarget, extra?.extSourceIpv4, extra?.extTargetIpv4);
  const ipv6 = pickEndpointValue(useTarget, extra?.extSourceIpv6, extra?.extTargetIpv6);

  epMap.set("node", createQuotedScalar(doc, node));
  setEndpointField(doc, epMap, "interface", iface, true);
  setEndpointField(doc, epMap, "mac", mac);
  setEndpointField(doc, epMap, "ipv4", ipv4);
  setEndpointField(doc, epMap, "ipv6", ipv6);
  return epMap;
}

/**
 * Extract the interface/identifier from a special node ID.
 * e.g., "host:eth0" → "eth0", "macvlan:0" → "0"
 */
function extractSpecialNodeInterface(nodeId: string): string | undefined {
  const colonIndex = nodeId.indexOf(":");
  if (colonIndex === -1) return undefined;
  return nodeId.slice(colonIndex + 1) || undefined;
}

/**
 * Simple IPv4 validation check.
 * Returns true if the string looks like an IP address (contains dots with numbers).
 */
function looksLikeIpAddress(value: string): boolean {
  // Basic check: should contain at least one dot and only valid IP chars
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

/**
 * Extract vxlan properties from the special node ID.
 * Format: "vxlan:remote/vni/dst-port/src-port" or "vxlan-stitch:remote/vni/dst-port/src-port"
 * Only extracts remote if it looks like an IP address to avoid using counter-based names.
 */
function extractVxlanProperties(nodeId: string): {
  remote?: string;
  vni?: string;
  dstPort?: string;
  srcPort?: string;
} {
  const colonIndex = nodeId.indexOf(":");
  if (colonIndex === -1) return {};

  const parts = nodeId.slice(colonIndex + 1).split("/");
  // Only use remote if it looks like an IP address
  const remoteCandidate = parts[0];
  return {
    remote: remoteCandidate && looksLikeIpAddress(remoteCandidate) ? remoteCandidate : undefined,
    vni: parts[1] || undefined,
    dstPort: parts[2] || undefined,
    srcPort: parts[3] || undefined
  };
}

/** Host/macvlan/mgmt-net link types that use host-interface */
const HOST_INTERFACE_TYPES = new Set(["host", "macvlan", "mgmt-net"]);

/**
 * Apply host-interface properties for host/macvlan/mgmt-net link types
 */
function applyHostInterfaceProperties(
  doc: YAML.Document,
  linkMap: YAML.YAMLMap,
  linkType: string,
  extra: LinkSaveData["extraData"],
  specialNodeId: string
): void {
  const hostInterface = extra?.extHostInterface ?? extractSpecialNodeInterface(specialNodeId);
  if (hasText(hostInterface)) {
    linkMap.set("host-interface", doc.createNode(hostInterface));
  }
  if (linkType === "macvlan" && hasText(extra?.extMode)) {
    linkMap.set("mode", doc.createNode(extra.extMode));
  }
}

/** Default values for required VXLAN properties */
const VXLAN_DEFAULTS = { remote: "127.0.0.1", vni: 100, dstPort: 4789 };

/** Converts a value to number, returns default if conversion fails */
function toNumber(value: string | number | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const num = Number(value);
  return Number.isNaN(num) ? defaultValue : num;
}

/**
 * Apply vxlan-specific properties (remote, vni, dst-port, src-port)
 */
function applyVxlanProperties(
  doc: YAML.Document,
  linkMap: YAML.YAMLMap,
  extra: LinkSaveData["extraData"],
  specialNodeId: string
): void {
  const parsed = extractVxlanProperties(specialNodeId);

  const remote = extra?.extRemote ?? parsed.remote ?? VXLAN_DEFAULTS.remote;
  const vni = toNumber(extra?.extVni ?? parsed.vni, VXLAN_DEFAULTS.vni);
  const dstPort = toNumber(extra?.extDstPort ?? parsed.dstPort, VXLAN_DEFAULTS.dstPort);

  linkMap.set("remote", doc.createNode(remote));
  linkMap.set("vni", doc.createNode(vni));
  linkMap.set("dst-port", doc.createNode(dstPort));

  const srcPort = extra?.extSrcPort ?? parsed.srcPort;
  if (srcPort !== undefined && srcPort !== "") {
    linkMap.set("src-port", doc.createNode(toNumber(srcPort, 0)));
  }
}

/**
 * Applies type-specific properties for single endpoint links
 */
function applySingleEndpointProperties(
  doc: YAML.Document,
  linkMap: YAML.YAMLMap,
  linkType: string,
  extra: LinkSaveData["extraData"],
  linkData: LinkSaveData
): void {
  // Get the special node ID (the one with the prefix like host:, vxlan:, etc.)
  const specialNodeId = isSpecialNode(linkData.source) ? linkData.source : linkData.target;

  if (HOST_INTERFACE_TYPES.has(linkType)) {
    applyHostInterfaceProperties(doc, linkMap, linkType, extra, specialNodeId);
  } else if (linkType === "vxlan" || linkType === "vxlan-stitch") {
    applyVxlanProperties(doc, linkMap, extra, specialNodeId);
  }
}

/**
 * Creates dual endpoint sequence for veth links
 */
function createDualEndpointSeq(
  doc: YAML.Document,
  linkData: LinkSaveData,
  extra: LinkSaveData["extraData"]
): YAML.YAMLSeq {
  const endpointsSeq = new YAML.YAMLSeq();
  endpointsSeq.flow = false;

  const srcEp = new YAML.YAMLMap();
  srcEp.flow = false;
  srcEp.set("node", createQuotedScalar(doc, linkData.source));
  if (hasText(linkData.sourceEndpoint)) {
    srcEp.set("interface", createQuotedScalar(doc, linkData.sourceEndpoint));
  }
  if (hasText(extra?.extSourceMac)) {
    srcEp.set("mac", doc.createNode(extra.extSourceMac));
  }
  if (hasText(extra?.extSourceIpv4)) {
    srcEp.set("ipv4", doc.createNode(extra.extSourceIpv4));
  }
  if (hasText(extra?.extSourceIpv6)) {
    srcEp.set("ipv6", doc.createNode(extra.extSourceIpv6));
  }

  const dstEp = new YAML.YAMLMap();
  dstEp.flow = false;
  dstEp.set("node", createQuotedScalar(doc, linkData.target));
  if (hasText(linkData.targetEndpoint)) {
    dstEp.set("interface", createQuotedScalar(doc, linkData.targetEndpoint));
  }
  if (hasText(extra?.extTargetMac)) {
    dstEp.set("mac", doc.createNode(extra.extTargetMac));
  }
  if (hasText(extra?.extTargetIpv4)) {
    dstEp.set("ipv4", doc.createNode(extra.extTargetIpv4));
  }
  if (hasText(extra?.extTargetIpv6)) {
    dstEp.set("ipv6", doc.createNode(extra.extTargetIpv6));
  }

  endpointsSeq.add(srcEp);
  endpointsSeq.add(dstEp);
  return endpointsSeq;
}

/**
 * Creates a link entry in extended format with type and additional properties
 */
function createExtendedLink(doc: YAML.Document, linkData: LinkSaveData): YAML.YAMLMap {
  const linkMap = new YAML.YAMLMap();
  linkMap.flow = false;

  const extra = linkData.extraData ?? {};
  const inferredType = inferSpecialLinkType(linkData);
  const rawType = typeof extra.extType === "string" ? extra.extType.trim() : "";
  const linkType = rawType && rawType !== "veth" ? rawType : (inferredType ?? "veth");

  linkMap.set("type", doc.createNode(linkType));

  if (SINGLE_ENDPOINT_TYPES.has(linkType)) {
    linkMap.set("endpoint", createSingleEndpointMap(doc, linkData, extra, linkType));
    applySingleEndpointProperties(doc, linkMap, linkType, extra, linkData);
  } else {
    linkMap.set("endpoints", createDualEndpointSeq(doc, linkData, extra));
  }

  // Common extended properties
  setOrDelete(doc, linkMap, "mtu", extra.extMtu);
  setOrDelete(doc, linkMap, "vars", extra.extVars);
  setOrDelete(doc, linkMap, "labels", extra.extLabels);

  return linkMap;
}

/** Extended-format property keys checked when deciding the link YAML format */
const EXTENDED_PROPERTY_KEYS = [
  "extMtu",
  "extMac",
  "extSourceMac",
  "extTargetMac",
  "extSourceIpv4",
  "extSourceIpv6",
  "extTargetIpv4",
  "extTargetIpv6",
  "extHostInterface",
  "extMode",
  "extRemote",
  "extVni",
  "extDstPort",
  "extSrcPort"
];

/**
 * Checks if link data has extended properties requiring extended format
 */
function hasExtendedProperties(linkData: LinkSaveData): boolean {
  const extra = linkData.extraData ?? {};

  if (EXTENDED_PROPERTY_KEYS.some((k) => extra[k] !== undefined && extra[k] !== "")) return true;
  if (
    extra.extVars !== undefined &&
    typeof extra.extVars === "object" &&
    Object.keys(extra.extVars).length > 0
  ) {
    return true;
  }
  if (
    extra.extLabels !== undefined &&
    typeof extra.extLabels === "object" &&
    Object.keys(extra.extLabels).length > 0
  ) {
    return true;
  }
  if (hasText(extra.extType) && extra.extType !== "veth") return true;
  const inferredType = inferSpecialLinkType(linkData);
  if (inferredType !== null && inferredType !== "veth") return true;

  return false;
}

/**
 * Extracts the link type from a special node ID.
 * E.g., "vxlan:vxlan0" -> "vxlan", "host:eth0" -> "host"
 */
function extractLinkTypeFromSpecialNode(nodeId: string): string | null {
  const colonIdx = nodeId.indexOf(":");
  if (colonIdx === -1) {
    // Handle dummy nodes which don't have a colon prefix
    if (nodeId.startsWith("dummy")) return "dummy";
    return null;
  }
  return nodeId.substring(0, colonIdx);
}

function inferSpecialLinkType(linkData: LinkSaveData): string | null {
  if (isSpecialNode(linkData.source)) {
    const sourceType = extractLinkTypeFromSpecialNode(linkData.source);
    if (sourceType !== null && sourceType !== "") return sourceType;
  }
  if (isSpecialNode(linkData.target)) {
    const targetType = extractLinkTypeFromSpecialNode(linkData.target);
    if (targetType !== null && targetType !== "") return targetType;
  }
  return null;
}

/**
 * Generates a canonical key for a link to find duplicates.
 * For special nodes (vxlan, host, etc.), uses the link type instead of the full node ID
 * to match the YAML format.
 */
function getLinkKey(linkData: LinkSaveData): string {
  const sourceIsSpecial = isSpecialNode(linkData.source);
  const targetIsSpecial = isSpecialNode(linkData.target);

  let src: string;
  let dst: string;

  if (sourceIsSpecial) {
    const linkType = extractLinkTypeFromSpecialNode(linkData.source);
    src = linkType ?? linkData.source;
    dst = hasText(linkData.targetEndpoint)
      ? `${linkData.target}:${linkData.targetEndpoint}`
      : linkData.target;
  } else if (targetIsSpecial) {
    const linkType = extractLinkTypeFromSpecialNode(linkData.target);
    src = hasText(linkData.sourceEndpoint)
      ? `${linkData.source}:${linkData.sourceEndpoint}`
      : linkData.source;
    dst = linkType ?? linkData.target;
  } else {
    src = hasText(linkData.sourceEndpoint)
      ? `${linkData.source}:${linkData.sourceEndpoint}`
      : linkData.source;
    dst = hasText(linkData.targetEndpoint)
      ? `${linkData.target}:${linkData.targetEndpoint}`
      : linkData.target;
  }

  // Sort to ensure consistent key regardless of direction
  return [src, dst].slice().sort().join("|");
}

/**
 * Extracts endpoint string from a YAML endpoint item
 */
function extractEndpointString(ep: unknown): string | null {
  if (YAML.isScalar(ep)) {
    // Brief host/mgmt-net/macvlan endpoints ("host:eth0") are keyed by their type,
    // like the extended single-endpoint form.
    return getBriefSpecialType(String(ep.value)) ?? String(ep.value);
  }
  if (YAML.isMap(ep)) {
    const node = ep.get("node");
    const iface = ep.get("interface");
    if (iface === undefined || iface === null || iface === "") return String(node);
    return `${node}:${String(iface)}`;
  }
  return null;
}

/**
 * Gets the canonical key from an existing YAML link map
 */
function getYamlLinkKey(linkMap: YAML.YAMLMap): string | null {
  const endpoints: string[] = [];

  // Check endpoints array
  const endpointsSeq = linkMap.get("endpoints", true);
  if (YAML.isSeq(endpointsSeq)) {
    for (const ep of endpointsSeq.items) {
      const epStr = extractEndpointString(ep);
      if (epStr !== null && epStr !== "") endpoints.push(epStr);
    }
  }

  // Check single endpoint
  const endpoint = linkMap.get("endpoint", true);
  if (YAML.isMap(endpoint)) {
    const epStr = extractEndpointString(endpoint);
    if (epStr !== null && epStr !== "") endpoints.push(epStr);
  }

  if (endpoints.length < 1) return null;

  // For single-endpoint types, the second endpoint is the type (host, mgmt-net, etc.)
  const linkType = linkMap.get("type");
  if (endpoints.length === 1 && linkType !== undefined && linkType !== null) {
    endpoints.push(String(linkType));
  }

  return [...endpoints].sort().join("|");
}

/**
 * Gets the lookup key for finding an existing link
 * Uses original values if provided (for when endpoints have changed)
 * For special nodes (vxlan, host, etc.), uses the link type instead of the full node ID
 * to match the YAML format where single-endpoint links use the type as the second key part.
 */
function getLookupKey(linkData: LinkSaveData): string {
  const source = linkData.originalSource ?? linkData.source;
  const target = linkData.originalTarget ?? linkData.target;
  const sourceEndpoint = linkData.originalSourceEndpoint ?? linkData.sourceEndpoint;
  const targetEndpoint = linkData.originalTargetEndpoint ?? linkData.targetEndpoint;

  // Check if either endpoint is a special node
  const sourceIsSpecial = isSpecialNode(source);
  const targetIsSpecial = isSpecialNode(target);

  let src: string;
  let dst: string;

  if (sourceIsSpecial) {
    // Source is special node - use link type for that side, node:iface for other side
    const linkType = extractLinkTypeFromSpecialNode(source);
    src = linkType ?? source;
    dst = hasText(targetEndpoint) ? `${target}:${targetEndpoint}` : target;
  } else if (targetIsSpecial) {
    // Target is special node - use link type for that side, node:iface for other side
    const linkType = extractLinkTypeFromSpecialNode(target);
    src = hasText(sourceEndpoint) ? `${source}:${sourceEndpoint}` : source;
    dst = linkType ?? target;
  } else {
    // Normal veth link - use both endpoints
    src = hasText(sourceEndpoint) ? `${source}:${sourceEndpoint}` : source;
    dst = hasText(targetEndpoint) ? `${target}:${targetEndpoint}` : target;
  }

  return [src, dst].slice().sort().join("|");
}

/**
 * Builds a lookup key that treats all endpoints literally.
 * This is used as a fallback for legacy links that used special node IDs
 * directly in endpoints arrays (e.g. "host:eth0") instead of type-based links.
 */
function getLegacyLookupKey(linkData: LinkSaveData): string {
  const source = linkData.originalSource ?? linkData.source;
  const target = linkData.originalTarget ?? linkData.target;
  const sourceEndpoint = linkData.originalSourceEndpoint ?? linkData.sourceEndpoint;
  const targetEndpoint = linkData.originalTargetEndpoint ?? linkData.targetEndpoint;

  const src = hasText(sourceEndpoint) ? `${source}:${sourceEndpoint}` : source;
  const dst = hasText(targetEndpoint) ? `${target}:${targetEndpoint}` : target;
  return [src, dst].slice().sort().join("|");
}

// ============================================================================
// Link edit merge
// ============================================================================

/** Link types that can be written in the brief `endpoints: ["a:e1", "b:e1"]` form */
const BRIEF_LINK_TYPES = new Set(["veth", ...HOSTY_TYPES]);

const VXLAN_KEYS = ["remote", "vni", "udp-port", "dst-port", "parent-interface", "src-port"];

/** Link-level keys that only exist on some link types (containerlab links/link_*.go) */
const TYPE_SPECIFIC_KEYS: Record<string, readonly string[]> = {
  veth: ["endpoints"],
  host: ["host-interface", "endpoint"],
  "mgmt-net": ["host-interface", "endpoint"],
  macvlan: ["host-interface", "endpoint", "mode"],
  vxlan: ["endpoint", ...VXLAN_KEYS],
  "vxlan-stitch": ["endpoint", ...VXLAN_KEYS],
  dummy: ["endpoint"]
};

const ALL_TYPE_SPECIFIC_KEYS = new Set(Object.values(TYPE_SPECIFIC_KEYS).flat());

type ScalarValue = string | number | boolean;

/** Edit value: undefined keeps the YAML value, null removes it */
type EditValue<T> = T | null | undefined;

type LinkForm = "brief" | "dual" | "single";

interface EditSide {
  /** Node id after the edit (special ids like "host:eth0" for network nodes) */
  id: string;
  iface: string | undefined;
  originalId: string;
  originalIface: string;
  special: boolean;
  mac: EditValue<string>;
  ipv4: EditValue<string>;
  ipv6: EditValue<string>;
}

interface EndpointRef {
  node: string;
  iface: string;
}

/** Returns host/mgmt-net/macvlan for brief special endpoints like "host:eth0". */
function getBriefSpecialType(endpoint: string): string | null {
  for (const type of HOSTY_TYPES) {
    if (endpoint.startsWith(`${type}:`)) return type;
  }
  return null;
}

function toEditValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (isRecord(value) && Object.keys(value).length === 0) return null;
  return value;
}

function toStringEdit(value: unknown): EditValue<string> {
  const edit = toEditValue(value);
  if (edit === undefined || edit === null) return edit;
  if (typeof edit === "string") return edit;
  if (typeof edit === "number" || typeof edit === "boolean") return String(edit);
  return undefined;
}

/** Numeric fields (mtu, vni, ports) are written as numbers when they parse as one. */
function toNumericEdit(value: unknown): EditValue<ScalarValue> {
  const edit = toStringEdit(value);
  if (edit === undefined || edit === null) return edit;
  const trimmed = edit.trim();
  const num = Number(trimmed);
  return trimmed !== "" && Number.isFinite(num) ? num : edit;
}

function toRecordEdit(value: unknown): EditValue<Record<string, unknown>> {
  const edit = toEditValue(value);
  if (edit === undefined || edit === null) return edit;
  return isRecord(edit) ? edit : undefined;
}

function keyToString(key: unknown): string {
  return YAML.isScalar(key) ? String(key.value) : String(key);
}

function findPairIndex(map: YAML.YAMLMap, key: string): number {
  return map.items.findIndex((pair) => keyToString(pair.key) === key);
}

function copyNodeComments(from: unknown, to: YAML.Node): void {
  if (!YAML.isNode(from)) return;
  to.commentBefore = from.commentBefore;
  to.comment = from.comment;
  to.spaceBefore = from.spaceBefore;
}

function createScalarNode(doc: YAML.Document, value: ScalarValue, quoted: boolean): YAML.Node {
  return quoted && typeof value === "string"
    ? createQuotedScalar(doc, value)
    : (doc.createNode(value) as YAML.Node);
}

/**
 * Sets a scalar, keeping the existing node (quoting, comments, number vs string)
 * when it already holds the same value.
 */
function setScalarValue(
  doc: YAML.Document,
  map: YAML.YAMLMap,
  key: string,
  value: ScalarValue,
  quoted = false
): void {
  const existing = map.get(key, true);
  if (YAML.isScalar(existing)) {
    if (String(existing.value) === String(value)) return;
    if (typeof existing.value === typeof value) {
      existing.value = value;
      return;
    }
  }
  const node = createScalarNode(doc, value, quoted);
  copyNodeComments(existing, node);
  map.set(key, node);
}

function applyScalarEdit(
  doc: YAML.Document,
  map: YAML.YAMLMap,
  key: string,
  edit: EditValue<ScalarValue>,
  quoted = false
): void {
  if (edit === undefined) return;
  if (edit === null) {
    map.delete(key);
    return;
  }
  setScalarValue(doc, map, key, edit, quoted);
}

/** Values the editors can show and edit as text; anything else is never removed by an edit. */
function isEditableScalar(node: unknown): boolean {
  if (!YAML.isScalar(node)) return false;
  const value = node.value;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Keeps the YAML type of an edited value (`count: 1` stays a number when edited to "2"). */
function coerceLike(previous: unknown, value: string): ScalarValue {
  if (typeof previous === "number") {
    const num = Number(value.trim());
    if (value.trim() !== "" && Number.isFinite(num)) return num;
  }
  if (typeof previous === "boolean" && (value === "true" || value === "false")) {
    return value === "true";
  }
  return value;
}

function setKeyValueEntry(
  doc: YAML.Document,
  map: YAML.YAMLMap,
  key: string,
  value: unknown
): void {
  const existing = map.get(key, true);
  if (YAML.isScalar(existing) && typeof value === "string") {
    if (String(existing.value) === value) return;
    setScalarValue(doc, map, key, coerceLike(existing.value, value));
    return;
  }
  if (YAML.isNode(existing) && deepEqual(existing.toJSON(), value)) return;
  const node = doc.createNode(value) as YAML.Node;
  copyNodeComments(existing, node);
  map.set(key, node);
}

/**
 * Merges an edited key/value map (vars, labels) into the YAML map entry by entry.
 * Entries the editor cannot show (nested maps, lists, null) are kept.
 */
function applyKeyValueMapEdit(
  doc: YAML.Document,
  parent: YAML.YAMLMap,
  key: string,
  edit: EditValue<Record<string, unknown>>
): void {
  if (edit === undefined) return;
  const desired = Object.entries(edit ?? {}).filter(([k]) => k !== "");
  const existing = parent.get(key, true);

  if (!YAML.isMap(existing)) {
    if (desired.length > 0) parent.set(key, doc.createNode(Object.fromEntries(desired)));
    return;
  }

  const desiredKeys = new Set(desired.map(([k]) => k));
  for (const pair of existing.items.slice()) {
    if (!desiredKeys.has(keyToString(pair.key)) && isEditableScalar(pair.value)) {
      existing.delete(pair.key);
    }
  }
  for (const [k, v] of desired) {
    setKeyValueEntry(doc, existing, k, v);
  }
  if (existing.items.length === 0) parent.delete(key);
}

function readYamlEndpoint(item: unknown): EndpointRef | null {
  if (YAML.isScalar(item)) {
    const str = String(item.value);
    const colon = str.indexOf(":");
    if (colon === -1) return { node: str, iface: "" };
    return { node: str.slice(0, colon), iface: str.slice(colon + 1) };
  }
  if (YAML.isMap(item)) {
    const node = item.get("node");
    const iface = item.get("interface");
    return {
      node: node === undefined || node === null ? "" : String(node),
      iface: iface === undefined || iface === null ? "" : String(iface)
    };
  }
  return null;
}

function endpointMatches(ep: EndpointRef | null, id: string, iface: string): boolean {
  if (ep === null) return false;
  if (ep.node === id && ep.iface === iface) return true;
  return ep.iface !== "" && `${ep.node}:${ep.iface}` === id;
}

/** Finds which YAML endpoint belongs to the source and which to the target side. */
function resolveSideIndexes(
  items: unknown[],
  source: EditSide,
  target: EditSide
): [number, number] {
  const eps = items.map(readYamlEndpoint);
  const srcIdx = eps.findIndex((ep) =>
    endpointMatches(ep, source.originalId, source.originalIface)
  );
  if (srcIdx !== -1) return [srcIdx, srcIdx === 0 ? 1 : 0];
  const tgtIdx = eps.findIndex((ep) =>
    endpointMatches(ep, target.originalId, target.originalIface)
  );
  if (tgtIdx !== -1) return [tgtIdx === 0 ? 1 : 0, tgtIdx];
  return [0, 1];
}

function buildEditSide(
  linkData: LinkSaveData,
  isSource: boolean,
  macOverride: EditValue<string>
): EditSide {
  const extra = linkData.extraData ?? {};
  const id = isSource ? linkData.source : linkData.target;
  const iface = isSource ? linkData.sourceEndpoint : linkData.targetEndpoint;
  const originalId = (isSource ? linkData.originalSource : linkData.originalTarget) ?? id;
  const originalIface =
    (isSource ? linkData.originalSourceEndpoint : linkData.originalTargetEndpoint) ?? iface ?? "";
  const special = isSpecialNode(id);
  const sideMac = toStringEdit(isSource ? extra.extSourceMac : extra.extTargetMac);
  return {
    id,
    iface,
    originalId,
    originalIface,
    special,
    mac: !special && macOverride !== undefined ? macOverride : sideMac,
    ipv4: toStringEdit(isSource ? extra.extSourceIpv4 : extra.extTargetIpv4),
    ipv6: toStringEdit(isSource ? extra.extSourceIpv6 : extra.extTargetIpv6)
  };
}

function buildEditSides(linkData: LinkSaveData): { source: EditSide; target: EditSide } {
  const extra = linkData.extraData ?? {};
  // extMac (network node editor) is the MAC of the node side of a single-endpoint link
  const singleEndpoint = isSpecialNode(linkData.source) || isSpecialNode(linkData.target);
  const macOverride = singleEndpoint ? toStringEdit(extra.extMac) : undefined;
  return {
    source: buildEditSide(linkData, true, macOverride),
    target: buildEditSide(linkData, false, macOverride)
  };
}

function describeYamlLink(linkMap: YAML.YAMLMap): { form: LinkForm; type: string } {
  const type = linkMap.get("type");
  if (typeof type === "string" && type !== "") {
    return { form: SINGLE_ENDPOINT_TYPES.has(type) ? "single" : "dual", type };
  }
  let briefType = "veth";
  const endpoints = linkMap.get("endpoints", true);
  if (YAML.isSeq(endpoints)) {
    for (const item of endpoints.items) {
      const special = YAML.isScalar(item) ? getBriefSpecialType(String(item.value)) : null;
      if (special !== null) briefType = special;
    }
  }
  return { form: "brief", type: briefType };
}

function resolveEditedLinkType(linkData: LinkSaveData, currentType: string): string {
  const extType = linkData.extraData?.extType;
  const rawType = typeof extType === "string" ? extType.trim() : "";
  if (rawType !== "" && rawType !== "veth") return rawType;
  const inferred = inferSpecialLinkType(linkData);
  if (inferred !== null && inferred !== "") return inferred;
  return rawType === "veth" ? "veth" : currentType;
}

function getRealAndSpecialSides(sides: { source: EditSide; target: EditSide }): {
  real: EditSide;
  special: EditSide;
} {
  return sides.source.special
    ? { real: sides.target, special: sides.source }
    : { real: sides.source, special: sides.target };
}

function readListItem(linkMap: YAML.YAMLMap, key: string, index: number): string {
  const list = linkMap.get(key, true);
  if (!YAML.isSeq(list)) return "";
  const item: unknown = list.items[index];
  if (YAML.isScalar(item)) return item.value === null ? "" : String(item.value);
  return "";
}

/** Writes an endpoint address into the brief link-level `ipv4`/`ipv6` list. */
function applyBriefIpEdit(
  doc: YAML.Document,
  linkMap: YAML.YAMLMap,
  key: "ipv4" | "ipv6",
  index: number,
  edit: EditValue<string>
): void {
  if (edit === undefined) return;
  const desired = edit ?? "";
  if (readListItem(linkMap, key, index) === desired) return;

  const list: unknown = linkMap.get(key, true);
  let seq: YAML.YAMLSeq;
  if (YAML.isSeq(list)) {
    seq = list;
  } else {
    if (desired === "") return;
    seq = new YAML.YAMLSeq();
    seq.flow = true;
    linkMap.set(key, seq);
  }
  while (seq.items.length <= index) seq.items.push(createQuotedScalar(doc, ""));
  const item: unknown = seq.items[index];
  if (YAML.isScalar(item)) {
    item.value = desired;
  } else {
    seq.items[index] = createQuotedScalar(doc, desired);
  }
  while (seq.items.length > 0 && readListItem(linkMap, key, seq.items.length - 1) === "") {
    seq.items.pop();
  }
  if (seq.items.length === 0) linkMap.delete(key);
}

/** True when a brief link cannot hold the edit and must be written in extended form. */
function briefNeedsExtended(
  linkMap: YAML.YAMLMap,
  desiredType: string,
  sides: { source: EditSide; target: EditSide },
  extra: NonNullable<LinkSaveData["extraData"]>
): boolean {
  if (!BRIEF_LINK_TYPES.has(desiredType)) return true;
  const endpoints = linkMap.get("endpoints", true);
  if (!YAML.isSeq(endpoints)) return true;
  if (typeof sides.source.mac === "string" || typeof sides.target.mac === "string") return true;
  if (desiredType === "veth") return false;

  if (desiredType === "macvlan" && typeof toStringEdit(extra.extMode) === "string") return true;
  // Brief host links have no per-endpoint addresses
  const [srcIdx, tgtIdx] = resolveSideIndexes(endpoints.items, sides.source, sides.target);
  const { real } = getRealAndSpecialSides(sides);
  const realIdx = real === sides.source ? srcIdx : tgtIdx;
  return (["ipv4", "ipv6"] as const).some((key) => {
    const edit = real[key];
    return typeof edit === "string" && edit !== readListItem(linkMap, key, realIdx);
  });
}

function createEndpointMap(doc: YAML.Document, ep: EndpointRef): YAML.YAMLMap {
  const epMap = new YAML.YAMLMap();
  epMap.flow = false;
  epMap.set("node", createQuotedScalar(doc, ep.node));
  if (ep.iface !== "") epMap.set("interface", createQuotedScalar(doc, ep.iface));
  return epMap;
}

function insertTypePair(doc: YAML.Document, linkMap: YAML.YAMLMap, type: string): void {
  linkMap.items.unshift(doc.createPair("type", type));
}

/** Replaces the pair at `key` by new pairs, keeping its position and comments. */
function replacePair(
  doc: YAML.Document,
  linkMap: YAML.YAMLMap,
  key: string,
  pairs: Array<[string, unknown]>
): void {
  const index = findPairIndex(linkMap, key);
  const created = pairs.map(([k, v]) => doc.createPair(k, v) as YAML.Pair<unknown, unknown>);
  if (index === -1) {
    linkMap.items.push(...created);
    return;
  }
  const old = linkMap.items[index];
  if (created.length > 0 && YAML.isNode(created[0].key)) copyNodeComments(old.key, created[0].key);
  linkMap.items.splice(index, 1, ...created);
}

/**
 * Converts a brief link to its extended form in place. Everything the brief
 * entry holds (mtu, vars, labels, unknown keys, comments, addresses) is kept.
 */
function convertBriefToExtended(
  doc: YAML.Document,
  linkMap: YAML.YAMLMap,
  briefType: string
): void {
  const endpoints = linkMap.get("endpoints", true);
  if (!YAML.isSeq(endpoints)) return;

  if (briefType === "veth") {
    endpoints.items = endpoints.items.map((item, index) => {
      const ep = readYamlEndpoint(item);
      if (ep === null) return item;
      const epMap = createEndpointMap(doc, ep);
      for (const key of ["ipv4", "ipv6"]) {
        const address = readListItem(linkMap, key, index).trim();
        if (address !== "") epMap.set(key, doc.createNode(address));
      }
      copyNodeComments(item, epMap);
      return epMap;
    });
    endpoints.flow = false;
    // Link-level address lists only apply to brief links; they now live on the endpoints
    linkMap.delete("ipv4");
    linkMap.delete("ipv6");
    insertTypePair(doc, linkMap, "veth");
    return;
  }

  const realItem = endpoints.items.find(
    (item) => !(YAML.isScalar(item) && getBriefSpecialType(String(item.value)) !== null)
  );
  const specialItem = endpoints.items.find((item) => item !== realItem);
  const realEp = readYamlEndpoint(realItem);
  const specialEp = readYamlEndpoint(specialItem);
  if (realEp === null || specialEp === null) return;

  const epMap = createEndpointMap(doc, realEp);
  copyNodeComments(realItem, epMap);
  replacePair(doc, linkMap, "endpoints", [
    ["endpoint", epMap],
    ["host-interface", specialEp.iface]
  ]);
  insertTypePair(doc, linkMap, briefType);
}

/**
 * Switches an extended link to another type in place: keys that are not valid
 * for the new type are removed, endpoints are carried over.
 */
function changeExtendedLinkType(
  doc: YAML.Document,
  linkMap: YAML.YAMLMap,
  toType: string,
  sides: { source: EditSide; target: EditSide }
): void {
  const toSingle = SINGLE_ENDPOINT_TYPES.has(toType);
  setScalarValue(doc, linkMap, "type", toType);

  const allowed = new Set(TYPE_SPECIFIC_KEYS[toType] ?? []);
  for (const pair of linkMap.items.slice()) {
    const key = keyToString(pair.key);
    if (key === "endpoint" || key === "endpoints") continue;
    if (ALL_TYPE_SPECIFIC_KEYS.has(key) && !allowed.has(key)) linkMap.delete(pair.key);
  }

  const endpoints = linkMap.get("endpoints", true);
  const endpoint = linkMap.get("endpoint", true);
  if (toSingle && YAML.isSeq(endpoints)) {
    const [srcIdx, tgtIdx] = resolveSideIndexes(endpoints.items, sides.source, sides.target);
    const keepIdx = sides.source.special ? tgtIdx : srcIdx;
    const kept: unknown = endpoints.items[keepIdx];
    const real = getRealAndSpecialSides(sides).real;
    const epMap = YAML.isMap(kept)
      ? kept
      : createEndpointMap(doc, { node: real.id, iface: real.iface ?? "" });
    replacePair(doc, linkMap, "endpoints", [["endpoint", epMap]]);
  } else if (!toSingle && YAML.isMap(endpoint)) {
    const seq = new YAML.YAMLSeq();
    seq.flow = false;
    const other = (side: EditSide) => createEndpointMap(doc, { node: side.id, iface: side.iface ?? "" });
    const existingIsSource = endpoint.get("node") === sides.source.originalId;
    seq.items = existingIsSource
      ? [endpoint, other(sides.target)]
      : [other(sides.source), endpoint];
    replacePair(doc, linkMap, "endpoint", [["endpoints", seq]]);
  }
}

function setEndpointScalar(
  doc: YAML.Document,
  seq: YAML.YAMLSeq,
  index: number,
  value: string
): void {
  const item: unknown = seq.items[index];
  if (YAML.isScalar(item)) {
    if (String(item.value) !== value) item.value = value;
    return;
  }
  seq.items[index] = createQuotedScalar(doc, value);
}

function resolveHostInterface(
  extra: NonNullable<LinkSaveData["extraData"]>,
  special: EditSide
): string | undefined {
  const edit = toStringEdit(extra.extHostInterface);
  if (typeof edit === "string") return edit;
  return extractSpecialNodeInterface(special.id);
}

function applyBriefEdit(
  doc: YAML.Document,
  linkMap: YAML.YAMLMap,
  type: string,
  sides: { source: EditSide; target: EditSide },
  extra: NonNullable<LinkSaveData["extraData"]>
): void {
  const endpoints = linkMap.get("endpoints", true);
  if (!YAML.isSeq(endpoints)) return;
  const indexes = resolveSideIndexes(endpoints.items, sides.source, sides.target);

  [sides.source, sides.target].forEach((side, i) => {
    const index = indexes[i];
    const current = readYamlEndpoint(endpoints.items[index]);
    if (side.special) {
      const hostIface = resolveHostInterface(extra, side) ?? current?.iface ?? "";
      setEndpointScalar(doc, endpoints, index, `${type}:${hostIface}`);
      return;
    }
    const iface = hasText(side.iface) ? side.iface : (current?.iface ?? "");
    setEndpointScalar(doc, endpoints, index, iface !== "" ? `${side.id}:${iface}` : side.id);
    if (type === "veth") {
      applyBriefIpEdit(doc, linkMap, "ipv4", index, side.ipv4);
      applyBriefIpEdit(doc, linkMap, "ipv6", index, side.ipv6);
    }
  });
}

function applyEndpointMapEdit(doc: YAML.Document, epMap: YAML.YAMLMap, side: EditSide): void {
  setScalarValue(doc, epMap, "node", side.id, true);
  if (hasText(side.iface)) setScalarValue(doc, epMap, "interface", side.iface, true);
  applyScalarEdit(doc, epMap, "mac", side.mac);
  applyScalarEdit(doc, epMap, "ipv4", side.ipv4);
  applyScalarEdit(doc, epMap, "ipv6", side.ipv6);
}

function applyDualEndpointEdit(
  doc: YAML.Document,
  linkMap: YAML.YAMLMap,
  sides: { source: EditSide; target: EditSide }
): void {
  const endpoints = linkMap.get("endpoints", true);
  if (!YAML.isSeq(endpoints)) return;
  const indexes = resolveSideIndexes(endpoints.items, sides.source, sides.target);
  [sides.source, sides.target].forEach((side, i) => {
    const item: unknown = endpoints.items[indexes[i]];
    if (YAML.isMap(item)) {
      applyEndpointMapEdit(doc, item, side);
    } else if (YAML.isScalar(item)) {
      setEndpointScalar(doc, endpoints, indexes[i], hasText(side.iface) ? `${side.id}:${side.iface}` : side.id);
    }
  });
}

function applySingleEndpointEdit(
  doc: YAML.Document,
  linkMap: YAML.YAMLMap,
  sides: { source: EditSide; target: EditSide }
): void {
  const { real } = getRealAndSpecialSides(sides);
  const existing: unknown = linkMap.get("endpoint", true);
  let epMap: YAML.YAMLMap;
  if (YAML.isMap(existing)) {
    epMap = existing;
  } else {
    epMap = createEndpointMap(doc, { node: real.id, iface: real.iface ?? "" });
    linkMap.set("endpoint", epMap);
  }
  applyEndpointMapEdit(doc, epMap, real);
}

function applyVxlanEdit(
  doc: YAML.Document,
  linkMap: YAML.YAMLMap,
  extra: NonNullable<LinkSaveData["extraData"]>,
  special: EditSide,
  typeChanged: boolean
): void {
  // remote and vni are required, clearing them in a form keeps the YAML value
  const remote = toStringEdit(extra.extRemote);
  if (typeof remote === "string") setScalarValue(doc, linkMap, "remote", remote);
  const vni = toNumericEdit(extra.extVni);
  if (vni !== null && vni !== undefined) setScalarValue(doc, linkMap, "vni", vni);

  // dst-port replaced the deprecated udp-port; edit whichever the link already uses
  const dstKey = !linkMap.has("dst-port") && linkMap.has("udp-port") ? "udp-port" : "dst-port";
  applyScalarEdit(doc, linkMap, dstKey, toNumericEdit(extra.extDstPort));
  applyScalarEdit(doc, linkMap, "src-port", toNumericEdit(extra.extSrcPort));

  if (!typeChanged) return;
  const parsed = extractVxlanProperties(special.id);
  if (!linkMap.has("remote")) {
    linkMap.set("remote", doc.createNode(parsed.remote ?? VXLAN_DEFAULTS.remote));
  }
  if (!linkMap.has("vni")) {
    linkMap.set("vni", doc.createNode(toNumber(parsed.vni, VXLAN_DEFAULTS.vni)));
  }
  if (!linkMap.has("dst-port") && !linkMap.has("udp-port")) {
    linkMap.set("dst-port", doc.createNode(toNumber(parsed.dstPort, VXLAN_DEFAULTS.dstPort)));
  }
}

function applyTypeSpecificEdit(
  doc: YAML.Document,
  linkMap: YAML.YAMLMap,
  type: string,
  extra: NonNullable<LinkSaveData["extraData"]>,
  sides: { source: EditSide; target: EditSide },
  typeChanged: boolean
): void {
  const { special } = getRealAndSpecialSides(sides);
  if (HOSTY_TYPES.has(type)) {
    const hostIface = resolveHostInterface(extra, special);
    if (hasText(hostIface)) setScalarValue(doc, linkMap, "host-interface", hostIface);
    if (type === "macvlan") applyScalarEdit(doc, linkMap, "mode", toStringEdit(extra.extMode));
  } else if (type === "vxlan" || type === "vxlan-stitch") {
    applyVxlanEdit(doc, linkMap, extra, special, typeChanged);
  }
}

/**
 * Applies an edit to an existing link entry in place.
 */
function mergeLinkEdit(doc: YAML.Document, linkMap: YAML.YAMLMap, linkData: LinkSaveData): void {
  const extra = linkData.extraData ?? {};
  const current = describeYamlLink(linkMap);
  const desiredType = resolveEditedLinkType(linkData, current.type);
  const sides = buildEditSides(linkData);

  let form = current.form;
  let currentType = current.type;
  if (form === "brief" && briefNeedsExtended(linkMap, desiredType, sides, extra)) {
    convertBriefToExtended(doc, linkMap, currentType);
    form = SINGLE_ENDPOINT_TYPES.has(currentType) ? "single" : "dual";
  }
  const typeChanged = currentType !== desiredType;
  if (form !== "brief" && typeChanged) {
    changeExtendedLinkType(doc, linkMap, desiredType, sides);
    form = SINGLE_ENDPOINT_TYPES.has(desiredType) ? "single" : "dual";
    currentType = desiredType;
  }

  if (form === "brief") {
    applyBriefEdit(doc, linkMap, desiredType, sides, extra);
  } else if (form === "single") {
    applySingleEndpointEdit(doc, linkMap, sides);
    applyTypeSpecificEdit(doc, linkMap, currentType, extra, sides, typeChanged);
  } else {
    applyDualEndpointEdit(doc, linkMap, sides);
  }

  applyScalarEdit(doc, linkMap, "mtu", toNumericEdit(extra.extMtu));
  applyKeyValueMapEdit(doc, linkMap, "vars", toRecordEdit(extra.extVars));
  applyKeyValueMapEdit(doc, linkMap, "labels", toRecordEdit(extra.extLabels));
}

/**
 * Adds a new link to the topology
 */
export function addLinkToDoc(
  doc: YAML.Document.Parsed,
  linkData: LinkSaveData,
  logger: IOLogger = noopLogger
): SaveResult {
  try {
    // Ensure links array exists
    const linksNode = doc.getIn(["topology", "links"], true);
    let linksSeq: YAML.YAMLSeq;
    if (YAML.isSeq(linksNode)) {
      linksSeq = linksNode;
    } else {
      linksSeq = new YAML.YAMLSeq();
      linksSeq.flow = false;
      const topoNode = doc.getIn(["topology"], true);
      if (YAML.isMap(topoNode)) {
        const topoMap = topoNode;
        topoMap.set("links", linksSeq);
      } else {
        return { success: false, error: "YAML topology is not a map" };
      }
    }

    // Check for duplicate
    const newKey = getLinkKey(linkData);
    for (const item of linksSeq.items) {
      if (YAML.isMap(item)) {
        const existingKey = getYamlLinkKey(item);
        if (existingKey === newKey) {
          return { success: false, error: "Link already exists" };
        }
      }
    }

    // Create the link
    const linkMap = hasExtendedProperties(linkData)
      ? createExtendedLink(doc, linkData)
      : createBriefLink(doc, linkData);

    linksSeq.add(linkMap);

    logger.info(`[SaveTopology] Added link: ${linkData.source} <-> ${linkData.target}`);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Updates an existing link in the topology.
 *
 * Only the fields carried by `linkData.extraData` are changed: a key that is
 * absent (or undefined) keeps the YAML value, an empty string / empty map
 * removes it, any other value sets it.
 */
export function editLinkInDoc(
  doc: YAML.Document.Parsed,
  linkData: LinkSaveData,
  logger: IOLogger = noopLogger
): SaveResult {
  try {
    const linksSeq = getValidatedLinksSeq(doc);
    if (!YAML.isSeq(linksSeq)) return linksSeq;

    // Use original values to find the existing link (if endpoints were changed)
    const lookupKey = getLookupKey(linkData);
    let found = false;

    logger.info(`[SaveTopology] Looking for link with key: ${lookupKey}`);

    const tryUpdateWithKey = (key: string): boolean => {
      for (let i = 0; i < linksSeq.items.length; i++) {
        const item = linksSeq.items[i];
        if (!YAML.isMap(item)) continue;

        const existingKey = getYamlLinkKey(item);
        if (existingKey === key) {
          // Merge the edit into the existing entry so keys, comments and the
          // brief/extended form the editor does not own are kept.
          mergeLinkEdit(doc, item, linkData);
          logger.info(`[SaveTopology] Found and updated link at index ${i}`);
          return true;
        }
      }
      return false;
    };

    found = tryUpdateWithKey(lookupKey);

    if (!found) {
      const legacyKey = getLegacyLookupKey(linkData);
      if (legacyKey !== lookupKey) {
        logger.info(`[SaveTopology] Falling back to legacy link key: ${legacyKey}`);
        found = tryUpdateWithKey(legacyKey);
      }
    }

    if (!found) {
      return { success: false, error: `Link not found (lookup key: ${lookupKey})` };
    }

    logger.info(
      `[SaveTopology] Updated link: ${linkData.source}:${linkData.sourceEndpoint} <-> ${linkData.target}:${linkData.targetEndpoint}`
    );
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Removes a link from the topology
 */
export function deleteLinkFromDoc(
  doc: YAML.Document.Parsed,
  linkData: LinkSaveData,
  logger: IOLogger = noopLogger
): SaveResult {
  try {
    const linksSeq = getValidatedLinksSeq(doc);
    if (!YAML.isSeq(linksSeq)) return linksSeq;

    const targetKey = getLinkKey(linkData);
    const initialLength = linksSeq.items.length;

    linksSeq.items = linksSeq.items.filter((item) => {
      if (!YAML.isMap(item)) return true;
      const existingKey = getYamlLinkKey(item);
      return existingKey !== targetKey;
    });

    if (linksSeq.items.length === initialLength) {
      const legacyKey = getLegacyLookupKey(linkData);
      if (legacyKey !== targetKey) {
        linksSeq.items = linksSeq.items.filter((item) => {
          if (!YAML.isMap(item)) return true;
          const existingKey = getYamlLinkKey(item);
          return existingKey !== legacyKey;
        });
      }
    }

    if (linksSeq.items.length === initialLength) {
      return { success: false, error: "Link not found" };
    }

    logger.info(`[SaveTopology] Deleted link: ${linkData.source} <-> ${linkData.target}`);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
