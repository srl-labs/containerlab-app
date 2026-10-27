// `containerlab generate` in the browser, for hosts without containerlab such
// as the browser sandbox. It writes the same topology the CLI prints.

import { stringify } from "yaml";

import type { ClosTopologyRequest } from "./closGenerator";

const DEFAULT_KIND = "nokia_srlinux";
const ETH = "eth%d";
const GE = "ge-0/0/%d";
const SROS = "1/1/%d";

/**
 * Interface names per kind, from the kinds' generate attributes in
 * containerlab. Kinds missing here cannot be generated. nokia_srsim's format
 * in containerlab has three numbers but gets one; it uses card 1, MDA 1 here.
 */
const INTERFACE_FORMATS: Record<string, string> = {
  srl: "e1-%d",
  nokia_srlinux: "e1-%d",
  nokia_sros: SROS,
  "vr-sros": SROS,
  "vr-nokia_sros": SROS,
  nokia_srsim: SROS,
  cisco_xrv9k: "Gi0/0/0/%d",
  "vr-xrv9k": "Gi0/0/0/%d",
  "vr-cisco_xrv9k": "Gi0/0/0/%d",
  cisco_xrd_vrouter: "Te0/0/0/%d",
  arista_veos: "Et1/%d",
  "vr-veos": "Et1/%d",
  "vr-arista_veos": "Et1/%d",
  juniper_vjunosevolved: "et-0/0/%d",
  juniper_vjunosrouter: "et-0/0/%d",
  juniper_vjunosswitch: "et-0/0/%d",
  juniper_vqfx: GE,
  "vr-vqfx": GE,
  "vr-juniper_vqfx": GE,
  juniper_vmx: GE,
  "vr-vmx": GE,
  "vr-juniper_vmx": GE,
  juniper_vsrx: GE,
  "vr-vsrx": GE,
  "vr-juniper_vsrx": GE,
  nvidia_cumulusvx: "swp%d",
  ...Object.fromEntries(
    [
      "6wind_vsr",
      "arista_ceos",
      "bridge",
      "ceos",
      "ciena_saos",
      "cisco_c8000v",
      "cisco_cat9kv",
      "cisco_ftdv",
      "cisco_iol",
      "cisco_sdwan",
      "cisco_xrd",
      "crpd",
      "dell_sonic",
      "fdio_vpp",
      "fortinet_fortigate",
      "fortinet_fortiproxy",
      "freebsd",
      "frr",
      "frrouting",
      "generic_vm",
      "huawei_vrp",
      "juniper_crpd",
      "juniper_csrx",
      "linux",
      "openbsd",
      "openwrt",
      "plvision_sonic",
      "rare",
      "sonic-vm",
      "sonic-vs",
      "spirent_stc",
      "veesix_osvbng",
      "vr-ciena_saos",
      "vyosnetworks_vyos",
      "xrd"
    ].map((kind) => [kind, ETH])
  )
};

function interfaceName(kind: string, index: number): string {
  return (Object.hasOwn(INTERFACE_FORMATS, kind) ? INTERFACE_FORMATS[kind] : ETH).replace("%d", String(index));
}

/** The trimmed text, or undefined when it is empty. */
function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

interface Tier {
  count: number;
  kind: string;
  type?: string;
}

type ClosRequest = ClosTopologyRequest & { defaultKind?: string };

function validTiers(request: ClosRequest): Tier[] {
  if (!/^[A-Za-z0-9_-]+$/.test(request.name)) {
    throw new Error("Invalid characters in lab name.");
  }
  if (request.tiers.length === 0 || request.tiers.some((tier) => !Number.isInteger(tier.count) || tier.count < 1)) {
    throw new Error("Every tier needs at least one node.");
  }
  const defaultKind = text(request.defaultKind) ?? DEFAULT_KIND;
  const tiers = request.tiers.map((tier) => ({
    count: tier.count,
    kind: text(tier.kind) ?? defaultKind,
    type: text(tier.type)
  }));
  const unsupported = tiers.find((tier) => !Object.hasOwn(INTERFACE_FORMATS, tier.kind));
  if (unsupported) {
    throw new Error(`Kind '${unsupported.kind}' cannot be generated.`);
  }
  return tiers;
}

function tierNodes(tiers: Tier[], nodeName: (tier: number, index: number) => string, groupPrefix: string) {
  const nodes: Record<string, { kind: string; group: string; type?: string }> = {};
  tiers.forEach((tier, tierIndex) => {
    for (let index = 0; index < tier.count; index += 1) {
      nodes[nodeName(tierIndex, index)] = {
        kind: tier.kind,
        group: `${groupPrefix}-${tierIndex + 1}`,
        ...(tier.type !== undefined ? { type: tier.type } : {})
      };
    }
  });
  return nodes;
}

function tierLinks(tiers: Tier[], nodeName: (tier: number, index: number) => string) {
  const links: Array<{ endpoints: [string, string] }> = [];
  for (let tierIndex = 0; tierIndex + 1 < tiers.length; tierIndex += 1) {
    const lower = tiers[tierIndex];
    const upper = tiers[tierIndex + 1];
    // Uplinks follow the links to the tier below.
    const offset = tierIndex > 0 ? tiers[tierIndex - 1].count : 0;
    for (let j = 0; j < lower.count; j += 1) {
      for (let k = 0; k < upper.count; k += 1) {
        links.push({
          endpoints: [
            `${nodeName(tierIndex, j)}:${interfaceName(lower.kind, k + 1 + offset)}`,
            `${nodeName(tierIndex + 1, k)}:${interfaceName(upper.kind, j + 1)}`
          ]
        });
      }
    }
  }
  return links;
}

/** Image and license per kind, sorted as containerlab writes them. */
function kindDefaults(request: ClosRequest) {
  const licenses = request.licenses ?? {};
  const kinds: Record<string, { image?: string; license?: string }> = {};
  for (const kind of [...new Set([...Object.keys(request.images), ...Object.keys(licenses)])].sort()) {
    const image = text(request.images[kind]);
    const license = text(licenses[kind]);
    if (image === undefined && license === undefined) continue;
    kinds[kind] = { ...(image !== undefined ? { image } : {}), ...(license !== undefined ? { license } : {}) };
  }
  return kinds;
}

function managementNetwork(request: ClosRequest) {
  const entries: Array<[string, string | undefined]> = [
    ["network", text(request.managementNetwork)],
    ["ipv4-subnet", text(request.ipv4Subnet)],
    ["ipv6-subnet", text(request.ipv6Subnet)]
  ];
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
}

/** The topology YAML of a Clos request: every node links to every node of the next tier. */
export function generateClosTopologyYaml(request: ClosRequest): string {
  const tiers = validTiers(request);
  const nodePrefix = text(request.nodePrefix) ?? "node";
  const nodeName = (tier: number, index: number) => `${nodePrefix}${tier + 1}-${index + 1}`;
  const links = tierLinks(tiers, nodeName);
  const kinds = kindDefaults(request);
  const mgmt = managementNetwork(request);
  return stringify({
    name: request.name,
    ...(Object.keys(mgmt).length > 0 ? { mgmt } : {}),
    topology: {
      ...(Object.keys(kinds).length > 0 ? { kinds } : {}),
      nodes: tierNodes(tiers, nodeName, text(request.groupPrefix) ?? "tier"),
      ...(links.length > 0 ? { links } : {})
    }
  });
}
