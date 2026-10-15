/**
 * Which management network a node joins, following containerlab's rules for
 * `mgmt` lists and `mgmt-net` (containerlab 0.80+).
 */
import type { MgmtSettings } from "../types/labSettings";
import { getMgmtNetworkName } from "../types/labSettings";

import { CONTAINER_NETWORK_MODE_PREFIX } from "./nodeEditorConversions";

export const MGMT_NET_KEY = "mgmt-net";

/** Kinds that run in the host namespace or attach existing containers; they take no mgmt-net. */
const MGMT_NET_EXEMPT_KINDS = new Set(["host", "bridge", "ovs-bridge", "ext-container"]);

/** Docker defaults for the first bridge network without a subnet. */
const DEFAULT_IPV4_SUBNET = "172.20.20.0/24";
const DEFAULT_IPV6_SUBNET = "3fff:172:20:20::/64";

/** Colours for management network badges, in network order. */
const MGMT_NETWORK_COLORS = [
  "#2563EB",
  "#D97706",
  "#7C3AED",
  "#0D9488",
  "#DB2777",
  "#65A30D",
  "#0284C7",
  "#B45309"
];

export const MGMT_NETWORK_MISSING_COLOR = "#DC2626";

/** When nodes show their management network dot: always, or while hovered. */
export type MgmtNetworkBadgeMode = "always" | "hover";

export const DEFAULT_MGMT_NETWORK_BADGE: MgmtNetworkBadgeMode = "hover";

export function parseMgmtNetworkBadgeMode(value: unknown): MgmtNetworkBadgeMode | null {
  return value === "always" || value === "hover" ? value : null;
}

export function getMgmtNetworkColor(index: number): string {
  return MGMT_NETWORK_COLORS[index % MGMT_NETWORK_COLORS.length];
}

export type NodeMgmtNetwork =
  /** Joins the network at `index`; `explicit` when the node or an inherited level names it. */
  | { status: "ok"; index: number; name: string; explicit: boolean }
  /** Several networks are defined and the node names none. */
  | { status: "missing" }
  /** The node names a network that is not defined. */
  | { status: "unknown"; name: string }
  /** Network mode or kind without a management network interface. */
  | { status: "exempt" };

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** True when containerlab ignores `mgmt-net` for the node. */
export function isMgmtNetExempt(kind: unknown, networkMode: unknown): boolean {
  const mode = stringValue(networkMode);
  if (mode === "host" || mode === "none" || mode.startsWith(CONTAINER_NETWORK_MODE_PREFIX)) {
    return true;
  }
  return MGMT_NET_EXEMPT_KINDS.has(stringValue(kind));
}

/**
 * Resolves the management network of a node from its effective (inherited)
 * `mgmt-net`. Without a `mgmt` section the lab has one unnamed network (`clab`).
 */
export function resolveNodeMgmtNetwork(
  mgmtNet: unknown,
  networks: MgmtSettings[],
  options: { kind?: unknown; networkMode?: unknown } = {}
): NodeMgmtNetwork {
  if (isMgmtNetExempt(options.kind, options.networkMode)) return { status: "exempt" };
  const names = networks.length > 0 ? networks.map(getMgmtNetworkName) : [getMgmtNetworkName({})];
  const name = stringValue(mgmtNet);
  if (name === "") {
    return names.length > 1
      ? { status: "missing" }
      : { status: "ok", index: 0, name: names[0], explicit: false };
  }
  const index = names.indexOf(name);
  return index >= 0 ? { status: "ok", index, name, explicit: true } : { status: "unknown", name };
}

/**
 * Subnet the network hands out addresses from, when known. The first bridge
 * network falls back to the Docker defaults; `auto` and runtime-assigned
 * subnets are unknown.
 */
export function getMgmtNetworkSubnet(
  network: MgmtSettings | undefined,
  isDefault: boolean,
  family: "ipv4" | "ipv6"
): string | undefined {
  const v4 = stringValue(network?.["ipv4-subnet"]);
  const v6 = stringValue(network?.["ipv6-subnet"]);
  const subnet = family === "ipv4" ? v4 : v6;
  if (subnet !== "") return subnet === "auto" ? undefined : subnet;
  const usesDefaults = isDefault && v4 === "" && v6 === "" && network?.driver !== "macvlan";
  if (!usesDefaults) return undefined;
  return family === "ipv4" ? DEFAULT_IPV4_SUBNET : DEFAULT_IPV6_SUBNET;
}

function parseIpv4(address: string): bigint | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIpv6Groups(text: string): number[] | undefined {
  if (text === "") return [];
  const groups: number[] = [];
  const parts = text.split(":");
  for (const [index, part] of parts.entries()) {
    // An embedded IPv4 address takes the last two groups.
    if (index === parts.length - 1 && part.includes(".")) {
      const v4 = parseIpv4(part);
      if (v4 === undefined) return undefined;
      groups.push(Number(v4 >> 16n), Number(v4 & 0xffffn));
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return undefined;
    groups.push(parseInt(part, 16));
  }
  return groups;
}

function parseIpv6(address: string): bigint | undefined {
  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const head = parseIpv6Groups(halves[0]);
  const tail = halves.length === 2 ? parseIpv6Groups(halves[1]) : [];
  if (!head || !tail) return undefined;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined;
  const groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

/**
 * True when the address lies in the CIDR subnet; undefined when either side
 * cannot be parsed (or the families differ).
 */
export function isAddressInSubnet(address: string, subnet: string): boolean | undefined {
  const [network, ...rest] = subnet.trim().split("/");
  const prefixText = rest.length > 0 ? rest.join("/") : undefined;
  const ip = address.trim().split("/")[0];
  const isV6 = network.includes(":");
  if (isV6 !== ip.includes(":")) return undefined;
  const bits = isV6 ? 128 : 32;
  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return undefined;
  const parse = isV6 ? parseIpv6 : parseIpv4;
  const ipValue = parse(ip);
  const networkValue = parse(network);
  if (ipValue === undefined || networkValue === undefined) return undefined;
  const shift = BigInt(bits - prefix);
  return ipValue >> shift === networkValue >> shift;
}
