// A pretend containerlab for the harness: what is "running", what apply would
// change, and the containers a host would report. No containers are involved.
import YAML from "yaml";

import {
  findWaitForCycle,
  listWaitForDependencies,
  parseNodeStages,
  resolveEffectiveStages,
  type InheritedStages,
  type WaitForDependency
} from "../../src/core/utilities/nodeStages";
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
  /** wait-for entries from defaults, kind, group and the node, merged like containerlab. */
  waitFor: WaitForDependency[];
  /** A healthcheck at any level: the node reports `health: starting` for a while once started. */
  healthcheck: boolean;
}

export interface DesiredLab {
  labName: string;
  nodes: Map<string, DesiredNode>;
  /** Links as sorted `node:iface -- node:iface`, like containerlab prints them. */
  links: string[];
}

/** State and status a spec forces on a node, until the next lifecycle command. */
export interface FakeNodeRuntime {
  state?: string;
  status?: string;
}

export interface FakeLab extends DesiredLab {
  stoppedNodes: Set<string>;
  /** Running nodes whose healthcheck has not passed yet. */
  startingNodes: Set<string>;
  runtimeOverrides: Map<string, FakeNodeRuntime>;
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

function readWaitFor(
  name: string,
  levels: Array<[string, Record<string, unknown>]>,
  config: Record<string, unknown>
): WaitForDependency[] {
  const inherited: InheritedStages[] = [];
  for (const [level, section] of levels) {
    const stages = parseNodeStages(section.stages);
    if (stages) inherited.push({ level, stages });
  }
  return listWaitForDependencies(
    name,
    resolveEffectiveStages(parseNodeStages(config.stages), inherited)
  );
}

export function readTopology(yaml: string): DesiredLab {
  const doc = asRecord(YAML.parse(yaml));
  const topology = asRecord(doc.topology);
  const defaults = asRecord(topology.defaults);
  const kinds = asRecord(topology.kinds);
  const groups = asRecord(topology.groups);
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
    const groupConfig = asRecord(groups[asString(config.group)]);
    const waitFor = readWaitFor(
      name,
      [
        ["defaults", defaults],
        ["kind", kindConfig],
        ["group", groupConfig]
      ],
      config
    );
    const healthcheck = [config, groupConfig, kindConfig, defaults].some(
      (level) => level.healthcheck !== undefined
    );
    nodes.set(name, { kind, image, linkApplyMode, config, waitFor, healthcheck });
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

/** One step of a deploy: nodes created together once everything they wait for is up. */
export interface DeployWave {
  nodes: string[];
  /** The wait-for entries these nodes had to honour. */
  waitedFor: WaitForDependency[];
}

/**
 * Order a deploy by wait-for, a simpler take on containerlab's scheduler: a
 * node starts once every node it waits for is fully up, whatever the stages.
 * Dependencies on nodes outside the deploy are ignored. Returns an error for a
 * loop, which containerlab refuses too.
 */
export function planFakeDeployWaves(
  desired: DesiredLab,
  nodeFilter?: string[]
): { waves: DeployWave[] } | { error: string } {
  const selected = new Set(
    nodeFilter && nodeFilter.length > 0
      ? [...desired.nodes.keys()].filter((name) => nodeFilter.includes(name))
      : desired.nodes.keys()
  );
  const dependencies = [...selected].flatMap((name) =>
    (desired.nodes.get(name)?.waitFor ?? []).filter((dep) => selected.has(dep.dependsOn))
  );
  const cycle = findWaitForCycle(dependencies);
  if (cycle) return { error: `cyclic dependencies found! ${cycle.join(" -> ")}` };

  const waves: DeployWave[] = [];
  const done = new Set<string>();
  while (done.size < selected.size) {
    const ready = [...selected].filter(
      (name) =>
        !done.has(name) &&
        dependencies.every((dep) => dep.node !== name || done.has(dep.dependsOn))
    );
    waves.push({
      nodes: ready,
      waitedFor: dependencies.filter((dep) => ready.includes(dep.node))
    });
    for (const name of ready) done.add(name);
  }
  return { waves };
}

/** Nodes among `names` that define a healthcheck. */
export function healthcheckedNodes(lab: DesiredLab, names: Iterable<string>): Set<string> {
  return new Set([...names].filter((name) => lab.nodes.get(name)?.healthcheck === true));
}

/** The lab after deploying `desired`, or only the nodes in `nodeFilter`, healthchecks starting. */
export function deployFakeLab(desired: DesiredLab, nodeFilter?: string[]): FakeLab {
  if (!nodeFilter || nodeFilter.length === 0) {
    return {
      ...desired,
      nodes: new Map(desired.nodes),
      stoppedNodes: new Set(),
      startingNodes: healthcheckedNodes(desired, desired.nodes.keys()),
      runtimeOverrides: new Map()
    };
  }
  const keep = new Set(nodeFilter);
  const nodes = new Map([...desired.nodes].filter(([name]) => keep.has(name)));
  // containerlab skips links to nodes outside the filter.
  const links = desired.links.filter((link) => linkNodes(link).every((name) => keep.has(name)));
  return {
    labName: desired.labName,
    nodes,
    links,
    stoppedNodes: new Set(),
    startingNodes: healthcheckedNodes(desired, keep),
    runtimeOverrides: new Map()
  };
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
    stoppedNodes: new Set([...lab.stoppedNodes].filter((name) => !gone.has(name))),
    startingNodes: new Set([...lab.startingNodes].filter((name) => !gone.has(name)))
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

/** Docker's status line for a fake container, health included. */
function fakeStatus(lab: FakeLab, nodeName: string, running: boolean): string {
  if (!running) return "Exited (0) 5 seconds ago";
  if (lab.startingNodes.has(nodeName)) return "Up 3 seconds (health: starting)";
  return lab.nodes.get(nodeName)?.healthcheck === true ? "Up 2 minutes (healthy)" : "Up 2 minutes";
}

/** The containers a host would report for the lab. */
export function fakeRuntimeContainers(lab: FakeLab): HostRuntimeContainer[] {
  return [...lab.nodes].map(([nodeName, node], index) => {
    const name = fakeContainerName(lab, nodeName);
    const override = lab.runtimeOverrides.get(nodeName);
    const state = override?.state ?? (lab.stoppedNodes.has(nodeName) ? "exited" : "running");
    const running = state === "running";
    const ifaces = lab.links
      .flatMap((link) => link.split(" -- "))
      .filter((endpoint) => endpoint.startsWith(`${nodeName}:`))
      .map((endpoint) => endpoint.slice(nodeName.length + 1));
    return {
      name,
      nodeName,
      labName: lab.labName,
      state,
      status: override?.status ?? fakeStatus(lab, nodeName, running),
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
