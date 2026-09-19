import { createExplorerController } from "@containerlab/clab-ui/host";
import type {
  ExplorerAction,
  ExplorerIncomingMessage,
  ExplorerSectionId,
  ExplorerSnapshotProviders,
  ExplorerUiState,
} from "@containerlab/clab-ui/explorer";
import type { TopologyRef } from "@containerlab/clab-ui/session";
import {
  fetchEndpointHealthMetrics,
  formatEndpointHealthTooltip,
  type EndpointHealthMetrics,
} from "./endpointHealth";
import {
  listFileExplorerDirectory,
  type FileExplorerEntry,
} from "./runtimeApi";
import type { EndpointConfig } from "./stores/endpointStore";
import type {
  ContainerState,
  InterfaceState,
  LabState,
} from "./stores/labStore";
import type {
  ExplorerTreeItem,
  TopologyFileEntry,
} from "./standaloneHostShared";
import {
  TREE_ITEM_COLLAPSED,
  TREE_ITEM_NONE,
  SimpleExplorerProvider,
  buildStandaloneTopologyRefFromPath,
  getLabOwner,
  isNonOwnedLabForEndpoint,
  isSharedWorkspacePath,
  SHARED_WORKSPACE_DESCRIPTION,
  isTopologyRunning,
  normalizeLabName,
  normalizePathValue,
  safeFilename,
  topologyPathsLikelyMatch,
  topologyEntryLabName,
} from "./standaloneHostShared";
import { isStandaloneFavorite } from "./standaloneFavorites";
import { createExplorerCommandHandler } from "./standaloneExplorerCommands";
import {
  explorerPreferences,
  type StandaloneExplorerBridgeOptions,
} from "./standaloneExplorerActions";

const ENDPOINT_HEALTH_CACHE_TTL_MS = 30_000;
const RUNNING_LABS_SECTION_ID = "runningLabs" satisfies ExplorerSectionId;
const LOCAL_LABS_SECTION_ID = "localLabs" satisfies ExplorerSectionId;
const FILE_EXPLORER_SECTION_ID = "fileExplorer";
const FILE_EXPLORER_STATE_SECTION_IDS = [
  FILE_EXPLORER_SECTION_ID,
  LOCAL_LABS_SECTION_ID,
] as const;
const STANDALONE_HIDDEN_COMMAND_IDS = [
  "containerlab.lab.addToWorkspace",
  "containerlab.lab.openFolderInNewWindow",
  "containerlab.file.refresh",
] as const;
const PAGES_LIFECYCLE_HIDDEN_COMMAND_IDS = [
  "containerlab.lab.deployPopular",
  "containerlab.lab.deploy",
  "containerlab.lab.deploy.specificFile",
  "containerlab.lab.deploy.cleanup",
  "containerlab.lab.apply",
  "containerlab.lab.destroy",
  "containerlab.lab.destroy.cleanup",
  "containerlab.lab.redeploy",
  "containerlab.lab.redeploy.cleanup",
  "containerlab.lab.start",
  "containerlab.lab.stop",
  "containerlab.lab.restart",
  "containerlab.lab.save",
  "containerlab.lab.sshToAllNodes",
  "containerlab.node.save",
  "containerlab.node.start",
  "containerlab.node.stop",
  "containerlab.node.restart",
  "containerlab.node.pause",
  "containerlab.node.unpause",
] as const;
const STANDALONE_TRANSFER_COMMAND_LABELS = new Map<string, string>([
  ["containerlab.file.download", "Download File"],
  ["containerlab.file.upload", "Upload File"],
  ["containerlab.file.downloadArchive", "Download Lab Archive"],
  ["containerlab.lab.downloadArchive", "Download Lab Archive"],
]);
const STANDALONE_COMMAND_LABELS = new Map<string, string>([
  ...STANDALONE_TRANSFER_COMMAND_LABELS,
  ["containerlab.endpoint.add", "Add Endpoint"],
]);
const STANDALONE_TRANSFER_COMMAND_ICONS = new Map<string, string>([
  ["containerlab.file.download", "download"],
  ["containerlab.file.upload", "upload"],
  ["containerlab.file.downloadArchive", "download"],
  ["containerlab.lab.downloadArchive", "download"],
]);
const STANDALONE_COMMAND_ICONS = new Map<string, string>([
  ...STANDALONE_TRANSFER_COMMAND_ICONS,
  ["containerlab.endpoint.add", "add"],
]);
const STANDALONE_TRANSFER_FILE_ACTIONS = [
  {
    commandId: "containerlab.editor.topoViewerEditor",
    contextValues: ["containerlabFileExplorerRoot", "containerlabFileFolder"],
    label: "New Topology File",
  },
  {
    commandId: "containerlab.file.download",
    contextValues: ["containerlabFile", "containerlabFileTopology"],
  },
  {
    commandId: "containerlab.file.upload",
    contextValues: [
      "containerlabFileExplorerRoot",
      "containerlabFileFolder",
      "containerlabFile",
      "containerlabFileTopology",
    ],
  },
  {
    commandId: "containerlab.file.downloadArchive",
    contextValues: ["containerlabFileFolder"],
  },
] as const;
const STANDALONE_TRANSFER_LAB_ACTIONS = [
  { commandId: "containerlab.lab.downloadArchive" },
] as const;
const STANDALONE_EXPLORER_COMMAND_METADATA = {
  contributedFileActions: STANDALONE_TRANSFER_FILE_ACTIONS,
  contributedLabActions: STANDALONE_TRANSFER_LAB_ACTIONS,
  contributedSectionContextActions: {
    [RUNNING_LABS_SECTION_ID]: [{ commandId: "containerlab.endpoint.add" }],
  },
  commandIcons: STANDALONE_COMMAND_ICONS,
  commandLabels: STANDALONE_COMMAND_LABELS,
};

type EndpointHealthCacheEntry =
  | { status: "loading"; fetchedAt: number }
  | { status: "ready"; metrics: EndpointHealthMetrics; fetchedAt: number }
  | { status: "error"; fetchedAt: number };

function topologyRefForRunningLab(
  lab: LabState,
  topologyEntry?: TopologyFileEntry,
): TopologyRef | undefined {
  if (topologyEntry?.topologyRef) {
    return topologyEntry.topologyRef;
  }
  return lab.topologyPath
    ? buildStandaloneTopologyRefFromPath(
        lab.topologyPath,
        lab.name,
        lab.endpointId,
      )
    : undefined;
}

function groupTopologyFilesByEndpoint(
  files: TopologyFileEntry[],
): Map<string, TopologyFileEntry[]> {
  const filesByEndpoint = new Map<string, TopologyFileEntry[]>();
  for (const file of files) {
    const bucket = filesByEndpoint.get(file.endpointId) ?? [];
    bucket.push(file);
    filesByEndpoint.set(file.endpointId, bucket);
  }
  return filesByEndpoint;
}

function buildRunningInterfaceItem(input: {
  container: ContainerState;
  iface: InterfaceState;
  lab: LabState;
  topologyRef?: TopologyRef;
}): ExplorerTreeItem {
  const { container, iface, lab, topologyRef } = input;
  const state = iface.state.toLowerCase();
  const hasAlias = Boolean(iface.alias);
  const label = hasAlias ? iface.alias : iface.name;
  const stateText = state ? state.toUpperCase() : "";
  const description = hasAlias
    ? `${stateText || "UNKNOWN"} (${iface.name})`
    : stateText || iface.type || undefined;

  return {
    id: `running-interface:${lab.endpointId}:${container.name}:${iface.name}`,
    label,
    description,
    tooltip: buildInterfaceTooltip({
      name: iface.name,
      alias: iface.alias,
      state: iface.state,
      type: iface.type,
      mac: iface.mac,
      mtu: iface.mtu,
      rxBps: iface.rxBps,
      txBps: iface.txBps,
    }),
    contextValue: getInterfaceContextValue(state),
    collapsibleState: TREE_ITEM_NONE,
    cID: container.containerId,
    containerName: container.name,
    endpointId: lab.endpointId,
    labName: lab.name,
    mac: iface.mac,
    name: iface.name,
    topologyRef,
    children: [],
  };
}

function buildRunningInterfaceItems(
  lab: LabState,
  container: ContainerState,
  topologyRef?: TopologyRef,
): ExplorerTreeItem[] {
  return [...container.interfaces.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .filter((iface) => {
      const state = iface.state.toLowerCase();
      return iface.name !== "lo" && state !== "unknown";
    })
    .map((iface) =>
      buildRunningInterfaceItem({ container, iface, lab, topologyRef }),
    );
}

function buildRunningContainerItem(
  lab: LabState,
  container: ContainerState,
  topologyRef?: TopologyRef,
): ExplorerTreeItem {
  const interfaces = buildRunningInterfaceItems(lab, container, topologyRef);
  return {
    id: `running-container:${lab.endpointId}:${container.name}`,
    label: container.nodeName || container.name,
    description: container.status || container.state,
    tooltip: buildContainerTooltip({
      name: container.name,
      state: container.state,
      status: container.status,
      kind: container.kind,
      image: container.image,
      id: container.containerId,
      ipv4: container.ipv4Address,
      ipv6: container.ipv6Address,
    }),
    contextValue: "containerlabContainer",
    endpointId: lab.endpointId,
    state: container.state,
    status: container.status,
    labName: lab.name,
    name: container.name,
    cID: container.containerId,
    kind: container.kind,
    image: container.image,
    topologyRef,
    v4Address: container.ipv4Address,
    v6Address: container.ipv6Address,
    collapsibleState:
      interfaces.length > 0 ? TREE_ITEM_COLLAPSED : TREE_ITEM_NONE,
    children: interfaces,
  };
}

function buildRunningShareItems(
  lab: LabState,
  topologyRef: TopologyRef | undefined,
  sshxLink: string,
  gottyLink: string,
): ExplorerTreeItem[] {
  const shareLink = sshxLink || gottyLink;
  if (!shareLink) {
    return [];
  }
  const kind = sshxLink ? "sshx" : "gotty";
  return [
    {
      id: `running-lab-share:${kind}:${lab.endpointId}:${lab.name}`,
      label: kind === "sshx" ? "Shared Terminal" : "Web Terminal",
      contextValue:
        kind === "sshx" ? "containerlabSSHXLink" : "containerlabGottyLink",
      collapsibleState: TREE_ITEM_NONE,
      endpointId: lab.endpointId,
      labName: lab.name,
      topologyRef,
      link: shareLink,
      children: [],
    },
  ];
}

function runningLabPathHint(
  lab: LabState,
  topologyEntry?: TopologyFileEntry,
): string | undefined {
  const fallbackPathHint =
    lab.topologyPath ||
    (lab.containers.values().next().value?.labPath as string | undefined);
  return topologyEntry?.path ?? fallbackPathHint;
}

function buildRunningLabItem(input: {
  containers: ExplorerTreeItem[];
  lab: LabState;
  pathHint?: string;
  shareChildren: ExplorerTreeItem[];
  topologyRef?: TopologyRef;
}): ExplorerTreeItem {
  const { containers, lab, pathHint, shareChildren, topologyRef } = input;
  const owner = getLabOwner(lab);
  const labLabel = owner ? `${lab.name} (${owner})` : lab.name;
  const shared = isSharedWorkspacePath(topologyRef?.yamlPath);
  const labItem: ExplorerTreeItem = {
    id: `running-lab:${lab.endpointId}:${lab.name}`,
    label: labLabel,
    workspaceScope: shared ? "shared" : undefined,
    description: pathHint || "No API topology file",
    tooltip: shared
      ? `${pathHint}\n${SHARED_WORKSPACE_DESCRIPTION}`
      : pathHint || `No API topology file available for running lab "${lab.name}"`,
    contextValue:
      topologyRef &&
      isStandaloneFavorite({ endpointId: lab.endpointId, topologyRef })
        ? "containerlabLabDeployedFavorite"
        : "containerlabLabDeployed",
    collapsibleState:
      shareChildren.length > 0 || containers.length > 0
        ? TREE_ITEM_COLLAPSED
        : TREE_ITEM_NONE,
    endpointId: lab.endpointId,
    labName: lab.name,
    topologyRef,
    children: [...shareChildren, ...containers],
  };

  if (topologyRef) {
    labItem.command = {
      command: "containerlab.lab.graph.topoViewer",
      title: "Open TopoViewer",
      arguments: [labItem],
    };
  }

  return labItem;
}

function disconnectedEndpointLabel(status: EndpointConfig["status"]): string {
  if (status === "saved") {
    return "Saved endpoint — reconnect to restore the session";
  }
  if (status === "session_expired") {
    return "Session expired — reconnect with your credentials";
  }
  return "Endpoint is offline — reconnect when it is reachable";
}

type ExplorerSnapshotMessage = Extract<
  ExplorerIncomingMessage,
  { command: "snapshot" }
>;
type ExpandedBySection = Partial<Record<string, string[]>>;
type ExplorerTreeProviderLike = {
  getChildren(
    element?: ExplorerTreeItem,
  ): ExplorerTreeItem[] | Promise<ExplorerTreeItem[]>;
};
type StandaloneExplorerSnapshotProviders = ExplorerSnapshotProviders & {
  fileProvider?: ExplorerTreeProviderLike;
};

export interface StandaloneExplorerBridge {
  explorer: {
    connect: () => void;
    invokeAction: (actionRef: string) => Promise<void>;
    persistUiState: (state: ExplorerUiState) => void;
    setFilter: (filterText: string) => void;
    subscribe: (
      handler: (message: ExplorerIncomingMessage) => void,
    ) => () => void;
  };
  invalidateFileExplorerCache: (endpointId?: string) => void;
  scheduleSnapshot: (delay?: number) => void;
}

const HELP_LINKS = [
  { label: "Containerlab Documentation", url: "https://containerlab.dev/" },
  {
    label: "VS Code Extension Documentation",
    url: "https://containerlab.dev/manual/vsc-extension/",
  },
  {
    label: "Browse Labs on GitHub (srl-labs)",
    url: "https://github.com/srl-labs/",
  },
  { label: "Join our Discord server", url: "https://discord.gg/vAyddtaEV9" },
] as const;

function filterTreeItems(
  items: ExplorerTreeItem[],
  filterText: string,
): ExplorerTreeItem[] {
  const query = filterText.trim().toLowerCase();
  if (query.length === 0) {
    return items;
  }

  const visit = (item: ExplorerTreeItem): ExplorerTreeItem | null => {
    const filteredChildren = (item.children ?? [])
      .map((child) => visit(child))
      .filter((child): child is ExplorerTreeItem => child !== null);
    const haystack = [item.label, item.description, item.tooltip]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    if (haystack.includes(query) || filteredChildren.length > 0) {
      return { ...item, children: filteredChildren };
    }
    return null;
  };

  return items
    .map((item) => visit(item))
    .filter((item): item is ExplorerTreeItem => item !== null);
}

function buildContainerTooltip(input: {
  id: string;
  image: string;
  ipv4?: string;
  ipv6?: string;
  kind: string;
  name: string;
  state: string;
  status: string;
}): string {
  const lines = [
    `Name: ${input.name}`,
    `State: ${input.state}`,
    `Status: ${input.status}`,
    `Kind: ${input.kind}`,
    `Image: ${input.image}`,
    `ID: ${input.id}`,
  ];
  if (input.ipv4 && input.ipv4 !== "N/A") {
    lines.push(`IPv4: ${input.ipv4}`);
  }
  if (input.ipv6 && input.ipv6 !== "N/A") {
    lines.push(`IPv6: ${input.ipv6}`);
  }
  return lines.join("\n");
}

function buildInterfaceTooltip(input: {
  alias: string;
  mac: string;
  mtu: string;
  name: string;
  rxBps?: string;
  state: string;
  txBps?: string;
  type: string;
}): string {
  const lines = [
    `Name: ${input.name}`,
    `Alias: ${input.alias || "N/A"}`,
    `State: ${input.state || "unknown"}`,
    `Type: ${input.type || "N/A"}`,
    `MAC: ${input.mac || "N/A"}`,
    `MTU: ${input.mtu || "N/A"}`,
  ];
  if (input.rxBps) {
    lines.push(`RX: ${input.rxBps} bps`);
  }
  if (input.txBps) {
    lines.push(`TX: ${input.txBps} bps`);
  }
  return lines.join("\n");
}

function getInterfaceContextValue(state: string): string {
  return state.toLowerCase() === "up"
    ? "containerlabInterfaceUp"
    : "containerlabInterfaceDown";
}

function shouldShowRunningLab(
  lab: LabState,
  endpointsById: ReadonlyMap<string, EndpointConfig>,
  topologyEntry?: TopologyFileEntry,
): boolean {
  if (explorerPreferences.showNonOwnedLabs || isSharedWorkspacePath(topologyEntry?.path)) {
    return true;
  }

  const endpointUser = endpointsById.get(lab.endpointId)?.username;
  const owner = getLabOwner(lab);
  if (!endpointUser || !owner) {
    return true;
  }
  return normalizeLabName(owner) === normalizeLabName(endpointUser);
}

function findTopologyEntryForRunningLab(
  lab: LabState,
  files: TopologyFileEntry[],
): TopologyFileEntry | undefined {
  const pathHints = new Set<string>();
  const normalizedTopologyPath = normalizePathValue(lab.topologyPath);
  if (normalizedTopologyPath) {
    pathHints.add(normalizedTopologyPath);
  }
  for (const container of lab.containers.values()) {
    const containerPath = normalizePathValue(container.labPath);
    if (!containerPath) {
      continue;
    }
    pathHints.add(containerPath);
    const exact = files.find(
      (entry) => normalizePathValue(entry.path) === containerPath,
    );
    if (exact) {
      return exact;
    }
  }

  const absoluteMatch = files.find((entry) => entry.topologyRef.absoluteYamlPath &&
    pathHints.has(normalizePathValue(entry.topologyRef.absoluteYamlPath)));
  if (absoluteMatch) {
    return absoluteMatch;
  }
  // New servers provide authoritative paths. Only legacy personal entries may
  // fall back to suffix/name matching.
  files = files.filter((entry) => !entry.topologyRef.absoluteYamlPath && !isSharedWorkspacePath(entry.path));

  const loosePathMatches = files.filter((entry) => {
    const entryPath = normalizePathValue(entry.path);
    for (const pathHint of pathHints) {
      if (topologyPathsLikelyMatch(entryPath, pathHint)) {
        return true;
      }
    }
    return false;
  });
  if (loosePathMatches.length === 1) {
    return loosePathMatches[0];
  }

  const normalizedLabName = normalizeLabName(lab.name);
  if (!normalizedLabName) {
    return undefined;
  }
  const nameMatches = files.filter(
    (entry) =>
      normalizeLabName(topologyEntryLabName(entry)) === normalizedLabName,
  );
  if (nameMatches.length === 1) {
    return nameMatches[0];
  }
  if (nameMatches.length > 1 && loosePathMatches.length > 0) {
    const combinedMatches = nameMatches.filter((entry) =>
      loosePathMatches.some((candidate) => candidate.path === entry.path),
    );
    if (combinedMatches.length === 1) {
      return combinedMatches[0];
    }
  }
  return undefined;
}

function buildEndpointRootItem(
  endpoint: EndpointConfig,
  idPrefix: string,
  children: ExplorerTreeItem[],
  healthState?: EndpointHealthCacheEntry,
): ExplorerTreeItem {
  const endpointUrl = endpoint.url.replace(/^https?:\/\//i, "");
  const baseTooltip = `${endpoint.url}\nUsername: ${endpoint.username}\nStatus: ${endpoint.status.replace(/_/g, " ")}`;
  const healthTooltip = endpointHealthTooltip(healthState);
  return {
    id: `${idPrefix}:${endpoint.id}`,
    label: endpoint.label,
    description: endpointUrl,
    tooltip: healthTooltip ? `${baseTooltip}\n\n${healthTooltip}` : baseTooltip,
    contextValue: "containerlabEndpoint",
    endpointId: endpoint.id,
    state: endpoint.status,
    collapsibleState:
      children.length > 0 ? TREE_ITEM_COLLAPSED : TREE_ITEM_NONE,
    children,
  };
}

function endpointHealthTooltip(
  state: EndpointHealthCacheEntry | undefined,
): string | undefined {
  if (!state) {
    return undefined;
  }
  if (state.status === "loading") {
    return "Health: loading...";
  }
  if (state.status === "error") {
    return "Health: unavailable";
  }
  return `Health\n${formatEndpointHealthTooltip(state.metrics)}`;
}

function buildEndpointSectionItem(
  endpointId: string,
  kind: "running" | "local",
  children: ExplorerTreeItem[],
): ExplorerTreeItem {
  const count = children.length;
  return {
    id: `endpoint-section:${kind}:${endpointId}`,
    label: kind === "running" ? "Running Labs" : "Undeployed Labs",
    tooltip: `${count} ${kind === "running" ? "running" : "undeployed"} lab${count === 1 ? "" : "s"}`,
    contextValue:
      kind === "running"
        ? "containerlabEndpointSectionRunning"
        : "containerlabEndpointSectionLocal",
    endpointId,
    collapsibleState: count > 0 ? TREE_ITEM_COLLAPSED : TREE_ITEM_NONE,
    children,
  };
}

function fileExplorerCacheKey(
  endpointId: string,
  pathValue: string | undefined,
): string {
  return `${endpointId}:${normalizePathValue(pathValue ?? "")}`;
}

function stringArraysEqual(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const leftValues = left ?? [];
  const rightValues = right ?? [];
  if (leftValues.length !== rightValues.length) {
    return false;
  }
  for (let index = 0; index < leftValues.length; index += 1) {
    if (leftValues[index] !== rightValues[index]) {
      return false;
    }
  }
  return true;
}

function isTopologyExplorerEntry(entry: FileExplorerEntry): boolean {
  return Boolean(entry.topologyRef) || /\.clab\.ya?ml$/i.test(entry.path);
}

function buildFileExplorerEntryItem(
  entry: FileExplorerEntry,
): ExplorerTreeItem {
  const isDirectory = entry.kind === "directory";
  const sharedRoot = isDirectory && entry.path === "@shared";
  const isTopology = !isDirectory && isTopologyExplorerEntry(entry);
  const description = isDirectory ? undefined : entry.labName;
  let contextValue = "containerlabFile";
  if (isDirectory) {
    contextValue = sharedRoot ? "containerlabFileExplorerRoot" : "containerlabFileFolder";
  } else if (isTopology) {
    contextValue = "containerlabFileTopology";
  }
  return {
    id: `file:${entry.endpointId}:${entry.path || "."}`,
    label: sharedRoot ? "Shared labs" : entry.name || safeFilename(entry.path),
    description,
    tooltip: isSharedWorkspacePath(entry.path)
      ? `${entry.path}\n${SHARED_WORKSPACE_DESCRIPTION}`
      : `Lab workspace/${entry.path}`,
    contextValue,
    endpointId: entry.endpointId,
    labName: entry.labName,
    topologyRef: entry.topologyRef,
    resourceKind: entry.kind,
    resourcePath: entry.path,
    hasChildren: isDirectory && Boolean(entry.hasChildren),
    collapsibleState: isDirectory ? TREE_ITEM_COLLAPSED : TREE_ITEM_NONE,
    children: [],
  };
}

function dedupeExplorerActions(actions: ExplorerAction[]): ExplorerAction[] {
  const seen = new Set<string>();
  const deduped: ExplorerAction[] = [];
  for (const action of actions) {
    const key = `${action.commandId}:${action.label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(action);
  }
  return deduped;
}

function cloneExpandedBySection(
  expandedBySection: ExplorerUiState["expandedBySection"],
): ExpandedBySection {
  const next: ExpandedBySection = {};
  for (const [sectionId, itemIds] of Object.entries(expandedBySection ?? {})) {
    next[sectionId] = [...itemIds];
  }
  return next;
}

function isExpandableTreeItem(item: ExplorerTreeItem): boolean {
  return (
    item.collapsibleState !== TREE_ITEM_NONE ||
    Boolean(item.hasChildren) ||
    (item.children?.length ?? 0) > 0
  );
}

function collectExpandableTreeItemIds(items: ExplorerTreeItem[]): string[] {
  const ids: string[] = [];
  const visit = (item: ExplorerTreeItem): void => {
    if (item.id && isExpandableTreeItem(item)) {
      ids.push(item.id);
    }
    for (const child of item.children ?? []) {
      visit(child);
    }
  };
  for (const item of items) {
    visit(item);
  }
  return ids;
}

export function createStandaloneExplorerBridge(
  options: StandaloneExplorerBridgeOptions,
): StandaloneExplorerBridge {
  const lifecycleActionsAvailable = options.lifecycleActionsAvailable !== false;
  const hiddenCommandIds = lifecycleActionsAvailable
    ? STANDALONE_HIDDEN_COMMAND_IDS
    : [...STANDALONE_HIDDEN_COMMAND_IDS, ...PAGES_LIFECYCLE_HIDDEN_COMMAND_IDS];
  let explorerFilterText = "";
  let explorerUiState: ExplorerUiState = {};
  const explorerSubscribers = new Set<
    (message: ExplorerIncomingMessage) => void
  >();
  const sshxLinksByLab = new Map<string, string>();
  const gottyLinksByLab = new Map<string, string>();
  const endpointHealthCache = new Map<string, EndpointHealthCacheEntry>();
  const fileExplorerCache = new Map<string, FileExplorerEntry[]>();
  const defaultExpandedBySection: ExpandedBySection = {};
  const defaultExpandedSections = new Set<string>();
  const userManagedExpandedSections = new Set<string>();
  let nativeFileExplorerSectionObserved = false;
  let scheduleHealthSnapshotRefresh = (_delay?: number): void => {};

  function sendExplorerMessage(message: ExplorerIncomingMessage): void {
    const outgoing =
      message.command === "snapshot"
        ? transformSnapshotForEndpointRoots(message)
        : message;
    for (const subscriber of explorerSubscribers) {
      subscriber(outgoing);
    }
  }

  function postExplorerError(message: string): void {
    sendExplorerMessage({ command: "error", message });
  }

  function pruneEndpointHealthCache(endpoints: EndpointConfig[]): void {
    const connectedEndpointIds = new Set(
      endpoints
        .filter((endpoint) => endpoint.connected)
        .map((endpoint) => endpoint.id),
    );
    for (const endpointId of endpointHealthCache.keys()) {
      if (!connectedEndpointIds.has(endpointId)) {
        endpointHealthCache.delete(endpointId);
      }
    }
  }

  function startEndpointHealthRefresh(
    endpointId: string,
  ): EndpointHealthCacheEntry {
    void fetchEndpointHealthMetrics(endpointId)
      .then((metrics) => {
        endpointHealthCache.set(endpointId, {
          status: "ready",
          metrics,
          fetchedAt: Date.now(),
        });
        scheduleHealthSnapshotRefresh(0);
      })
      .catch(() => {
        endpointHealthCache.set(endpointId, {
          status: "error",
          fetchedAt: Date.now(),
        });
        scheduleHealthSnapshotRefresh(0);
      });
    const loadingState: EndpointHealthCacheEntry = {
      status: "loading",
      fetchedAt: Date.now(),
    };
    endpointHealthCache.set(endpointId, loadingState);
    return loadingState;
  }

  function clearFileExplorerCache(endpointId?: string): void {
    if (!endpointId) {
      fileExplorerCache.clear();
      return;
    }
    const prefix = `${endpointId}:`;
    for (const key of fileExplorerCache.keys()) {
      if (key.startsWith(prefix)) {
        fileExplorerCache.delete(key);
      }
    }
  }

  function endpointHealthStateForTooltip(
    endpoint: EndpointConfig,
  ): EndpointHealthCacheEntry | undefined {
    if (!endpoint.connected) {
      endpointHealthCache.delete(endpoint.id);
      return undefined;
    }

    const current = endpointHealthCache.get(endpoint.id);
    if (current?.status === "loading") {
      return current;
    }
    if (
      current &&
      Date.now() - current.fetchedAt < ENDPOINT_HEALTH_CACHE_TTL_MS
    ) {
      return current;
    }
    return startEndpointHealthRefresh(endpoint.id);
  }

  function collectRunningLabItemsByEndpoint(
    files: TopologyFileEntry[],
  ): Map<string, ExplorerTreeItem[]> {
    const labs = options.getLabs();
    const endpoints = options.getEndpoints();
    const endpointsById = new Map(
      endpoints.map((endpoint) => [endpoint.id, endpoint]),
    );
    const filesByEndpoint = groupTopologyFilesByEndpoint(files);

    const labItemsByEndpoint = new Map<string, ExplorerTreeItem[]>();
    for (const lab of labs.values()) {
      const endpointFiles = filesByEndpoint.get(lab.endpointId) ?? [];
      const matchedEntry = findTopologyEntryForRunningLab(lab, endpointFiles);
      if (!shouldShowRunningLab(lab, endpointsById, matchedEntry)) {
        continue;
      }

      const endpointUsername = endpointsById.get(lab.endpointId)?.username;
      const topologyEntry = isNonOwnedLabForEndpoint(lab, endpointUsername) && !isSharedWorkspacePath(matchedEntry?.path)
        ? undefined
        : matchedEntry;
      const topologyRef = topologyRefForRunningLab(lab, topologyEntry);
      const containers = [...lab.containers.values()].map((container) =>
        buildRunningContainerItem(lab, container, topologyRef),
      );

      const pathHint = runningLabPathHint(lab, topologyEntry);
      const normalizedLabKey = normalizeLabName(lab.name);
      const sshxLink = (sshxLinksByLab.get(normalizedLabKey) ?? "").trim();
      const gottyLink = (gottyLinksByLab.get(normalizedLabKey) ?? "").trim();
      const shareChildren = buildRunningShareItems(
        lab,
        topologyRef,
        sshxLink,
        gottyLink,
      );
      const labItem = buildRunningLabItem({
        containers,
        lab,
        pathHint,
        shareChildren,
        topologyRef,
      });

      const bucket = labItemsByEndpoint.get(lab.endpointId) ?? [];
      bucket.push(labItem);
      labItemsByEndpoint.set(lab.endpointId, bucket);
    }

    return labItemsByEndpoint;
  }

  function collectLocalLabItemsByEndpoint(
    files: TopologyFileEntry[],
  ): Map<string, ExplorerTreeItem[]> {
    const runningLabs = options.getLabs();
    const filesByEndpoint = new Map<string, TopologyFileEntry[]>();
    for (const file of files) {
      const bucket = filesByEndpoint.get(file.endpointId) ?? [];
      bucket.push(file);
      filesByEndpoint.set(file.endpointId, bucket);
    }

    const localItemsByEndpoint = new Map<string, ExplorerTreeItem[]>();
    for (const [endpointId, endpointFiles] of filesByEndpoint.entries()) {
      const items = endpointFiles
        .filter(
          (file) =>
            !(file.filename || safeFilename(file.path)).startsWith(".") &&
            !isTopologyRunning(file.topologyRef, runningLabs),
        )
        .map((file) => {
          const labName = topologyEntryLabName(file);
          const item: ExplorerTreeItem = {
            id: `local-lab:${file.endpointId}:${file.path}`,
            label: safeFilename(file.filename || file.path),
            workspaceScope: isSharedWorkspacePath(file.path) ? "shared" : undefined,
            description: file.path,
            tooltip: isSharedWorkspacePath(file.path) ? `${file.path}\n${SHARED_WORKSPACE_DESCRIPTION}` : file.path,
            contextValue: isStandaloneFavorite({
              endpointId: file.endpointId,
              topologyRef: file.topologyRef,
            })
              ? "containerlabLabUndeployedFavorite"
              : "containerlabLabUndeployed",
            collapsibleState: TREE_ITEM_NONE,
            endpointId: file.endpointId,
            labName,
            topologyRef: file.topologyRef,
            children: [],
          };
          item.command = {
            command: "containerlab.lab.graph.topoViewer",
            title: "Open TopoViewer",
            arguments: [item],
          };
          return item;
        });
      localItemsByEndpoint.set(endpointId, items);
    }

    return localItemsByEndpoint;
  }

  function buildEndpointGroupedItems(
    filterText: string,
    files: TopologyFileEntry[],
  ): ExplorerTreeItem[] {
    const endpoints = options.getEndpoints();
    pruneEndpointHealthCache(endpoints);
    const runningByEndpoint = collectRunningLabItemsByEndpoint(files);
    const localByEndpoint = collectLocalLabItemsByEndpoint(files);

    const endpointItems = endpoints.map((endpoint) => {
      if (!endpoint.connected) {
        const placeholderLabel = disconnectedEndpointLabel(endpoint.status);
        const placeholder: ExplorerTreeItem = {
          id: `endpoint-disconnected:${endpoint.id}`,
          label: placeholderLabel,
          contextValue: "containerlabEndpointDisconnected",
          collapsibleState: TREE_ITEM_NONE,
          endpointId: endpoint.id,
          children: [],
        };
        return buildEndpointRootItem(endpoint, "endpoint", [placeholder]);
      }
      const healthState = endpointHealthStateForTooltip(endpoint);
      const runningItems = filterTreeItems(
        runningByEndpoint.get(endpoint.id) ?? [],
        filterText,
      );
      const localItems = filterTreeItems(
        localByEndpoint.get(endpoint.id) ?? [],
        filterText,
      );
      const groups = [
        buildEndpointSectionItem(endpoint.id, "running", runningItems),
        buildEndpointSectionItem(endpoint.id, "local", localItems),
      ];
      return buildEndpointRootItem(
        endpoint,
        "endpoint",
        filterTreeItems(groups, filterText),
        healthState,
      );
    });

    return filterTreeItems(endpointItems, filterText);
  }

  function buildHelpItems(): ExplorerTreeItem[] {
    return HELP_LINKS.map((link) => ({
      id: `help:${link.url}`,
      label: link.label,
      tooltip: link.url,
      link: link.url,
      collapsibleState: TREE_ITEM_NONE,
      children: [],
    }));
  }

  function fileExplorerExpandedItemIds(): Set<string> {
    const expanded = explorerUiState.expandedBySection as
      ExpandedBySection | undefined;
    const itemIds = nativeFileExplorerSectionObserved
      ? (expanded?.[FILE_EXPLORER_SECTION_ID] ??
        expanded?.[LOCAL_LABS_SECTION_ID] ??
        [])
      : (expanded?.[LOCAL_LABS_SECTION_ID] ??
        expanded?.[FILE_EXPLORER_SECTION_ID] ??
        []);
    return new Set(itemIds);
  }

  function buildFileExplorerProvider(
    filterText: string,
    respectExpandedState = true,
  ): ExplorerTreeProviderLike {
    const normalizedFilter = filterText.trim().toLowerCase();
    const entryMatchesFilter = (entry: FileExplorerEntry): boolean => {
      if (!normalizedFilter) {
        return true;
      }
      return `${entry.name} ${entry.path} ${entry.labName ?? ""}`
        .toLowerCase()
        .includes(normalizedFilter);
    };

    return {
      async getChildren(
        element?: ExplorerTreeItem,
      ): Promise<ExplorerTreeItem[]> {
        if (!element) {
          return options
            .getEndpoints()
            .filter((endpoint) => endpoint.connected)
            .map((endpoint) => ({
              id: `file-root:${endpoint.id}`,
              label: endpoint.label,
              tooltip: `${endpoint.label} (${endpoint.url}): lab workspace`,
              contextValue: "containerlabFileExplorerRoot",
              endpointId: endpoint.id,
              resourceKind: "directory",
              resourcePath: "",
              hasChildren: true,
              collapsibleState: TREE_ITEM_COLLAPSED,
              children: [],
            }));
        }

        if (!element.endpointId || element.resourceKind !== "directory") {
          return [];
        }
        if (
          respectExpandedState &&
          element.id &&
          !fileExplorerExpandedItemIds().has(element.id)
        ) {
          return [];
        }

        const cacheKey = fileExplorerCacheKey(
          element.endpointId,
          element.resourcePath,
        );
        const cached = fileExplorerCache.get(cacheKey);
        if (cached) {
          return cached
            .filter(entryMatchesFilter)
            .map((entry) => buildFileExplorerEntryItem(entry));
        }

        const entries = await listFileExplorerDirectory(
          element.endpointId,
          element.resourcePath ?? "",
        );
        fileExplorerCache.set(cacheKey, entries);
        return entries
          .filter(entryMatchesFilter)
          .map((entry) => buildFileExplorerEntryItem(entry));
      },
    };
  }

  async function collectDefaultFileExplorerExpandedIds(
    fileProvider: ExplorerTreeProviderLike,
  ): Promise<string[]> {
    const expandedIds: string[] = [];

    const visit = async (item: ExplorerTreeItem): Promise<void> => {
      if (!item.id || item.resourceKind !== "directory" || !item.endpointId) {
        return;
      }
      if (!item.hasChildren && !item.id.startsWith("file-root:")) {
        return;
      }

      let children: ExplorerTreeItem[];
      try {
        children = await fileProvider.getChildren(item);
      } catch {
        return;
      }

      expandedIds.push(item.id);
      for (const child of children) {
        await visit(child);
      }
    };

    const roots = await fileProvider.getChildren();
    for (const root of roots) {
      await visit(root);
    }
    return expandedIds;
  }

  async function applyDefaultExpandedExplorerState(input: {
    fileProvider: ExplorerTreeProviderLike;
    runningItems: ExplorerTreeItem[];
  }): Promise<void> {
    if (options.defaultExpandExplorerTrees !== true) {
      return;
    }

    defaultExpandedBySection.runningLabs = collectExpandableTreeItemIds(
      input.runningItems,
    );
    const defaultFileExplorerIds = await collectDefaultFileExplorerExpandedIds(
      input.fileProvider,
    );
    for (const sectionId of FILE_EXPLORER_STATE_SECTION_IDS) {
      defaultExpandedBySection[sectionId] = defaultFileExplorerIds;
    }
    defaultExpandedSections.add(RUNNING_LABS_SECTION_ID);
    for (const sectionId of FILE_EXPLORER_STATE_SECTION_IDS) {
      defaultExpandedSections.add(sectionId);
    }

    const nextExpanded = cloneExpandedBySection(
      explorerUiState.expandedBySection,
    );
    let changed = false;
    for (const sectionId of [
      RUNNING_LABS_SECTION_ID,
      ...FILE_EXPLORER_STATE_SECTION_IDS,
    ] as const) {
      if (userManagedExpandedSections.has(sectionId)) {
        continue;
      }
      const defaultIds = defaultExpandedBySection[sectionId] ?? [];
      if (!stringArraysEqual(nextExpanded[sectionId], defaultIds)) {
        nextExpanded[sectionId] = [...defaultIds];
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    explorerUiState = {
      ...explorerUiState,
      expandedBySection: nextExpanded as ExplorerUiState["expandedBySection"],
    };
    sendExplorerMessage({ command: "uiState", state: explorerUiState });
  }

  function trackUserManagedExpandedSections(state: ExplorerUiState): void {
    if (options.defaultExpandExplorerTrees !== true) {
      return;
    }

    const expandedBySection = state.expandedBySection as
      ExpandedBySection | undefined;
    for (const sectionId of [
      RUNNING_LABS_SECTION_ID,
      ...FILE_EXPLORER_STATE_SECTION_IDS,
    ] as const) {
      const nextIds = expandedBySection?.[sectionId];
      if (!defaultExpandedSections.has(sectionId) || nextIds === undefined) {
        continue;
      }
      if (
        stringArraysEqual(nextIds, defaultExpandedBySection[sectionId] ?? [])
      ) {
        userManagedExpandedSections.delete(sectionId);
      } else {
        userManagedExpandedSections.add(sectionId);
      }
    }
  }

  function shouldRefreshOnExplorerUiStateChanged(
    previous: ExplorerUiState,
    next: ExplorerUiState,
  ): boolean {
    const previousExpanded = previous.expandedBySection as
      Partial<Record<string, string[]>> | undefined;
    const nextExpanded = next.expandedBySection as
      Partial<Record<string, string[]>> | undefined;
    return FILE_EXPLORER_STATE_SECTION_IDS.some(
      (sectionId) =>
        !stringArraysEqual(
          previousExpanded?.[sectionId],
          nextExpanded?.[sectionId],
        ),
    );
  }

  function transformSnapshotForEndpointRoots(
    message: ExplorerSnapshotMessage,
  ): ExplorerSnapshotMessage {
    const runningSection = message.sections.find(
      (section) => section.id === RUNNING_LABS_SECTION_ID,
    );
    const localSection = message.sections.find(
      (section) => section.id === LOCAL_LABS_SECTION_ID,
    );
    const hasNativeFileExplorerSection = message.sections.some(
      (section) => String(section.id) === FILE_EXPLORER_SECTION_ID,
    );
    nativeFileExplorerSectionObserved ||= hasNativeFileExplorerSection;
    if (!runningSection) {
      return message;
    }

    return {
      ...message,
      sections: message.sections.flatMap((section) => {
        if (section.id === LOCAL_LABS_SECTION_ID) {
          if (hasNativeFileExplorerSection) {
            return [];
          }
          return [
            {
              ...section,
              label: "File Explorer",
              count: section.nodes.length,
              appearance: "bareTree" as const,
            },
          ];
        }

        if (section.id !== RUNNING_LABS_SECTION_ID) {
          return [section];
        }
        return [
          {
            ...section,
            label: "Endpoints",
            count: options.getEndpoints().length,
            appearance: "bareTree" as const,
            toolbarActions: dedupeExplorerActions([
              ...section.toolbarActions,
              ...(localSection?.toolbarActions ?? []),
            ]),
          },
        ];
      }),
    };
  }

  async function buildExplorerProviders(
    filterText: string = explorerFilterText,
  ): Promise<ExplorerSnapshotProviders> {
    const files = await options.listTopologyFiles();
    const runningItems = buildEndpointGroupedItems(filterText, files);
    const helpItems = buildHelpItems();
    const fileProvider = buildFileExplorerProvider(filterText);
    const defaultExpansionFileProvider = buildFileExplorerProvider(
      filterText,
      false,
    );
    await applyDefaultExpandedExplorerState({
      fileProvider: defaultExpansionFileProvider,
      runningItems,
    });

    const providers: StandaloneExplorerSnapshotProviders = {
      runningProvider: new SimpleExplorerProvider(
        runningItems,
      ) as ExplorerSnapshotProviders["runningProvider"],
      localProvider: fileProvider as ExplorerSnapshotProviders["localProvider"],
      fileProvider,
      helpProvider: new SimpleExplorerProvider(
        helpItems,
      ) as ExplorerSnapshotProviders["helpProvider"],
    };
    return providers;
  }

  const executeExplorerCommand = createExplorerCommandHandler({
    options,
    postExplorerError,
    clearFileExplorerCache,
    scheduleSnapshot: (delay) => controller.scheduleSnapshot(delay),
    sshxLinksByLab,
    gottyLinksByLab,
  });

  const controllerOptions = {
    initialFilterText: explorerFilterText,
    initialUiState: explorerUiState,
    debounceMs: options.debounceMs,
    buildProviders: buildExplorerProviders,
    executeAction: async (binding) => {
      await executeExplorerCommand(binding.commandId, binding.args ?? []);
    },
    publish: sendExplorerMessage,
    getSnapshotOptions() {
      return {
        hideNonOwnedLabs: !explorerPreferences.showNonOwnedLabs,
        isLocalCaptureAllowed: true,
        hiddenCommandIds,
        commandMetadata: STANDALONE_EXPLORER_COMMAND_METADATA,
        sectionOrder: [
          RUNNING_LABS_SECTION_ID,
          LOCAL_LABS_SECTION_ID,
          FILE_EXPLORER_SECTION_ID,
          "helpFeedback",
        ] as unknown as ExplorerSectionId[],
        expandedBySection:
          explorerUiState.expandedBySection as ExplorerUiState["expandedBySection"],
      };
    },
    onFilterTextChanged(filterText) {
      explorerFilterText = filterText;
    },
    onUiStateChanged(state) {
      trackUserManagedExpandedSections(state ?? {});
      explorerUiState = state ?? {};
    },
    refreshOnUiStateChanged(previous, next) {
      return shouldRefreshOnExplorerUiStateChanged(previous, next);
    },
  } as Parameters<typeof createExplorerController>[0] & {
    refreshOnUiStateChanged?: (
      previous: ExplorerUiState,
      next: ExplorerUiState,
    ) => boolean;
  };
  const controller = createExplorerController(controllerOptions);
  scheduleHealthSnapshotRefresh = (delay) => controller.scheduleSnapshot(delay);

  return {
    explorer: {
      connect() {
        controller.connect();
      },
      invokeAction(actionRef) {
        return controller.invokeAction(actionRef);
      },
      persistUiState(state) {
        const previous = explorerUiState;
        void controller.persistUiState(state);
        if (shouldRefreshOnExplorerUiStateChanged(previous, state ?? {})) {
          controller.scheduleSnapshot(0);
        }
      },
      setFilter(filterText) {
        void controller.setFilter(filterText);
      },
      subscribe(handler) {
        explorerSubscribers.add(handler);
        return () => {
          explorerSubscribers.delete(handler);
        };
      },
    },
    invalidateFileExplorerCache(endpointId) {
      clearFileExplorerCache(endpointId);
      controller.scheduleSnapshot(0);
    },
    scheduleSnapshot(delay = options.debounceMs) {
      controller.scheduleSnapshot(delay);
    },
  };
}
