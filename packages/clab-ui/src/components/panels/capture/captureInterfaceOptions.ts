/**
 * Builds the interface list offered by the capture dialog for one node:
 * its live container interfaces merged with the links drawn on the canvas.
 */
import type { Edge, Node } from "@xyflow/react";

import { getString, isRecord } from "../../../core/utilities/typeHelpers";
import {
  compareInterfaceNames,
  isHostNetnsInterfaceName,
  nodeNamespaceInterfaceName,
  readRuntimeInterfaces,
  toRuntimeCaptureInterfaces
} from "../../../core/utilities/runtimeInterfaces";
import { mapSrosInterfaceName } from "../../../core/parsing/DistributedSrosMapper";

export type CaptureInterfaceState = "up" | "down" | "unknown";

interface CaptureInterfacePeer {
  node: string;
  endpoint?: string;
}

export interface CaptureInterfaceOption {
  /** Interface name passed to the capture host. */
  name: string;
  /** Topology or vendor name, e.g. 1/1/c1/1 or ethernet-1/1, when known. */
  alias?: string;
  /** Name shown to the user. */
  label: string;
  /** Secondary name shown next to the label, if any. */
  detail?: string;
  /** Node shown before the label when options span nodes, e.g. the ends of a link. */
  nodeLabel?: string;
  /** The name is valid inside the node's network namespace. */
  nodeNamespace: boolean;
  /** Host-side end of a link (clab-s-*), captured in the host network namespace. */
  hostNetns: boolean;
  state: CaptureInterfaceState;
  /** Container that owns the interface; distributed nodes span several. */
  containerName: string;
  peer?: CaptureInterfacePeer;
  isManagement: boolean;
}

export interface CaptureNodeTarget {
  nodeId: string;
  label: string;
  containerName: string;
  options: CaptureInterfaceOption[];
}

/** One capture session: interfaces of one container in one network namespace. */
export interface CaptureRequestGroup {
  containerName: string;
  interfaceNames: string[];
  /** The names are ports inside the node: capture them there. */
  nodeNamespace: boolean;
}

export interface CaptureGroupingOptions {
  /** One capture per interface instead of one per network namespace. */
  separate?: boolean;
}

interface RuntimeInterfaceInput {
  name: string;
  alias?: string;
  label?: string;
  state: string;
}

const MANAGEMENT_INTERFACE_NAMES = new Set(["eth0", "mgmt0"]);

function nonEmpty(value: unknown): string | undefined {
  const text = getString(value)?.trim();
  return text !== undefined && text.length > 0 ? text : undefined;
}

function toState(value: unknown): CaptureInterfaceState {
  const state = nonEmpty(value)?.toLowerCase();
  if (state === "up") return "up";
  if (state === "down" || state === "lowerlayerdown") return "down";
  return "unknown";
}

function nodeLabel(node: Node | undefined, fallback: string): string {
  const data = isRecord(node?.data) ? node.data : {};
  return nonEmpty(data.label) ?? nonEmpty(data.name) ?? fallback;
}

function nodeField(node: Node, key: string): string | undefined {
  const data = isRecord(node.data) ? node.data : {};
  const extraData = isRecord(data.extraData) ? data.extraData : {};
  return nonEmpty(data[key]) ?? nonEmpty(extraData[key]);
}

interface LinkedEndpoint {
  endpoint: string;
  containerName?: string;
  state: CaptureInterfaceState;
  peer: CaptureInterfacePeer;
}

function linkedEndpoints(nodeId: string, nodes: Node[], edges: Edge[]): LinkedEndpoint[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const endpoints: LinkedEndpoint[] = [];

  for (const edge of edges) {
    const data = isRecord(edge.data) ? edge.data : {};
    const extraData = isRecord(data.extraData) ? data.extraData : {};
    const sides = [
      { self: edge.source, other: edge.target, own: "source", far: "target" },
      { self: edge.target, other: edge.source, own: "target", far: "source" }
    ] as const;

    for (const side of sides) {
      if (side.self !== nodeId) continue;
      const endpoint = nonEmpty(data[`${side.own}Endpoint`]);
      if (endpoint === undefined) continue;
      const capitalized = side.own === "source" ? "Source" : "Target";
      endpoints.push({
        endpoint,
        containerName: nonEmpty(extraData[`clab${capitalized}LongName`]),
        state: toState(extraData[`clab${capitalized}InterfaceState`]),
        peer: {
          node: nodeLabel(nodesById.get(side.other), side.other),
          endpoint: nonEmpty(data[`${side.far}Endpoint`])
        }
      });
    }
  }

  return endpoints;
}

function compareOptions(left: CaptureInterfaceOption, right: CaptureInterfaceOption): number {
  if (left.isManagement !== right.isManagement) return left.isManagement ? -1 : 1;
  return compareInterfaceNames(left.label, right.label);
}

/**
 * A live interface as a capture option. Link ports reported by their host-side
 * end (clab-s-*) are captured under their name inside the node when the kind's
 * naming is known, so they share one stream with the node's other interfaces.
 * The label is the name the user knows: the topology name for link ports.
 */
/** Label and secondary name: a stitched link shows its topology name, then its name inside the node. */
function displayNames(
  iface: { name: string; alias?: string },
  nodeName: string | undefined
): Pick<CaptureInterfaceOption, "label" | "detail"> {
  if (!isHostNetnsInterfaceName(iface.name) || iface.alias === undefined) {
    return { label: iface.name, ...(iface.alias !== undefined ? { detail: iface.alias } : {}) };
  }
  const label = iface.alias;
  return nodeName !== undefined && nodeName !== label ? { label, detail: nodeName } : { label };
}

function toRuntimeOption(
  containerName: string,
  kind: string | undefined,
  iface: { name: string; alias?: string; state: string }
): CaptureInterfaceOption {
  const nodeName = nodeNamespaceInterfaceName(kind, iface);
  return {
    name: nodeName ?? iface.name,
    ...(iface.alias !== undefined ? { alias: iface.alias } : {}),
    ...displayNames(iface, nodeName),
    nodeNamespace: nodeName !== undefined,
    hostNetns: nodeName === undefined && isHostNetnsInterfaceName(iface.name),
    state: toState(iface.state),
    containerName,
    isManagement: MANAGEMENT_INTERFACE_NAMES.has(iface.name)
  };
}

/** Topology endpoint names that may refer to a live interface, e.g. SR OS 1/1/c1/1 and e1-1-c1-1. */
function endpointCandidates(endpoint: string): string[] {
  const mapped = mapSrosInterfaceName(endpoint);
  return mapped !== undefined && mapped !== endpoint ? [endpoint, mapped] : [endpoint];
}

function toLinkedOption(
  linked: LinkedEndpoint,
  existing: CaptureInterfaceOption | undefined,
  fallbackContainerName: string
): CaptureInterfaceOption {
  if (existing !== undefined) {
    return {
      ...existing,
      state: existing.state !== "unknown" ? existing.state : linked.state,
      containerName: linked.containerName ?? existing.containerName,
      peer: linked.peer,
      isManagement: false
    };
  }
  // Not listed by the runtime yet: the host resolves the topology name.
  return {
    name: linked.endpoint,
    label: linked.endpoint,
    nodeNamespace: false,
    hostNetns: false,
    state: linked.state,
    containerName: linked.containerName ?? fallbackContainerName,
    peer: linked.peer,
    isManagement: false
  };
}

/**
 * Every interface a node can capture on. Live interfaces come first-class;
 * linked endpoints the runtime does not list (e.g. before the first refresh)
 * still appear, under their topology name.
 */
export function buildCaptureNodeTarget(
  nodeId: string,
  nodes: Node[],
  edges: Edge[]
): CaptureNodeTarget | undefined {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (node?.type !== "topology-node") return undefined;

  const containerName = nodeField(node, "longname") ?? node.id;
  const data = isRecord(node.data) ? node.data : {};
  const runtimeOptions = buildRuntimeCaptureOptions(
    containerName,
    readRuntimeInterfaces(data.extraData) ?? [],
    nodeField(node, "kind")
  );
  const options = new Map(runtimeOptions.map((option) => [option.name, option]));

  for (const linked of linkedEndpoints(nodeId, nodes, edges)) {
    // Topology endpoints may use the vendor alias of the live interface.
    const candidates = endpointCandidates(linked.endpoint);
    const existing = runtimeOptions.find(
      (option) =>
        candidates.includes(option.name) ||
        (option.alias !== undefined && candidates.includes(option.alias))
    );
    const option = toLinkedOption(linked, existing, containerName);
    options.set(option.name, option);
  }

  return {
    nodeId,
    label: nodeLabel(node, nodeId),
    containerName,
    options: [...options.values()].sort(compareOptions)
  };
}

/** Options for a container known only from runtime data, without canvas links. */
export function buildRuntimeCaptureOptions(
  containerName: string,
  interfaces: readonly RuntimeInterfaceInput[],
  kind?: string
): CaptureInterfaceOption[] {
  return toRuntimeCaptureInterfaces(interfaces, kind)
    .map((iface) => toRuntimeOption(containerName, kind, iface))
    .sort(compareOptions);
}

function namespaceKey(option: CaptureInterfaceOption): string {
  if (option.hostNetns) return "host";
  return option.nodeNamespace ? "node" : "resolve";
}

/**
 * Split a selection into capture sessions, in list order. By default one per
 * container and network namespace: Edgeshark streams one namespace at a time,
 * so a host-side link end cannot join the node's own interfaces. With
 * `separate`, every interface gets its own session.
 */
export function groupCaptureSelection(
  options: readonly CaptureInterfaceOption[],
  selected: ReadonlySet<string>,
  grouping: CaptureGroupingOptions = {}
): CaptureRequestGroup[] {
  const groups = new Map<string, CaptureRequestGroup>();
  for (const option of options) {
    if (!selected.has(option.name)) continue;
    const key = grouping.separate === true
      ? `${option.containerName}\u0000${option.name}`
      : `${option.containerName}\u0000${namespaceKey(option)}`;
    const group = groups.get(key) ?? {
      containerName: option.containerName,
      interfaceNames: [],
      nodeNamespace: option.nodeNamespace
    };
    group.interfaceNames.push(option.name);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Case-insensitive match on the name, vendor alias and link peer. */
export function matchesCaptureFilter(option: CaptureInterfaceOption, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (needle.length === 0) return true;
  return [
    option.label,
    option.detail,
    option.name,
    option.alias,
    option.peer?.node,
    option.peer?.endpoint
  ].some((value) => value !== undefined && value.toLowerCase().includes(needle));
}
