import type { TopologyRef } from "@srl-labs/clab-ui/session";

import type { LabState } from "./stores/labStore";

export const TREE_ITEM_NONE = 0;
export const TREE_ITEM_COLLAPSED = 1;

export type DeploymentState = "deployed" | "undeployed" | "unknown";
export type LifecycleCommandType = "deploy" | "destroy" | "redeploy";
export type LifecycleCommandStream = "stdout" | "stderr";
export type LifecycleCommandEndpoint = "deploy" | "destroy" | "redeploy";

export interface ExplorerTreeItem {
  id?: string;
  label: string;
  description?: string;
  tooltip?: string;
  contextValue?: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  collapsibleState?: number;
  state?: string;
  status?: string;
  link?: string;
  labName?: string;
  name?: string;
  cID?: string;
  kind?: string;
  image?: string;
  mac?: string;
  v4Address?: string;
  v6Address?: string;
  topologyRef?: TopologyRef;
  children?: ExplorerTreeItem[];
}

export interface TopologyFileEntry {
  filename: string;
  path: string;
  hasAnnotations: boolean;
  labName?: string;
  deploymentState?: string;
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

export function normalizeStandaloneTopologyRef(topologyRef: TopologyRef): TopologyRef {
  const yamlPath = normalizePathValue(topologyRef.yamlPath);
  const labName = topologyRef.labName.trim();
  const source = topologyRef.source === "vscode" ? "vscode" : "standalone";

  return {
    ...topologyRef,
    topologyId: source === "standalone" ? `standalone:${yamlPath}` : topologyRef.topologyId,
    labName,
    yamlPath,
    annotationsPath: topologyRef.annotationsPath
      ? normalizePathValue(topologyRef.annotationsPath)
      : source === "standalone"
        ? `${yamlPath}.annotations.json`
        : topologyRef.annotationsPath,
    source
  };
}

export function buildStandaloneTopologyRefFromPath(
  pathValue: string,
  labName?: string
): TopologyRef {
  const normalizedPath = normalizePathValue(pathValue);
  const resolvedLabName = (labName ?? stripTopologySuffix(safeFilename(normalizedPath))).trim();
  return normalizeStandaloneTopologyRef({
    topologyId: `standalone:${normalizedPath}`,
    labName: resolvedLabName,
    yamlPath: normalizedPath,
    annotationsPath: `${normalizedPath}.annotations.json`,
    source: "standalone"
  });
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

export function findLabStateForTopology(
  topologyRef: Pick<TopologyRef, "yamlPath"> | undefined,
  labs: Map<string, LabState>
): LabState | undefined {
  const normalizedPath = topologyRef?.yamlPath ? normalizePathValue(topologyRef.yamlPath) : "";
  if (!normalizedPath) {
    return undefined;
  }

  for (const lab of labs.values()) {
    if (normalizePathValue(lab.topologyPath) === normalizedPath) {
      return lab;
    }
    for (const container of lab.containers.values()) {
      if (normalizePathValue(container.labPath) === normalizedPath) {
        return lab;
      }
    }
  }

  return undefined;
}

export function isTopologyRunning(
  topologyRef: Pick<TopologyRef, "yamlPath"> | undefined,
  labs: Map<string, LabState>
): boolean {
  return findLabStateForTopology(topologyRef, labs) !== undefined;
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
    if (
      previousLab.owner !== nextLab.owner ||
      previousLab.topologyPath !== nextLab.topologyPath ||
      previousLab.containers.size !== nextLab.containers.size
    ) {
      return false;
    }

    for (const [containerName, previousContainer] of previousLab.containers.entries()) {
      const nextContainer = nextLab.containers.get(containerName);
      if (!nextContainer) {
        return false;
      }
      if (
        previousContainer.nodeName !== nextContainer.nodeName ||
        previousContainer.kind !== nextContainer.kind ||
        previousContainer.image !== nextContainer.image ||
        previousContainer.state !== nextContainer.state ||
        previousContainer.status !== nextContainer.status ||
        previousContainer.ipv4Address !== nextContainer.ipv4Address ||
        previousContainer.ipv6Address !== nextContainer.ipv6Address ||
        previousContainer.labPath !== nextContainer.labPath ||
        previousContainer.interfaces.size !== nextContainer.interfaces.size
      ) {
        return false;
      }

      for (const [ifaceName, previousIface] of previousContainer.interfaces.entries()) {
        const nextIface = nextContainer.interfaces.get(ifaceName);
        if (!nextIface) {
          return false;
        }
        if (
          previousIface.alias !== nextIface.alias ||
          previousIface.state !== nextIface.state ||
          previousIface.type !== nextIface.type ||
          previousIface.mac !== nextIface.mac ||
          previousIface.mtu !== nextIface.mtu ||
          previousIface.ifIndex !== nextIface.ifIndex ||
          previousIface.netemDelay !== nextIface.netemDelay ||
          previousIface.netemJitter !== nextIface.netemJitter ||
          previousIface.netemLoss !== nextIface.netemLoss ||
          previousIface.netemRate !== nextIface.netemRate ||
          previousIface.netemCorruption !== nextIface.netemCorruption
        ) {
          return false;
        }
      }
    }
  }

  return true;
}
