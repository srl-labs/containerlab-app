/**
 * Common link/node type constants and helpers for React TopoViewer.
 */
import { HOST_TYPES, SINGLE_ENDPOINT_NETWORK_TYPES } from "../types/editors";

export const STR_HOST = "host" as const;
export const STR_MGMT_NET = "mgmt-net" as const;
export const PREFIX_MACVLAN = "macvlan:" as const;
export const PREFIX_VXLAN = "vxlan:" as const;
export const PREFIX_VXLAN_STITCH = "vxlan-stitch:" as const;
export const PREFIX_DUMMY = "dummy" as const;
const PREFIX_BRIDGE = "bridge:" as const;
const PREFIX_OVS_BRIDGE = "ovs-bridge:" as const;

export const SINGLE_ENDPOINT_TYPES = new Set<string>(SINGLE_ENDPOINT_NETWORK_TYPES);

export const HOSTY_TYPES = new Set<string>(HOST_TYPES);

/**
 * Determines if a node ID represents a special endpoint.
 */
export function isSpecialEndpointId(nodeId: string): boolean {
  return (
    nodeId.startsWith(`${STR_HOST}:`) ||
    nodeId.startsWith(`${STR_MGMT_NET}:`) ||
    nodeId.startsWith(PREFIX_MACVLAN) ||
    nodeId.startsWith(PREFIX_VXLAN) ||
    nodeId.startsWith(PREFIX_VXLAN_STITCH) ||
    nodeId.startsWith("dummy") ||
    nodeId.startsWith(PREFIX_BRIDGE) ||
    nodeId.startsWith(PREFIX_OVS_BRIDGE)
  );
}

/**
 * Splits an endpoint string or object into node and interface components.
 */
export function splitEndpointLike(endpoint: string | { node: string; interface?: string }): {
  node: string;
  iface: string;
} {
  if (typeof endpoint === "string") {
    if (
      endpoint.startsWith(PREFIX_MACVLAN) ||
      endpoint.startsWith(PREFIX_DUMMY) ||
      endpoint.startsWith(PREFIX_VXLAN) ||
      endpoint.startsWith(PREFIX_VXLAN_STITCH)
    ) {
      return { node: endpoint, iface: "" };
    }
    const parts = endpoint.split(":");
    if (parts.length === 2) return { node: parts[0], iface: parts[1] };
    return { node: endpoint, iface: "" };
  }
  return { node: endpoint.node, iface: endpoint.interface ?? "" };
}
