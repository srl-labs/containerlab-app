/**
 * Utility functions for converting between NetworkEditorData and
 * Node data format for network nodes
 */

import type { NetworkEditorData, NetworkType } from "../types/editors";
import { BRIDGE_TYPES, HOST_TYPES, NETWORK_TYPES } from "../types/editors";

import { toEditableStringMap } from "./LinkTypes";
import { getStringOrEmpty, isRecord } from "./typeHelpers";

/**
 * Parse network type from node data
 * Checks in order: extraData.kind, top-level kind, top-level type, parse from ID
 * Network node IDs follow patterns like: "host:eth0", "mgmt-net:eth1", "bridge:br0"
 */
function parseNetworkType(
  nodeId: string,
  rawData: Record<string, unknown>,
  extraData: Record<string, unknown>
): NetworkType {
  // Check extraData.kind first (new network creation format)
  const extraKind = getStringOrEmpty(extraData.kind);
  if (extraKind && isValidNetworkType(extraKind)) {
    return extraKind;
  }

  // Check top-level kind field
  const topKind = getStringOrEmpty(rawData.kind);
  if (topKind && isValidNetworkType(topKind)) {
    return topKind;
  }

  // Check top-level type field (mock data format)
  const topType = getStringOrEmpty(rawData.type);
  if (topType && isValidNetworkType(topType)) {
    return topType;
  }

  // Fall back to parsing from node ID
  const parts = nodeId.split(":");
  const prefix = parts[0];
  if (isValidNetworkType(prefix)) {
    return prefix;
  }

  // Default to host if we can't determine
  return "host";
}

/**
 * Check if a string is a valid network type
 */
function isValidNetworkType(type: string): type is NetworkType {
  return NETWORK_TYPES.some((t) => t === type);
}

/** Host-like types that have host-interface property */
const HOST_INTERFACE_TYPES = new Set<NetworkType>(HOST_TYPES);

/**
 * Parse interface name from node ID or extraData
 * For network nodes, prefers extHostInterface from extraData if available,
 * otherwise falls back to extracting from node ID (e.g., "host:eth0" -> "eth0")
 * For bridges, it might be the full ID or from extYamlNodeId
 */
function parseInterfaceName(
  nodeId: string,
  networkType: NetworkType,
  extraData: Record<string, unknown>
): string {
  // For bridges, prefer extYamlNodeId if available
  if (BRIDGE_TYPES.includes(networkType)) {
    const yamlId = getStringOrEmpty(extraData.extYamlNodeId);
    if (yamlId) return yamlId;
    return nodeId;
  }

  // For dummy, there's no interface
  if (networkType === "dummy") {
    return "";
  }

  // For host-interface types, check extHostInterface first (saved by network editor)
  if (HOST_INTERFACE_TYPES.has(networkType)) {
    const hostInterface = getStringOrEmpty(extraData.extHostInterface);
    if (hostInterface) return hostInterface;
  }

  // Fall back to extracting from node ID
  const parts = nodeId.split(":");
  return parts[1] || "eth1";
}

/**
 * Converts raw network node data (from the graph) to NetworkEditorData format
 */
export function convertToNetworkEditorData(
  rawData: Record<string, unknown> | null
): NetworkEditorData | null {
  if (!rawData) return null;

  const nodeId = getStringOrEmpty(rawData.id);
  // Keep non-string values: extVars/extLabels are maps
  const extra = isRecord(rawData.extraData) ? rawData.extraData : {};
  const networkType = parseNetworkType(nodeId, rawData, extra);

  return {
    id: nodeId,
    networkType,
    interfaceName: parseInterfaceName(nodeId, networkType, extra),
    label: getStringOrEmpty(rawData.name) || getStringOrEmpty(rawData.label) || nodeId,
    // VXLAN fields
    vxlanRemote: getStringOrEmpty(extra.extRemote),
    vxlanVni: getStringOrEmpty(extra.extVni),
    vxlanDstPort: getStringOrEmpty(extra.extDstPort),
    vxlanSrcPort: getStringOrEmpty(extra.extSrcPort),
    // MACVLAN mode
    macvlanMode: getStringOrEmpty(extra.extMode),
    // MAC address
    mac: getStringOrEmpty(extra.extMac),
    // MTU
    mtu: getStringOrEmpty(extra.extMtu),
    // Optional metadata (check extVars/extLabels first, fall back to vars/labels)
    vars: toEditableStringMap(extra.extVars) ?? toEditableStringMap(extra.vars),
    labels: toEditableStringMap(extra.extLabels) ?? toEditableStringMap(extra.labels)
  };
}

/**
 * Convert NetworkEditorData back to extraData format for saving
 */
export function convertNetworkEditorDataToYaml(data: NetworkEditorData): Record<string, unknown> {
  const hasNonEmptyString = (value: string | undefined): value is string =>
    value !== undefined && value.length > 0;

  const result: Record<string, unknown> = {
    kind: data.networkType
  };

  // VXLAN-specific fields
  if (hasNonEmptyString(data.vxlanRemote)) result.extRemote = data.vxlanRemote;
  if (hasNonEmptyString(data.vxlanVni)) result.extVni = data.vxlanVni;
  if (hasNonEmptyString(data.vxlanDstPort)) result.extDstPort = data.vxlanDstPort;
  if (hasNonEmptyString(data.vxlanSrcPort)) result.extSrcPort = data.vxlanSrcPort;

  // MACVLAN mode
  if (hasNonEmptyString(data.macvlanMode)) result.extMode = data.macvlanMode;

  // MAC address
  if (hasNonEmptyString(data.mac)) result.extMac = data.mac;

  // MTU
  if (hasNonEmptyString(data.mtu)) result.extMtu = data.mtu;

  // Metadata
  if (data.vars !== undefined && Object.keys(data.vars).length > 0) result.vars = data.vars;
  if (data.labels !== undefined && Object.keys(data.labels).length > 0) result.labels = data.labels;

  return result;
}

/** VXLAN types that need link property updates */
const VXLAN_NETWORK_TYPES = new Set<NetworkType>(["vxlan", "vxlan-stitch"]);

function toOptionalNumber(value: string | undefined): number | undefined {
  if (value == null || value.length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nonEmptyMap(
  value: Record<string, string> | undefined
): Record<string, string> | undefined {
  return value && Object.keys(value).length > 0 ? value : undefined;
}

/**
 * Convert NetworkEditorData of a link-based network (host, mgmt-net, macvlan,
 * vxlan, dummy) to the extraData of its links
 */
export function convertNetworkEditorDataToLinkExtraData(
  data: NetworkEditorData
): Record<string, unknown> {
  const extraData: Record<string, unknown> = { extType: data.networkType };
  if (VXLAN_NETWORK_TYPES.has(data.networkType)) {
    Object.assign(extraData, {
      extRemote: data.vxlanRemote ?? undefined,
      extVni: toOptionalNumber(data.vxlanVni),
      extDstPort: toOptionalNumber(data.vxlanDstPort),
      extSrcPort: toOptionalNumber(data.vxlanSrcPort)
    });
  }
  if (HOST_INTERFACE_TYPES.has(data.networkType)) {
    extraData.extHostInterface = data.interfaceName || undefined;
    extraData.extMode =
      data.networkType === "macvlan" ? (data.macvlanMode ?? undefined) : undefined;
  }
  Object.assign(extraData, {
    extMtu: toOptionalNumber(data.mtu),
    extMac: data.mac ?? undefined,
    extVars: nonEmptyMap(data.vars),
    extLabels: nonEmptyMap(data.labels)
  });
  return extraData;
}

/**
 * Builds the editLink extraData for the links of an edited network node.
 * Only fields that differ from `before` are sent (an empty string clears a
 * field), so the links keep everything the user did not touch and a network
 * with several links does not copy one link's values onto the others.
 */
export function buildNetworkLinkEditExtraData(
  data: NetworkEditorData,
  before: NetworkEditorData | null
): Record<string, unknown> {
  const next = convertNetworkEditorDataToLinkExtraData(data);
  const previous = before ? convertNetworkEditorDataToLinkExtraData(before) : undefined;
  const extraData: Record<string, unknown> = { extType: next.extType };
  for (const [key, value] of Object.entries(next)) {
    if (previous && JSON.stringify(previous[key]) === JSON.stringify(value)) continue;
    extraData[key] = value ?? "";
  }
  return extraData;
}
