// A pretend containerlab for the harness: what is "running", what apply would
// change, and the containers a host would report. No containers are involved.
import YAML from "yaml";

import { parseApplyPlan, type ApplyPlan } from "../../src/host/applyPlan";
import type { HostRuntimeContainer, HostRuntimeInterface } from "../../src/host/contracts";

type LinkApplyMode = "live" | "restart" | "recreate";

interface DesiredNode {
  kind: string;
  image: string;
  /** How containerlab applies a link change to the node. */
  linkApplyMode: LinkApplyMode;
  /** The node's own settings, compared to spot config drift. */
  config: Record<string, unknown>;
}

export interface DesiredLab {
  labName: string;
  nodes: Map<string, DesiredNode>;
  /** Links as sorted `node:iface -- node:iface`, like containerlab prints them. */
  links: string[];
}

export interface FakeLab extends DesiredLab {
  stoppedNodes: Set<string>;
}

/**
 * Kinds that declare how they take link changes (each containerlab node's LinkApplyMode).
 * Every other kind is recreated.
 */
const KIND_LINK_APPLY_MODES: Partial<Record<string, LinkApplyMode>> = {
  linux: "live",
  nokia_srlinux: "live",
  nokia_sros: "live",
  tailscale: "live",
  arista_ceos: "restart"
};

function isLinkApplyMode(value: unknown): value is LinkApplyMode {
  return value === "live" || value === "restart" || value === "recreate";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function endpointName(endpoint: unknown): string | undefined {
  if (typeof endpoint === "string") return endpoint.includes(":") ? endpoint : undefined;
  const record = asRecord(endpoint);
  const node = asString(record.node);
  const iface = asString(record.interface);
  return node && iface ? `${node}:${iface}` : undefined;
}

function readLinks(rawLinks: unknown, nodes: Map<string, DesiredNode>): string[] {
  if (!Array.isArray(rawLinks)) return [];
  const links: string[] = [];
  for (const rawLink of rawLinks) {
    const endpoints = asRecord(rawLink).endpoints;
    if (!Array.isArray(endpoints)) continue;
    const names = endpoints
      .map(endpointName)
      .filter((name): name is string => name !== undefined && nodes.has(name.split(":")[0] ?? ""))
      .sort();
    if (names.length > 0) links.push(names.join(" -- "));
  }
  return links;
}

export function readTopology(yaml: string): DesiredLab {
  const doc = asRecord(YAML.parse(yaml));
  const topology = asRecord(doc.topology);
  const defaults = asRecord(topology.defaults);
  const kinds = asRecord(topology.kinds);
  const nodes = new Map<string, DesiredNode>();
  for (const [name, rawNode] of Object.entries(asRecord(topology.nodes))) {
    const config = asRecord(rawNode);
    const kind = asString(config.kind) || asString(defaults.kind) || "linux";
    const kindConfig = asRecord(kinds[kind]);
    const image = asString(config.image) || asString(kindConfig.image) || asString(defaults.image);
    // A link-apply-mode in the topology overrides the kind's own declaration.
    const override = [config, kindConfig, defaults]
      .map((level) => level["link-apply-mode"])
      .find(isLinkApplyMode);
    const linkApplyMode = override ?? KIND_LINK_APPLY_MODES[kind] ?? "recreate";
    nodes.set(name, { kind, image, linkApplyMode, config });
  }
  return { labName: asString(doc.name) || "lab", nodes, links: readLinks(topology.links, nodes) };
}

function driftedKeys(running: DesiredNode, desired: DesiredNode): string[] {
  const keys = new Set([...Object.keys(running.config), ...Object.keys(desired.config)]);
  return [...keys]
    .filter((key) => JSON.stringify(running.config[key]) !== JSON.stringify(desired.config[key]))
    .sort();
}

function linkNodes(link: string): string[] {
  return link.split(" -- ").map((endpoint) => endpoint.split(":")[0] ?? "");
}

/** What `containerlab apply --dry-run` would report for this running lab. */
export function planFakeApply(running: FakeLab | undefined, desired: DesiredLab): ApplyPlan {
  if (!running) {
    return parseApplyPlan({ deployedLab: true, labName: desired.labName }) as ApplyPlan;
  }
  const addedNodes = [...desired.nodes.keys()].filter((name) => !running.nodes.has(name));
  const deletedNodes = [...running.nodes.keys()].filter((name) => !desired.nodes.has(name));
  const reasons: Record<string, string> = {};
  const recreatedNodes: string[] = [];
  for (const [name, node] of desired.nodes) {
    const current = running.nodes.get(name);
    const drift = current ? driftedKeys(current, node) : [];
    if (drift.length > 0) {
      recreatedNodes.push(name);
      reasons[name] = `config drift: ${drift.join(", ")}`;
    }
  }
  const replaced = new Set([...addedNodes, ...deletedNodes, ...recreatedNodes]);

  const addedLinks = desired.links.filter((link) => !running.links.includes(link));
  const deletedEndpoints = running.links
    .filter((link) => !desired.links.includes(link))
    .flatMap((link) => link.split(" -- "))
    .filter((endpoint) => !replaced.has(endpoint.split(":")[0] ?? ""));

  // Nodes whose links change are left alone, restarted or recreated, as their
  // link apply mode says; added links are looked at before removed ones.
  const restartedNodes: string[] = [];
  const linkChanges: Array<[string, string]> = [
    ...addedLinks.flatMap(linkNodes).map((name): [string, string] => [name, "added link"]),
    ...deletedEndpoints.map((endpoint): [string, string] => [
      endpoint.split(":")[0] ?? "",
      "deleted endpoint"
    ])
  ];
  for (const [name, change] of linkChanges) {
    if (replaced.has(name) || restartedNodes.includes(name)) continue;
    const mode = desired.nodes.get(name)?.linkApplyMode ?? "live";
    if (mode === "live") continue;
    reasons[name] = change;
    if (mode === "restart") {
      restartedNodes.push(name);
    } else {
      recreatedNodes.push(name);
      replaced.add(name);
    }
  }

  const startedNodes = [...running.stoppedNodes].filter(
    (name) => desired.nodes.has(name) && !replaced.has(name)
  );

  return parseApplyPlan({
    deployedLab: false,
    labName: desired.labName,
    addedNodes,
    deletedNodes,
    recreatedNodes,
    startedNodes,
    restartedNodes,
    addedLinks,
    deletedEndpoints: [...new Set(deletedEndpoints)],
    nodeChangeReasons: reasons
  }) as ApplyPlan;
}

/** The lab after deploying `desired`, or only the nodes in `nodeFilter`. */
export function deployFakeLab(desired: DesiredLab, nodeFilter?: string[]): FakeLab {
  if (!nodeFilter || nodeFilter.length === 0) {
    return { ...desired, nodes: new Map(desired.nodes), stoppedNodes: new Set() };
  }
  const keep = new Set(nodeFilter);
  const nodes = new Map([...desired.nodes].filter(([name]) => keep.has(name)));
  // containerlab skips links to nodes outside the filter.
  const links = desired.links.filter((link) => linkNodes(link).every((name) => keep.has(name)));
  return { labName: desired.labName, nodes, links, stoppedNodes: new Set() };
}

/** The lab after destroying `nodeFilter`; undefined once nothing is left. */
export function destroyFakeNodes(lab: FakeLab, nodeFilter?: string[]): FakeLab | undefined {
  if (!nodeFilter || nodeFilter.length === 0) return undefined;
  const gone = new Set(nodeFilter);
  const nodes = new Map([...lab.nodes].filter(([name]) => !gone.has(name)));
  if (nodes.size === 0) return undefined;
  return {
    ...lab,
    nodes,
    links: lab.links.filter((link) => linkNodes(link).every((name) => !gone.has(name))),
    stoppedNodes: new Set([...lab.stoppedNodes].filter((name) => !gone.has(name)))
  };
}

function fakeMac(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const bytes = [0xaa, 0xc1, (hash >>> 24) & 0xff, (hash >>> 16) & 0xff, (hash >>> 8) & 0xff, hash & 0xff];
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(":");
}

function fakeInterface(container: string, name: string, up: boolean): HostRuntimeInterface {
  return {
    name,
    alias: "",
    mac: fakeMac(`${container}/${name}`),
    mtu: name === "eth0" ? 1500 : 9500,
    state: up ? "up" : "down",
    type: "veth"
  };
}

export function fakeContainerName(lab: FakeLab, nodeName: string): string {
  return `clab-${lab.labName}-${nodeName}`;
}

/** The containers a host would report for the lab. */
export function fakeRuntimeContainers(lab: FakeLab): HostRuntimeContainer[] {
  return [...lab.nodes].map(([nodeName, node], index) => {
    const name = fakeContainerName(lab, nodeName);
    const running = !lab.stoppedNodes.has(nodeName);
    const ifaces = lab.links
      .flatMap((link) => link.split(" -- "))
      .filter((endpoint) => endpoint.startsWith(`${nodeName}:`))
      .map((endpoint) => endpoint.slice(nodeName.length + 1));
    return {
      name,
      nodeName,
      labName: lab.labName,
      state: running ? "running" : "exited",
      kind: node.kind,
      image: node.image,
      ipv4Address: running ? `172.20.20.${index + 2}/24` : "",
      ipv6Address: running ? `3fff:172:20:20::${index + 2}/64` : "",
      interfaces: ["eth0", ...ifaces].map((iface) => fakeInterface(name, iface, running))
    };
  });
}

/** The node a host action names, by container or node name. */
export function resolveFakeNode(lab: FakeLab, name: string): string | undefined {
  if (lab.nodes.has(name)) return name;
  const prefix = `clab-${lab.labName}-`;
  const nodeName = name.startsWith(prefix) ? name.slice(prefix.length) : "";
  return lab.nodes.has(nodeName) ? nodeName : undefined;
}
