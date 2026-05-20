import type { TopologyRef } from "@srl-labs/clab-ui/session";

import type { EndpointConfig } from "./stores/endpointStore";
import type { ContainerState, InterfaceState, LabState } from "./stores/labStore";

export const TREE_ITEM_NONE = 0;
export const TREE_ITEM_COLLAPSED = 1;
const ENDPOINT_TOPOLOGY_ID_SEPARATOR = "::";

export type DeploymentState = "deployed" | "undeployed" | "unknown";
export type LifecycleCommandType = "deploy" | "destroy" | "redeploy" | "start" | "stop" | "restart";
export type LifecycleCommandStream = "stdout" | "stderr";
export type LifecycleCommandEndpoint = "deploy" | "destroy" | "redeploy" | "start" | "stop" | "restart";
export type TopologySourcePreference = "api-file" | "running-lab-doc";

export interface ExplorerTreeItem {
  id?: string;
  label: string;
  description?: string;
  tooltip?: string;
  contextValue?: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  collapsibleState?: number;
  hasChildren?: boolean;
  state?: string;
  status?: string;
  link?: string;
  labName?: string;
  name?: string;
  containerName?: string;
  cID?: string;
  kind?: string;
  image?: string;
  mac?: string;
  v4Address?: string;
  v6Address?: string;
  endpointId?: string;
  topologyRef?: TopologyRef;
  resourceKind?: "file" | "directory";
  resourcePath?: string;
  children?: ExplorerTreeItem[];
}

export interface TopologyFileEntry {
  endpointId: string;
  filename: string;
  path: string;
  hasAnnotations: boolean;
  labName?: string;
  deploymentState?: string;
  topologyRef: TopologyRef;
}

export interface LoadTopologyTarget {
  canonicalEndpointId: string;
  canonicalTopologyRef: TopologyRef;
  sourcePreference: TopologySourcePreference;
}

export interface ResolveLoadTopologyTargetInput {
  deploymentState?: DeploymentState;
  endpointId: string;
  endpoints: EndpointConfig[];
  files: TopologyFileEntry[];
  labs: Map<string, LabState>;
  topologyRef: TopologyRef;
}

export interface TopologyDocEventMessage {
  type: "topology-doc";
  labName: string;
  path: string;
  documentKind: "yaml" | "annotations";
  action: "create" | "change" | "delete" | "rename";
  revision: string;
}

export class SimpleExplorerProvider {
  constructor(private readonly roots: ExplorerTreeItem[]) {}

  public getChildren(element?: ExplorerTreeItem): ExplorerTreeItem[] {
    if (!element) return this.roots;
    return Array.isArray(element.children) ? element.children : [];
  }
}

export function stripTopologySuffix(name: string): string {
  return name.replace(/\.clab\.(ya?ml)$/i, "");
}

export function safeFilename(pathValue: string): string {
  const segments = pathValue.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : pathValue;
}

export function normalizePathValue(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

export function normalizeLabName(labName: string | undefined): string {
  return (labName ?? "").trim().toLowerCase();
}

export function getLabOwner(lab: LabState | undefined): string {
  if (!lab) {
    return "";
  }
  if (lab.owner.trim().length > 0) {
    return lab.owner.trim();
  }
  return lab.containers.values().next().value?.owner?.trim() ?? "";
}

export function isNonOwnedLabForEndpoint(
  lab: LabState | undefined,
  endpointUsername: string | undefined
): boolean {
  const owner = getLabOwner(lab);
  if (!owner || !endpointUsername) {
    return false;
  }
  return normalizeLabName(owner) !== normalizeLabName(endpointUsername);
}

function hasPathBoundarySuffix(pathValue: string, suffix: string): boolean {
  if (pathValue === suffix) {
    return true;
  }
  if (!pathValue.endsWith(suffix)) {
    return false;
  }

  const boundaryIndex = pathValue.length - suffix.length - 1;
  return boundaryIndex >= 0 && pathValue[boundaryIndex] === "/";
}

export function topologyPathsLikelyMatch(leftPath: string, rightPath: string): boolean {
  const left = normalizePathValue(leftPath).toLowerCase();
  const right = normalizePathValue(rightPath).toLowerCase();
  if (!left || !right) {
    return false;
  }
  return hasPathBoundarySuffix(left, right) || hasPathBoundarySuffix(right, left);
}

export function isAbsolutePath(pathValue: string): boolean {
  const normalized = normalizePathValue(pathValue);
  return normalized.startsWith("/") || normalized.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(normalized);
}

export function topologyEntryLabName(entry: TopologyFileEntry): string {
  if (entry.topologyRef?.labName) {
    return entry.topologyRef.labName;
  }
  if (entry.labName && entry.labName.length > 0) {
    return entry.labName;
  }
  return stripTopologySuffix(entry.filename || safeFilename(entry.path));
}

function isTopologyRefLike(value: unknown): value is TopologyRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TopologyRef).topologyId === "string" &&
    typeof (value as TopologyRef).labName === "string" &&
    typeof (value as TopologyRef).yamlPath === "string"
  );
}

export function extractEndpointIdFromTopologyId(topologyId: string | undefined): string | undefined {
  if (typeof topologyId !== "string" || !topologyId.startsWith("standalone:")) {
    return undefined;
  }
  const raw = topologyId.slice("standalone:".length);
  const separatorIndex = raw.indexOf(ENDPOINT_TOPOLOGY_ID_SEPARATOR);
  if (separatorIndex <= 0) {
    return undefined;
  }
  const endpointId = raw.slice(0, separatorIndex).trim();
  return endpointId.length > 0 ? endpointId : undefined;
}

export function buildEndpointScopedTopologyId(yamlPath: string, endpointId: string): string {
  return `standalone:${endpointId}${ENDPOINT_TOPOLOGY_ID_SEPARATOR}${normalizePathValue(yamlPath)}`;
}

export function normalizeStandaloneTopologyRef(
  topologyRef: TopologyRef,
  endpointId?: string
): TopologyRef {
  const yamlPath = normalizePathValue(topologyRef.yamlPath);
  const labName = topologyRef.labName.trim();
  const source = topologyRef.source === "vscode" ? "vscode" : "standalone";
  const resolvedEndpointId = endpointId ?? extractEndpointIdFromTopologyId(topologyRef.topologyId);
  let topologyId = topologyRef.topologyId;
  if (source === "standalone") {
    topologyId = resolvedEndpointId
      ? buildEndpointScopedTopologyId(yamlPath, resolvedEndpointId)
      : `standalone:${yamlPath}`;
  }

  let annotationsPath = topologyRef.annotationsPath;
  if (annotationsPath) {
    annotationsPath = normalizePathValue(annotationsPath);
  } else if (source === "standalone") {
    annotationsPath = `${yamlPath}.annotations.json`;
  }

  return {
    ...topologyRef,
    topologyId,
    labName,
    yamlPath,
    annotationsPath,
    source
  };
}

export function buildStandaloneTopologyRefFromPath(
  pathValue: string,
  labName?: string,
  endpointId?: string
): TopologyRef {
  const normalizedPath = normalizePathValue(pathValue);
  const resolvedLabName = (labName ?? stripTopologySuffix(safeFilename(normalizedPath))).trim();
  return normalizeStandaloneTopologyRef({
    topologyId: endpointId
      ? buildEndpointScopedTopologyId(normalizedPath, endpointId)
      : `standalone:${normalizedPath}`,
    labName: resolvedLabName,
    yamlPath: normalizedPath,
    annotationsPath: `${normalizedPath}.annotations.json`,
    source: "standalone"
  }, endpointId);
}

export function findTopologyFileEntryByPath(
  files: TopologyFileEntry[],
  pathValue: string
): TopologyFileEntry | undefined {
  const normalized = normalizePathValue(pathValue);
  return files.find((entry) => normalizePathValue(entry.path) === normalized);
}

export function firstArgAsTreeItem(args: unknown[]): ExplorerTreeItem | undefined {
  const first = args[0];
  if (!first || typeof first !== "object") return undefined;
  return first as ExplorerTreeItem;
}

export function firstArgAsTopologyRef(args: unknown[]): TopologyRef | undefined {
  const first = args[0];
  if (isTopologyRefLike(first)) {
    return normalizeStandaloneTopologyRef(first);
  }
  const item = firstArgAsTreeItem(args);
  if (item?.topologyRef) {
    return normalizeStandaloneTopologyRef(item.topologyRef);
  }
  return undefined;
}

type TopologyLookupRef = (
  Pick<TopologyRef, "yamlPath"> &
  Partial<Pick<TopologyRef, "topologyId">> &
  Partial<Pick<TopologyRef, "labName">> &
  { endpointId?: string }
) | undefined;

function labMatchesEndpoint(lab: LabState, endpointId: string | undefined): boolean {
  return !endpointId || lab.endpointId === endpointId;
}

function uniqueLabByName(
  labs: Iterable<LabState>,
  labName: string | undefined,
  endpointId?: string
): LabState | undefined {
  const normalizedLabName = normalizeLabName(labName);
  if (!normalizedLabName) {
    return undefined;
  }
  const matches = [...labs].filter(
    (lab) => labMatchesEndpoint(lab, endpointId) && normalizeLabName(lab.name) === normalizedLabName
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function labMatchesTopologyPath(lab: LabState, normalizedPath: string): boolean {
  if (topologyPathsLikelyMatch(lab.topologyPath, normalizedPath)) {
    return true;
  }
  return [...lab.containers.values()].some((container) =>
    topologyPathsLikelyMatch(container.labPath, normalizedPath)
  );
}

function labsMatchingTopologyPath(
  labs: Map<string, LabState>,
  normalizedPath: string,
  endpointId?: string
): LabState[] {
  return [...labs.values()].filter(
    (lab) => labMatchesEndpoint(lab, endpointId) && labMatchesTopologyPath(lab, normalizedPath)
  );
}

export function findLabStateForTopology(
  topologyRef: TopologyLookupRef,
  labs: Map<string, LabState>
): LabState | undefined {
  const endpointId = topologyRef?.endpointId ?? extractEndpointIdFromTopologyId(topologyRef?.topologyId);
  const normalizedPath = topologyRef?.yamlPath ? normalizePathValue(topologyRef.yamlPath) : "";
  if (!normalizedPath) {
    return uniqueLabByName(labs.values(), topologyRef?.labName, endpointId);
  }

  const byPath = labsMatchingTopologyPath(labs, normalizedPath, endpointId);
  if (byPath.length === 1) {
    return byPath[0];
  }
  if (byPath.length > 1) {
    return uniqueLabByName(byPath, topologyRef?.labName);
  }

  return uniqueLabByName(labs.values(), topologyRef?.labName, endpointId);
}

export function isTopologyRunning(
  topologyRef: (
    Pick<TopologyRef, "yamlPath"> &
    Partial<Pick<TopologyRef, "topologyId">> &
    Partial<Pick<TopologyRef, "labName">> &
    { endpointId?: string }
  ) | undefined,
  labs: Map<string, LabState>
): boolean {
  return findLabStateForTopology(topologyRef, labs) !== undefined;
}

function buildRunningDocLoadTarget(topologyRef: TopologyRef, endpointId: string): LoadTopologyTarget {
  return {
    canonicalTopologyRef: normalizeStandaloneTopologyRef(topologyRef, endpointId),
    canonicalEndpointId: endpointId,
    sourcePreference: "running-lab-doc"
  };
}

function buildApiFileLoadTarget(entry: TopologyFileEntry): LoadTopologyTarget {
  return {
    canonicalTopologyRef: entry.topologyRef,
    canonicalEndpointId: entry.endpointId,
    sourcePreference: "api-file"
  };
}

export function resolveStandaloneLoadTopologyTarget(
  input: ResolveLoadTopologyTargetInput
): LoadTopologyTarget | undefined {
  const { deploymentState, endpointId, endpoints, files, labs, topologyRef } = input;
  const runtimeLab = findLabStateForTopology(
    {
      topologyId: topologyRef.topologyId,
      yamlPath: topologyRef.yamlPath,
      labName: topologyRef.labName,
      endpointId
    },
    labs
  );
  const endpointUsername = endpoints.find((endpoint) => endpoint.id === endpointId)?.username;

  if (runtimeLab && isNonOwnedLabForEndpoint(runtimeLab, endpointUsername)) {
    return buildRunningDocLoadTarget(topologyRef, endpointId);
  }

  const entry = findTopologyFileEntryByPath(files, topologyRef.yamlPath);
  if (entry?.topologyRef) {
    return buildApiFileLoadTarget(entry);
  }

  if (runtimeLab === undefined && deploymentState !== "deployed") {
    return undefined;
  }

  return buildRunningDocLoadTarget(topologyRef, endpointId);
}

function labMetadataEqual(previous: LabState, next: LabState): boolean {
  return (
    previous.endpointId === next.endpointId &&
    previous.owner === next.owner &&
    previous.topologyPath === next.topologyPath &&
    previous.containers.size === next.containers.size
  );
}

function containerMetadataEqual(previous: ContainerState, next: ContainerState): boolean {
  return (
    previous.endpointId === next.endpointId &&
    previous.nodeName === next.nodeName &&
    previous.kind === next.kind &&
    previous.image === next.image &&
    previous.state === next.state &&
    previous.status === next.status &&
    previous.ipv4Address === next.ipv4Address &&
    previous.ipv6Address === next.ipv6Address &&
    previous.labPath === next.labPath &&
    previous.interfaces.size === next.interfaces.size
  );
}

function interfaceStateEqual(previous: InterfaceState, next: InterfaceState): boolean {
  return (
    previous.alias === next.alias &&
    previous.state === next.state &&
    previous.type === next.type &&
    previous.mac === next.mac &&
    previous.mtu === next.mtu &&
    previous.ifIndex === next.ifIndex &&
    previous.netemDelay === next.netemDelay &&
    previous.netemJitter === next.netemJitter &&
    previous.netemLoss === next.netemLoss &&
    previous.netemRate === next.netemRate &&
    previous.netemCorruption === next.netemCorruption
  );
}

function containerInterfacesEqual(previous: ContainerState, next: ContainerState): boolean {
  for (const [ifaceName, previousIface] of previous.interfaces.entries()) {
    const nextIface = next.interfaces.get(ifaceName);
    if (!nextIface || !interfaceStateEqual(previousIface, nextIface)) {
      return false;
    }
  }
  return true;
}

function labContainersEqual(previous: LabState, next: LabState): boolean {
  for (const [containerName, previousContainer] of previous.containers.entries()) {
    const nextContainer = next.containers.get(containerName);
    if (!nextContainer || !containerMetadataEqual(previousContainer, nextContainer)) {
      return false;
    }
    if (!containerInterfacesEqual(previousContainer, nextContainer)) {
      return false;
    }
  }
  return true;
}

export function labsEqualForExplorer(
  previousLabs: Map<string, LabState>,
  nextLabs: Map<string, LabState>
): boolean {
  if (previousLabs.size !== nextLabs.size) {
    return false;
  }

  for (const [labName, previousLab] of previousLabs.entries()) {
    const nextLab = nextLabs.get(labName);
    if (!nextLab) {
      return false;
    }
    if (!labMetadataEqual(previousLab, nextLab)) {
      return false;
    }
    if (!labContainersEqual(previousLab, nextLab)) {
      return false;
    }
  }

  return true;
}
