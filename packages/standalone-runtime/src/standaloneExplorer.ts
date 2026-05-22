import { createExplorerController } from "@srl-labs/clab-ui/host";
import type {
  ExplorerAction,
  ExplorerIncomingMessage,
  ExplorerSnapshotProviders,
  ExplorerUiState,
} from "@srl-labs/clab-ui/explorer";
import type { TopologyRef } from "@srl-labs/clab-ui/session";

import { dispatchEndpointUiAction } from "./endpointActions";
import {
  fetchEndpointHealthMetrics,
  formatEndpointHealthTooltip,
  type EndpointHealthMetrics,
} from "./endpointHealth";
import {
  buildPacketflixCapture,
  closeAllWiresharkVncSessions,
  controlNodeLifecycle,
  createFileExplorerDirectory,
  createTopologyFile,
  deleteFileExplorerPath,
  deployLabFromUrl,
  downloadFileExplorerFile,
  downloadLabArchive,
  importTopologyFromUrl,
  fetchNodeBrowserPorts,
  generateDrawioGraph,
  installEdgeShark,
  listFileExplorerDirectory,
  readFileExplorerFile,
  renameFileExplorerPath,
  runFcliCommand,
  runGottyShareAction,
  runSshxShareAction,
  createWiresharkVncSessions,
  uninstallEdgeShark,
  uploadFileExplorerFile,
  writeFileExplorerFile,
  type FileExplorerDocument,
  type FileExplorerEntry,
  type LabArchiveFormat,
  type NetemFields,
} from "./runtimeApi";
import {
  confirmRuntimeAction,
  deleteTopologyFileFlow,
  promptForCloneRepo,
  promptForCreateTopology,
  promptForEndpointSelection,
  promptForOptionSelection,
  promptForTextInput,
  saveConfigsFlow,
  type CloneRepoDialogTarget,
} from "./runtimeActionFlows";
import { publicAssetUrl } from "./publicAssetUrl";
import type { EndpointConfig } from "./stores/endpointStore";
import type {
  ContainerState,
  InterfaceState,
  LabState,
} from "./stores/labStore";
import { runtimeUiActions } from "./stores/runtimeUiStore";
import {
  getSessionHostnameOverride,
  loadCapturePreferences,
  setSessionHostnameOverride,
} from "./runtimeCaptureSettings";
import type {
  DeploymentState,
  ExplorerTreeItem,
  LifecycleCommandEndpoint,
  TopologyFileEntry,
} from "./standaloneHostShared";
import {
  TREE_ITEM_COLLAPSED,
  TREE_ITEM_NONE,
  SimpleExplorerProvider,
  buildStandaloneTopologyRefFromPath,
  extractEndpointIdFromTopologyId,
  findLabStateForTopology,
  firstArgAsTopologyRef,
  firstArgAsTreeItem,
  getLabOwner,
  isNonOwnedLabForEndpoint,
  isTopologyRunning,
  normalizeLabName,
  normalizePathValue,
  safeFilename,
  stripTopologySuffix,
  topologyPathsLikelyMatch,
  topologyEntryLabName,
} from "./standaloneHostShared";
import { resolveStandaloneTheme } from "./standaloneTheme";
import {
  isStandaloneFavorite,
  toggleStandaloneFavorite,
} from "./standaloneFavorites";

const SHOW_NON_OWNED_LABS_STORAGE_KEY = "clab-standalone-show-non-owned-labs";
const ENDPOINT_HEALTH_CACHE_TTL_MS = 30_000;
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
const STANDALONE_TRANSFER_COMMAND_ICONS = new Map<string, string>([
  ["containerlab.file.download", "download"],
  ["containerlab.file.upload", "upload"],
  ["containerlab.file.downloadArchive", "download"],
  ["containerlab.lab.downloadArchive", "download"],
]);
const STANDALONE_TRANSFER_FILE_ACTIONS = [
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
const STANDALONE_TRANSFER_COMMAND_METADATA = {
  contributedFileActions: STANDALONE_TRANSFER_FILE_ACTIONS,
  contributedLabActions: STANDALONE_TRANSFER_LAB_ACTIONS,
  commandIcons: STANDALONE_TRANSFER_COMMAND_ICONS,
  commandLabels: STANDALONE_TRANSFER_COMMAND_LABELS,
};

type ShareActionKind = "sshx" | "gotty";
type ShareLifecycleAction = "attach" | "detach" | "reattach";
type EndpointHealthCacheEntry =
  | { status: "loading"; fetchedAt: number }
  | { status: "ready"; metrics: EndpointHealthMetrics; fetchedAt: number }
  | { status: "error"; fetchedAt: number };

function loadShowNonOwnedLabsSetting(): boolean {
  try {
    const raw = localStorage.getItem(SHOW_NON_OWNED_LABS_STORAGE_KEY);
    return raw !== "false";
  } catch {
    return true;
  }
}

function persistShowNonOwnedLabsSetting(nextValue: boolean): void {
  try {
    localStorage.setItem(SHOW_NON_OWNED_LABS_STORAGE_KEY, String(nextValue));
  } catch {
    // Ignore persistence failures.
  }
}

let showNonOwnedLabs = loadShowNonOwnedLabsSetting();

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

function findEndpointConfig(
  endpoints: EndpointConfig[],
  endpointId?: string,
): EndpointConfig | undefined {
  return endpointId
    ? endpoints.find((entry) => entry.id === endpointId)
    : undefined;
}

function resolveExplorerActionTopologyRef(input: {
  actionEndpointId?: string;
  actionTopologyRef?: TopologyRef;
  item?: ExplorerTreeItem;
  labs: Map<string, LabState>;
  targetLabel?: string;
}): TopologyRef | undefined {
  const { actionEndpointId, actionTopologyRef, item, labs, targetLabel } =
    input;
  if (actionTopologyRef) {
    return actionTopologyRef;
  }

  const labNameHint = (item?.labName ?? targetLabel ?? "").trim();
  if (!labNameHint) {
    return undefined;
  }

  const normalizedLabNameHint = normalizeLabName(labNameHint);
  for (const lab of labs.values()) {
    if (actionEndpointId && lab.endpointId !== actionEndpointId) {
      continue;
    }
    if (normalizeLabName(lab.name) !== normalizedLabNameHint) {
      continue;
    }
    return buildStandaloneTopologyRefFromPath(
      lab.topologyPath || `${lab.name}.clab.yml`,
      lab.name,
      lab.endpointId,
    );
  }

  return undefined;
}

function resolveExplorerActionEndpointId(
  item: ExplorerTreeItem | undefined,
  topologyRef: TopologyRef | undefined,
): string | undefined {
  if (item?.endpointId) {
    return item.endpointId;
  }
  return extractEndpointIdFromTopologyId(topologyRef?.topologyId);
}

function resolveExplorerTargetLabel(
  item: ExplorerTreeItem | undefined,
  topologyRef: TopologyRef | undefined,
): string | undefined {
  if (topologyRef?.labName) {
    return topologyRef.labName;
  }
  if (item?.labName) {
    return item.labName;
  }
  return typeof item?.label === "string" ? item.label : undefined;
}

async function resolveEndpointForExplorerAction(input: {
  actionDescription: string;
  endpoints: EndpointConfig[];
  postError: (message: string) => void;
  preferredEndpointId?: string;
}): Promise<string | null> {
  const { actionDescription, endpoints, postError, preferredEndpointId } =
    input;
  const preferred = findEndpointConfig(endpoints, preferredEndpointId);
  if (preferred?.status === "connected") {
    return preferred.id;
  }

  const connectedEndpoints = endpoints.filter(
    (endpoint) => endpoint.status === "connected",
  );
  if (connectedEndpoints.length === 0) {
    postError(`Connect an endpoint before trying to ${actionDescription}.`);
    return null;
  }
  if (connectedEndpoints.length === 1) {
    return connectedEndpoints[0].id;
  }

  const selectedEndpointId = await promptForEndpointSelection({
    title: "Select Endpoint",
    message: `Select endpoint for ${actionDescription}.`,
    confirmLabel: "Use Endpoint",
    options: connectedEndpoints.map((endpoint) => ({
      value: endpoint.id,
      label: endpoint.label,
      description: endpoint.url,
    })),
    preferredValue: connectedEndpoints[0]?.id,
  });
  if (!selectedEndpointId) {
    return null;
  }
  if (
    !connectedEndpoints.some((endpoint) => endpoint.id === selectedEndpointId)
  ) {
    runtimeUiActions.notify("Invalid endpoint selection.", "error");
    return null;
  }
  return selectedEndpointId;
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
  const labItem: ExplorerTreeItem = {
    id: `running-lab:${lab.endpointId}:${lab.name}`,
    label: labLabel,
    description: pathHint || "No API topology file",
    tooltip:
      pathHint ||
      `No API topology file available for running lab "${lab.name}"`,
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

function sortedRunningContainers(lab: LabState): ContainerState[] {
  return [...lab.containers.values()].sort((left, right) =>
    (left.nodeName || left.name).localeCompare(right.nodeName || right.name),
  );
}

function topologyRefForNodeActions(
  lab: LabState,
  actionTopologyRef?: TopologyRef,
): TopologyRef {
  return (
    actionTopologyRef ??
    buildStandaloneTopologyRefFromPath(
      lab.topologyPath || `${lab.name}.clab.yml`,
      lab.name,
      lab.endpointId,
    )
  );
}

function sshOpenedNotification(containers: ContainerState[]): string {
  if (containers.length > 1) {
    return `Opened SSH terminals for ${containers.length} nodes.`;
  }
  return `Opened SSH terminal for ${containers[0]?.nodeName || containers[0]?.name}.`;
}

async function runLabShareAction(input: {
  action: ShareLifecycleAction;
  endpointId?: string;
  kind: ShareActionKind;
  topologyRef: TopologyRef;
}) {
  const { action, endpointId, kind, topologyRef } = input;
  if (kind === "sshx") {
    return runSshxShareAction({ endpointId, topologyRef, action });
  }
  return runGottyShareAction({ endpointId, topologyRef, action });
}

function persistShareLink(input: {
  action: ShareLifecycleAction;
  bucket: Map<string, string>;
  labKey: string;
  link: string;
}): void {
  const { action, bucket, labKey, link } = input;
  if (!labKey) {
    return;
  }
  if (action === "detach") {
    bucket.delete(labKey);
    return;
  }
  if (link) {
    bucket.set(labKey, link);
  }
}

function shareActionCanOpenLink(action: ShareLifecycleAction): boolean {
  return action === "attach" || action === "reattach";
}

async function handleShareActionLink(
  kind: ShareActionKind,
  action: ShareLifecycleAction,
  link: string,
): Promise<void> {
  if (!shareActionCanOpenLink(action)) {
    return;
  }
  if (!link) {
    runtimeUiActions.notify(
      `${kind.toUpperCase()} ${action} completed, but no share link was returned.`,
      "warning",
    );
    return;
  }

  await navigator.clipboard.writeText(link).catch(() => {});
  const shouldOpen = await confirmRuntimeAction({
    title: `${kind.toUpperCase()} Link Copied`,
    message: "The link was copied to clipboard.\n\nOpen link now?",
    confirmLabel: "Open Link",
  });
  if (shouldOpen) {
    window.open(link, "_blank", "noopener,noreferrer");
  }
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

function deploymentStateFromContext(
  contextValue: string | undefined,
): DeploymentState | undefined {
  if (contextValue?.includes("containerlabLabDeployed")) {
    return "deployed";
  }
  if (contextValue?.includes("containerlabLabUndeployed")) {
    return "undeployed";
  }
  return undefined;
}

function nodeAccessProtocol(commandId: string): "shell" | "ssh" | "telnet" {
  if (commandId === "containerlab.node.attachShell") {
    return "shell";
  }
  if (commandId === "containerlab.node.telnet") {
    return "telnet";
  }
  return "ssh";
}

function nodeAccessTitlePrefix(protocol: "shell" | "ssh" | "telnet"): string {
  if (protocol === "shell") {
    return "Shell";
  }
  if (protocol === "telnet") {
    return "Telnet";
  }
  return "SSH";
}

type ExplorerSnapshotMessage = Extract<
  ExplorerIncomingMessage,
  { command: "snapshot" }
>;
type ExplorerTreeProviderLike = {
  getChildren(
    element?: ExplorerTreeItem,
  ): ExplorerTreeItem[] | Promise<ExplorerTreeItem[]>;
};
type StandaloneExplorerSnapshotProviders = ExplorerSnapshotProviders & {
  fileProvider?: ExplorerTreeProviderLike;
};

interface StandaloneExplorerBridgeOptions {
  debounceMs: number;
  getEndpoints: () => EndpointConfig[];
  getLabs: () => Map<string, LabState>;
  invalidateTopologyFileListCache: (endpointId?: string) => void;
  lifecycleActionsAvailable?: boolean;
  openFileEditor: (
    document: FileExplorerDocument & { title: string },
  ) => Promise<void> | void;
  runLifecycle: (
    endpoint: LifecycleCommandEndpoint,
    topologyRef: TopologyRef,
    cleanup: boolean,
  ) => Promise<void>;
  listTopologyFiles: () => Promise<TopologyFileEntry[]>;
  loadTopologyFile: (
    topologyRef: TopologyRef,
    options?: { deploymentState?: DeploymentState; endpointId?: string },
  ) => Promise<void>;
  removeEndpoint: (endpointId: string) => Promise<void>;
  resolveApiTopologyPath: (args: unknown[]) => Promise<string | undefined>;
  resolveDeploymentState: (
    topologyRef: TopologyRef,
  ) => Promise<DeploymentState | undefined>;
  resolveTopologyRef: (args: unknown[]) => Promise<TopologyRef | undefined>;
}

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

interface PopularLabRepo {
  name: string;
  description: string;
  htmlUrl: string;
  stars: number;
}

const FALLBACK_POPULAR_REPOS: PopularLabRepo[] = [
  {
    name: "srl-telemetry-lab",
    htmlUrl: "https://github.com/srl-labs/srl-telemetry-lab",
    description: "A lab demonstrating the telemetry stack with SR Linux.",
    stars: 85,
  },
  {
    name: "netbox-nrx-clab",
    htmlUrl: "https://github.com/srl-labs/netbox-nrx-clab",
    description:
      "NetBox NRX Containerlab integration for network automation use cases.",
    stars: 65,
  },
  {
    name: "sros-anysec-macsec-lab",
    htmlUrl: "https://github.com/srl-labs/sros-anysec-macsec-lab",
    description: "SR OS Anysec and MACsec lab with containerlab.",
    stars: 42,
  },
  {
    name: "intent-based-ansible-lab",
    htmlUrl: "https://github.com/srl-labs/intent-based-ansible-lab",
    description: "Intent-based networking lab with Ansible and SR Linux.",
    stars: 38,
  },
  {
    name: "multivendor-evpn-lab",
    htmlUrl: "https://github.com/srl-labs/multivendor-evpn-lab",
    description:
      "Multivendor EVPN lab with Nokia, Arista, and Cisco network operating systems.",
    stars: 78,
  },
];

function normalizePopularRepos(value: unknown): PopularLabRepo[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null,
    )
    .map((entry) => ({
      name: typeof entry.name === "string" ? entry.name : "",
      htmlUrl: typeof entry.html_url === "string" ? entry.html_url : "",
      description:
        typeof entry.description === "string" ? entry.description : "",
      stars:
        typeof entry.stargazers_count === "number" ? entry.stargazers_count : 0,
    }))
    .filter((entry) => entry.name.length > 0 && entry.htmlUrl.length > 0);
}

async function fetchPopularRepos(): Promise<PopularLabRepo[]> {
  try {
    const response = await fetch("/api/runtime/popular-repos", {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim());
    }
    const parsed = normalizePopularRepos(await response.json());
    return parsed.length > 0 ? parsed : FALLBACK_POPULAR_REPOS;
  } catch {
    return FALLBACK_POPULAR_REPOS;
  }
}

async function pickPopularRepo(
  promptTitle: string,
): Promise<string | undefined> {
  const repos = (await fetchPopularRepos()).slice(0, 12);
  if (repos.length === 0) {
    runtimeUiActions.notify(
      "No popular repositories are available right now.",
      "warning",
    );
    return undefined;
  }

  return promptForOptionSelection({
    title: promptTitle,
    message: "Choose a popular lab repository.",
    label: "Popular lab",
    confirmLabel: "Use Repository",
    options: repos.map((repo) => ({
      label: repo.name,
      description:
        `${repo.stars} stars` + (repo.description ? ` - ${repo.description}` : ""),
      value: repo.htmlUrl,
    })),
    preferredValue: repos[0]?.htmlUrl,
  });
}

function triggerTextDownload(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function triggerBlobDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function pickTransferFiles(accept = "", multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    let settled = false;
    const cleanup = (files: File[]) => {
      if (settled) {
        return;
      }
      settled = true;
      input.removeEventListener("change", handleChange);
      input.removeEventListener("cancel", handleCancel);
      input.remove();
      resolve(files);
    };
    const handleChange = () => cleanup(Array.from(input.files ?? []));
    const handleCancel = () => cleanup([]);
    input.addEventListener("change", handleChange, { once: true });
    input.addEventListener("cancel", handleCancel, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

async function promptArchiveFormat(): Promise<LabArchiveFormat | undefined> {
  const value = await promptForOptionSelection({
    title: "Archive Format",
    message: "Choose the archive format to download.",
    label: "Format",
    confirmLabel: "Download",
    options: [
      { label: "ZIP", value: "zip" },
      { label: "tar.gz", value: "tar.gz" },
    ],
    preferredValue: "zip",
  });
  if (value === "zip" || value === "tar.gz") {
    return value;
  }
  return undefined;
}

function resolveArchiveLabFolder(input: {
  item?: ExplorerTreeItem;
  topologyRef?: TopologyRef;
  targetLabel?: string;
}): string | undefined {
  const resourcePath = normalizePathValue(input.item?.resourcePath ?? "");
  if (input.item?.resourceKind === "directory" && resourcePath && !resourcePath.includes("/")) {
    return resourcePath;
  }

  const yamlPath = input.topologyRef?.yamlPath?.trim() ?? "";
  if (yamlPath) {
    const normalizedYamlPath = yamlPath.replace(/\\/g, "/");
    const pathSegments = normalizedYamlPath.split("/").filter(Boolean);
    const clabIndex = pathSegments.lastIndexOf(".clab");
    if (clabIndex >= 0 && pathSegments[clabIndex + 1]) {
      return pathSegments[clabIndex + 1];
    }
    const relativeYamlPath = normalizePathValue(yamlPath);
    const relativeSegments = relativeYamlPath.split("/").filter(Boolean);
    if (relativeSegments.length > 1) {
      return relativeSegments[0];
    }
  }

  const labName = input.topologyRef?.labName || input.item?.labName || input.targetLabel;
  return labName ? stripTopologySuffix(labName).trim() : undefined;
}

function extractFirstHttpLink(value: string): string | undefined {
  const match = value.match(/https?:\/\/[^\s"'<>]+/i);
  const link = match?.[0]?.trim();
  return link && link.length > 0 ? link : undefined;
}

function describeBrowserPort(port: number): string {
  const descriptions: Record<number, string> = {
    22: "SSH",
    23: "Telnet",
    25: "SMTP",
    53: "DNS",
    80: "HTTP",
    443: "HTTPS",
    1880: "Node-RED",
    3000: "Grafana",
    5432: "PostgreSQL",
    5601: "Kibana",
    8080: "Web Server",
    8443: "HTTPS (Alt)",
    9000: "Web Server",
    9090: "Prometheus",
    9200: "Elasticsearch",
  };
  return descriptions[port] ?? "";
}

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
): boolean {
  if (showNonOwnedLabs) {
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

function fileParentPath(pathValue: string): string {
  const normalized = normalizePathValue(pathValue);
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function joinWorkspacePath(parentPath: string, childPath: string): string {
  const parent = normalizePathValue(parentPath);
  const child = normalizePathValue(childPath);
  return parent ? `${parent}/${child}` : child;
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
  const isTopology = !isDirectory && isTopologyExplorerEntry(entry);
  const description = isDirectory ? undefined : entry.labName;
  let contextValue = "containerlabFile";
  if (isDirectory) {
    contextValue = "containerlabFileFolder";
  } else if (isTopology) {
    contextValue = "containerlabFileTopology";
  }
  return {
    id: `file:${entry.endpointId}:${entry.path || "."}`,
    label: entry.name || safeFilename(entry.path),
    description,
    tooltip: `~/.clab/${entry.path}`,
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
  const unhandledCommands = new Set<string>();
  const sshxLinksByLab = new Map<string, string>();
  const gottyLinksByLab = new Map<string, string>();
  const endpointHealthCache = new Map<string, EndpointHealthCacheEntry>();
  const fileExplorerCache = new Map<string, FileExplorerEntry[]>();
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
      if (!shouldShowRunningLab(lab, endpointsById)) {
        continue;
      }

      const endpointFiles = filesByEndpoint.get(lab.endpointId) ?? [];
      const endpointUsername = endpointsById.get(lab.endpointId)?.username;
      const topologyEntry = isNonOwnedLabForEndpoint(lab, endpointUsername)
        ? undefined
        : findTopologyEntryForRunningLab(lab, endpointFiles);
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
        .filter((file) => !isTopologyRunning(file.topologyRef, runningLabs))
        .map((file) => {
          const labName = topologyEntryLabName(file);
          const item: ExplorerTreeItem = {
            id: `local-lab:${file.endpointId}:${file.path}`,
            label: file.filename || safeFilename(file.path),
            description: file.path,
            tooltip: file.path,
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

  function buildFileExplorerProvider(
    filterText: string,
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
              tooltip: `${endpoint.label} (${endpoint.url}): ~/.clab`,
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

  function transformSnapshotForEndpointRoots(
    message: ExplorerSnapshotMessage,
  ): ExplorerSnapshotMessage {
    const runningSection = message.sections.find(
      (section) => section.id === "runningLabs",
    );
    const localSection = message.sections.find(
      (section) => section.id === "localLabs",
    );
    if (!runningSection) {
      return message;
    }

    return {
      ...message,
      sections: message.sections
        .filter((section) => section.id !== "localLabs")
        .map((section) => {
          if (section.id !== "runningLabs") {
            return section;
          }
          return {
            ...section,
            label: "Endpoints",
            count: options.getEndpoints().length,
            appearance: "bareTree",
            toolbarActions: dedupeExplorerActions([
              ...section.toolbarActions,
              ...(localSection?.toolbarActions ?? []),
            ]),
          };
        }),
    };
  }

  async function buildExplorerProviders(
    filterText: string = explorerFilterText,
  ): Promise<ExplorerSnapshotProviders> {
    const files = await options.listTopologyFiles();
    const runningItems = buildEndpointGroupedItems(filterText, files);
    const localItems: ExplorerTreeItem[] = [];
    const helpItems = buildHelpItems();

    const providers: StandaloneExplorerSnapshotProviders = {
      runningProvider: new SimpleExplorerProvider(
        runningItems,
      ) as ExplorerSnapshotProviders["runningProvider"],
      localProvider: new SimpleExplorerProvider(
        localItems,
      ) as ExplorerSnapshotProviders["localProvider"],
      fileProvider: buildFileExplorerProvider(filterText),
      helpProvider: new SimpleExplorerProvider(
        helpItems,
      ) as ExplorerSnapshotProviders["helpProvider"],
    };
    return providers;
  }

  async function executeExplorerCommand(
    commandId: string,
    args: unknown[],
  ): Promise<void> {
    const requestedTopologyRef = firstArgAsTopologyRef(args);
    const item = firstArgAsTreeItem(args);
    const actionTopologyRef =
      requestedTopologyRef ?? (await options.resolveTopologyRef(args));
    const actionEndpointId = resolveExplorerActionEndpointId(
      item,
      actionTopologyRef,
    );
    const endpoints = options.getEndpoints();
    const resolveEndpointForAction = async (
      actionDescription: string,
      preferredEndpointId?: string,
    ): Promise<string | null> =>
      resolveEndpointForExplorerAction({
        actionDescription,
        endpoints,
        postError: postExplorerError,
        preferredEndpointId,
      });
    const targetLabel = resolveExplorerTargetLabel(item, actionTopologyRef);
    const resolveActionTopologyRef = (): TopologyRef | undefined =>
      resolveExplorerActionTopologyRef({
        actionEndpointId,
        actionTopologyRef,
        item,
        labs: options.getLabs(),
        targetLabel,
      });
    const resolveCaptureTargets = (): Array<{
      containerName: string;
      interfaceName: string;
    }> => {
      const byKey = new Map<
        string,
        { containerName: string; interfaceName: string }
      >();

      const pushCandidate = (candidate: unknown): void => {
        if (!candidate || typeof candidate !== "object") {
          return;
        }
        const containerName =
          typeof (candidate as { containerName?: unknown }).containerName ===
          "string"
            ? (candidate as { containerName: string }).containerName.trim()
            : "";
        const interfaceName =
          typeof (candidate as { name?: unknown }).name === "string"
            ? (candidate as { name: string }).name.trim()
            : "";
        if (!containerName || !interfaceName) {
          return;
        }
        byKey.set(`${containerName}::${interfaceName}`, {
          containerName,
          interfaceName,
        });
      };

      for (const candidate of args) {
        if (Array.isArray(candidate)) {
          for (const nested of candidate) {
            pushCandidate(nested);
          }
          continue;
        }
        pushCandidate(candidate);
      }

      if (byKey.size === 0 && item) {
        pushCandidate(item);
      }

      return [...byKey.values()];
    };

    const runPacketflixCapture = async (): Promise<void> => {
      if (!actionTopologyRef) {
        postExplorerError(
          "No canonical topology reference is available for this item.",
        );
        return;
      }
      const targets = resolveCaptureTargets();
      if (targets.length === 0) {
        postExplorerError("Capture requires a running interface item.");
        return;
      }

      try {
        const captureResponse = await buildPacketflixCapture({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          targets,
          remoteHostname: getSessionHostnameOverride(actionEndpointId),
        });

        const captures = captureResponse.captures ?? [];
        if (captures.length === 0) {
          runtimeUiActions.notify(
            "No packet capture targets were returned.",
            "warning",
          );
          return;
        }

        for (const capture of captures) {
          const link = capture.packetflixUri?.trim();
          if (!link) {
            continue;
          }
          window.open(link, "_blank", "noopener,noreferrer");
        }

        runtimeUiActions.notify(
          captures.length > 1
            ? `Started ${captures.length} Edgeshark capture targets.`
            : `Started Edgeshark capture for ${captures[0]?.containerName ?? "interface"}.`,
          "success",
        );
      } catch (error) {
        runtimeUiActions.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    };

    const runWiresharkVncCapture = async (): Promise<void> => {
      if (!actionTopologyRef) {
        postExplorerError(
          "No canonical topology reference is available for this item.",
        );
        return;
      }
      const targets = resolveCaptureTargets();
      if (targets.length === 0) {
        postExplorerError("Capture requires a running interface item.");
        return;
      }

      try {
        const theme = resolveStandaloneTheme();

        const sessionsResponse = await createWiresharkVncSessions({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          targets,
          theme,
        });

        const sessions = sessionsResponse.sessions ?? [];
        if (sessions.length === 0) {
          runtimeUiActions.notify(
            "No Wireshark sessions were created.",
            "warning",
          );
          return;
        }

        for (const session of sessions) {
          const params = new URLSearchParams({
            sessionId: session.sessionId,
            theme,
          });
          if (actionEndpointId) {
            params.set("endpointId", actionEndpointId);
          }
          if (session.showVolumeTip) {
            params.set("showVolumeTip", "1");
          }
          const capturePageUrl = `${publicAssetUrl("wireshark.html")}?${params.toString()}`;
          window.open(capturePageUrl, "_blank", "noopener,noreferrer");
        }

        runtimeUiActions.notify(
          sessions.length > 1
            ? `Opened ${sessions.length} Wireshark VNC sessions.`
            : "Opened Wireshark VNC session.",
          "success",
        );
      } catch (error) {
        runtimeUiActions.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    };

    const runPreferredCapture = async (): Promise<void> => {
      const preferredAction =
        loadCapturePreferences(actionEndpointId).preferredAction;
      if (preferredAction === "edgeshark") {
        await runPacketflixCapture();
        return;
      }
      await runWiresharkVncCapture();
    };

    const cloneFromUrlFlow = async (
      endpointId: string,
      sourceUrl: string,
      cloneOptions?: {
        labNameOverride?: string;
        skipLabNamePrompt?: boolean;
        target?: CloneRepoDialogTarget;
      },
    ): Promise<void> => {
      const topologySourceUrl = sourceUrl.trim();
      if (!topologySourceUrl) {
        runtimeUiActions.notify(
          "A repository or topology URL is required.",
          "error",
        );
        return;
      }
      const target = cloneOptions?.target ?? "deploy";

      let labNameOverride: string | undefined;
      if (cloneOptions?.skipLabNamePrompt) {
        labNameOverride = cloneOptions.labNameOverride?.trim() || undefined;
      } else {
        const rawLabNameOverride = await promptForTextInput({
          title: "Lab Name Override",
          message: "Leave empty to use the default lab name.",
          label: "Lab name override",
          confirmLabel: "Continue",
          allowEmpty: true,
        });
        if (rawLabNameOverride === undefined) {
          return;
        }
        labNameOverride = rawLabNameOverride.trim() || undefined;
      }

      try {
        if (target === "undeployed") {
          const response = await importTopologyFromUrl({
            endpointId,
            topologySourceUrl,
            labNameOverride,
          });
          options.invalidateTopologyFileListCache(endpointId);
          controller.scheduleSnapshot(0);
          runtimeUiActions.notify(
            `Cloned ${response.labName} to undeployed labs.`,
            "success",
          );
          await options.loadTopologyFile(response.topologyRef, {
            deploymentState: "undeployed",
            endpointId,
          });
          return;
        }

        const response = await deployLabFromUrl({
          endpointId,
          topologySourceUrl,
          labNameOverride,
        });
        options.invalidateTopologyFileListCache(endpointId);
        controller.scheduleSnapshot(0);
        const labNames = response.labNames ?? [];
        runtimeUiActions.notify(
          labNames.length > 0
            ? `Deployed ${labNames.join(", ")} from source URL.`
            : "Deployment from source URL finished successfully.",
          "success",
        );
      } catch (error) {
        runtimeUiActions.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    };

    const openSshToAllNodes = (): void => {
      const lab = findLabStateForTopology(
        {
          yamlPath: actionTopologyRef?.yamlPath ?? "",
          topologyId: actionTopologyRef?.topologyId,
          labName: actionTopologyRef?.labName ?? item?.labName,
          endpointId: actionEndpointId,
        },
        options.getLabs(),
      );
      if (!lab) {
        postExplorerError(
          "No running lab context is available for this action.",
        );
        return;
      }

      const topologyRef = topologyRefForNodeActions(lab, actionTopologyRef);
      const containers = sortedRunningContainers(lab);
      if (containers.length === 0) {
        runtimeUiActions.notify(
          `No containers were found in lab "${lab.name}".`,
          "warning",
        );
        return;
      }

      for (const container of containers) {
        const nodeName = container.nodeName || container.name;
        runtimeUiActions.openTerminal({
          endpointId: lab.endpointId,
          topologyRef,
          nodeName,
          protocol: "ssh",
          title: `SSH: ${nodeName}`,
        });
      }
      runtimeUiActions.notify(sshOpenedNotification(containers), "success");
    };

    const shareLabKey = actionTopologyRef?.labName ?? item?.labName ?? "";
    const resolveShareLabKey = (): string => {
      const topologyRef = resolveActionTopologyRef();
      return topologyRef?.labName ?? shareLabKey;
    };

    const openCommandOutputTerminal = (
      title: string,
      commandLabel: string,
      output: string,
      topologyRef?: TopologyRef,
    ): void => {
      const content = output.trim();
      runtimeUiActions.openTerminal({
        endpointId: actionEndpointId,
        sessionId: `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        topologyRef,
        nodeName: commandLabel,
        protocol: "output",
        title,
        initialOutput: content || "(no output)",
      });
    };

    const resolveBrowserHost = (rawHost?: string): string => {
      const trimmed = (rawHost ?? "").trim().replace(/^\[|\]$/g, "");
      const lowered = trimmed.toLowerCase();
      if (
        trimmed &&
        lowered !== "localhost" &&
        lowered !== "127.0.0.1" &&
        lowered !== "::1" &&
        lowered !== "0.0.0.0" &&
        lowered !== "::"
      ) {
        return trimmed;
      }

      const endpoint = findEndpointConfig(endpoints, actionEndpointId);
      if (endpoint) {
        try {
          return new URL(endpoint.url).hostname;
        } catch {
          // Ignore malformed endpoint URLs.
        }
      }

      return trimmed || "localhost";
    };

    const runNodeLifecycle = async (
      action: "start" | "stop" | "restart" | "pause" | "unpause",
      successLabel: string,
    ): Promise<void> => {
      if (!actionTopologyRef || !item?.name) {
        postExplorerError("Node action requires a running lab item.");
        return;
      }

      try {
        await controlNodeLifecycle({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          nodeName: item.name,
          action,
        });
        runtimeUiActions.notify(successLabel, "success");
      } catch (error) {
        runtimeUiActions.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    };

    const openNodeBrowser = async (): Promise<void> => {
      if (!actionTopologyRef || !item?.name) {
        postExplorerError("Open Browser requires a running node item.");
        return;
      }

      try {
        const payload = await fetchNodeBrowserPorts({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          nodeName: item.name,
        });
        const ports = payload.ports ?? [];
        if (ports.length === 0) {
          runtimeUiActions.notify(
            `No exposed ports were found for ${item.name}.`,
            "warning",
          );
          return;
        }

        const candidates = ports.map((port) => {
          const host = resolveBrowserHost(port.hostIp);
          const hostForUrl = host.includes(":") ? `[${host}]` : host;
          const description =
            port.description || describeBrowserPort(port.containerPort);
          return {
            ...port,
            description,
            url: `http://${hostForUrl}:${port.hostPort}`,
          };
        });

        if (candidates.length === 1) {
          window.open(candidates[0].url, "_blank", "noopener,noreferrer");
          runtimeUiActions.notify(`Opened ${candidates[0].url}.`, "success");
          return;
        }

        const selectedUrl = await promptForOptionSelection({
          title: "Open Browser Port",
          message: "Select a port to open in the browser.",
          label: "Port",
          confirmLabel: "Open",
          options: candidates.map((candidate) => ({
            label: `${candidate.hostPort}:${candidate.containerPort}/${candidate.protocol || "tcp"}`,
            description: candidate.description,
            value: candidate.url,
          })),
          preferredValue: candidates[0]?.url,
        });
        if (!selectedUrl) {
          return;
        }

        const target = candidates.find((candidate) => candidate.url === selectedUrl);
        if (!target) {
          runtimeUiActions.notify("Invalid port selection.", "error");
          return;
        }
        window.open(target.url, "_blank", "noopener,noreferrer");
        runtimeUiActions.notify(`Opened ${target.url}.`, "success");
      } catch (error) {
        runtimeUiActions.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    };

    const runShareAction = async (
      kind: ShareActionKind,
      action: ShareLifecycleAction,
    ): Promise<void> => {
      const topologyRef = resolveActionTopologyRef();
      if (!topologyRef) {
        postExplorerError("Sharing actions require a running lab item.");
        return;
      }

      try {
        runtimeUiActions.notify(
          `${kind.toUpperCase()} ${action} started. This may take a moment...`,
          "info",
        );

        const payload = await runLabShareAction({
          action,
          endpointId: actionEndpointId,
          kind,
          topologyRef,
        });
        const link =
          payload.link?.trim() ||
          extractFirstHttpLink(payload.output ?? "") ||
          "";
        const labKey = normalizeLabName(
          topologyRef.labName || resolveShareLabKey(),
        );
        const bucket = kind === "sshx" ? sshxLinksByLab : gottyLinksByLab;
        persistShareLink({ action, bucket, labKey, link });
        controller.scheduleSnapshot(0);

        await handleShareActionLink(kind, action, link);
        runtimeUiActions.notify(
          payload.message || `${kind.toUpperCase()} ${action} completed.`,
          "success",
        );
      } catch (error) {
        runtimeUiActions.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    };

    const copyShareLink = async (kind: "sshx" | "gotty"): Promise<void> => {
      const argLink = typeof args[0] === "string" ? args[0].trim() : "";
      const bucket = kind === "sshx" ? sshxLinksByLab : gottyLinksByLab;
      const storedLabKey = normalizeLabName(resolveShareLabKey());
      const storedLink = storedLabKey ? (bucket.get(storedLabKey) ?? "") : "";
      const link = argLink || storedLink;
      if (!link) {
        runtimeUiActions.notify(
          `No ${kind.toUpperCase()} link is currently available for this lab.`,
          "warning",
        );
        return;
      }

      await navigator.clipboard.writeText(link).catch(() => {});
      runtimeUiActions.notify(
        `${kind.toUpperCase()} link copied to clipboard.`,
        "success",
      );
    };

    const runFcli = async (command: string): Promise<void> => {
      const topologyRef = resolveActionTopologyRef();
      if (!topologyRef) {
        postExplorerError("fcli actions require a running lab item.");
        return;
      }

      try {
        runtimeUiActions.notify(
          `Running fcli "${command}"... image pull may take a while.`,
          "info",
        );
        const response = await runFcliCommand({
          endpointId: actionEndpointId,
          topologyRef,
          command,
        });
        const content = response.output?.trim() || "(no output)";
        openCommandOutputTerminal(
          `fcli: ${command}`,
          `fcli ${command}`,
          content,
          topologyRef,
        );
        if (/\bNo data\.\.\./i.test(content)) {
          runtimeUiActions.notify(
            `fcli "${command}" returned no data. Check lab state/filter and try a different command (for example sys-info).`,
            "warning",
          );
        } else {
          runtimeUiActions.notify(
            `fcli "${command}" finished. Output opened in terminal.`,
            "success",
          );
        }
      } catch (error) {
        runtimeUiActions.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    };

    const runDrawio = async (
      layout: "horizontal" | "vertical" | "interactive",
    ): Promise<void> => {
      const topologyRef = resolveActionTopologyRef();
      if (!topologyRef) {
        postExplorerError("Graph actions require a lab item.");
        return;
      }

      try {
        runtimeUiActions.notify(`Generating draw.io (${layout})...`, "info");
        const response = await generateDrawioGraph({
          endpointId: actionEndpointId,
          topologyRef,
          layout,
        });

        triggerTextDownload(
          safeFilename(response.fileName || `${topologyRef.labName}.drawio`),
          response.content,
          "application/xml",
        );

        if (layout === "interactive") {
          const output = [response.output?.trim(), response.message?.trim()]
            .filter((value): value is string =>
              Boolean(value && value.length > 0),
            )
            .join("\n\n");
          openCommandOutputTerminal(
            `draw.io interactive: ${topologyRef.labName}`,
            "graph drawio -I",
            output || "Interactive draw.io output is unavailable.",
            topologyRef,
          );
        }

        runtimeUiActions.notify(
          response.message ||
            `Generated draw.io (${layout}) for ${topologyRef.labName}.`,
          "success",
        );
      } catch (error) {
        runtimeUiActions.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    };

    const requireTopologyRef = (
      message = "No canonical topology reference is available for this item.",
    ): TopologyRef | undefined => {
      if (!actionTopologyRef) {
        postExplorerError(message);
        return undefined;
      }
      return actionTopologyRef;
    };

    const runEndpointEdgeSharkAction = async (
      action: "install" | "uninstall",
    ): Promise<void> => {
      const endpointId = await resolveEndpointForAction(
        `${action} EdgeShark`,
        actionEndpointId,
      );
      if (!endpointId) {
        return;
      }
      if (
        action === "uninstall" &&
        !(await confirmRuntimeAction({
          title: "Uninstall EdgeShark",
          message: "Uninstall EdgeShark on this endpoint?",
          confirmLabel: "Uninstall",
          severity: "warning",
        }))
      ) {
        return;
      }
      try {
        await (action === "install"
          ? installEdgeShark(endpointId)
          : uninstallEdgeShark(endpointId));
        runtimeUiActions.notify(
          `${action === "install" ? "Installed" : "Uninstalled"} EdgeShark.`,
          "success",
        );
      } catch (error) {
        runtimeUiActions.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    };

    const openTopologyFile = async (): Promise<void> => {
      const topologyRef = requireTopologyRef(
        targetLabel
          ? `No canonical topology reference is available for running lab "${targetLabel}".`
          : "No canonical topology reference is available for this item.",
      );
      if (!topologyRef) {
        return;
      }
      const itemState = deploymentStateFromContext(item?.contextValue);
      const resolvedState = await options.resolveDeploymentState(topologyRef);
      await options.loadTopologyFile(topologyRef, {
        deploymentState: resolvedState ?? itemState,
        endpointId: actionEndpointId,
      });
    };

    const createTopologyFileFlow = async (): Promise<void> => {
      const connectedEndpoints = endpoints.filter(
        (endpoint) => endpoint.status === "connected",
      );
      if (connectedEndpoints.length === 0) {
        postExplorerError(
          "Connect an endpoint before trying to create a topology file.",
        );
        return;
      }
      const preferredEndpoint = findEndpointConfig(endpoints, actionEndpointId);
      const createTopologyInput = await promptForCreateTopology({
        title: "Create Topology File",
        message: "Choose endpoint and file name for the new topology file.",
        confirmLabel: "Create",
        endpointOptions: connectedEndpoints.map((endpoint) => ({
          value: endpoint.id,
          label: endpoint.label,
          description: endpoint.url,
        })),
        defaultEndpointId:
          preferredEndpoint?.status === "connected"
            ? preferredEndpoint.id
            : connectedEndpoints[0]?.id,
        defaultFileName: "new-lab.clab.yml",
      });
      if (!createTopologyInput) {
        return;
      }
      try {
        const created = await createTopologyFile({
          endpointId: createTopologyInput.endpointId,
          fileName: createTopologyInput.fileName,
        });
        options.invalidateTopologyFileListCache(createTopologyInput.endpointId);
        controller.scheduleSnapshot(0);
        runtimeUiActions.notify(
          `Created topology file "${createTopologyInput.fileName}".`,
          "success",
        );
        await options.loadTopologyFile(created.topologyRef, {
          deploymentState: "undeployed",
          endpointId: createTopologyInput.endpointId,
        });
      } catch (error) {
        runtimeUiActions.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    };

    const cloneRepositoryFlow = async (): Promise<void> => {
      const connectedEndpoints = endpoints.filter(
        (endpoint) => endpoint.status === "connected",
      );
      if (connectedEndpoints.length === 0) {
        postExplorerError(
          "Connect an endpoint before trying to clone a repository.",
        );
        return;
      }
      const preferredEndpoint = findEndpointConfig(endpoints, actionEndpointId);
      const popularRepos = (await fetchPopularRepos()).slice(0, 12);
      const cloneRepoInput = await promptForCloneRepo({
        title: "Clone Repository",
        message: "Choose endpoint, source, and target action.",
        confirmLabel: "Continue",
        endpointOptions: connectedEndpoints.map((endpoint) => ({
          value: endpoint.id,
          label: endpoint.label,
          description: endpoint.url,
        })),
        popularOptions: popularRepos.map((repo) => ({
          value: repo.htmlUrl,
          label: `${repo.name} (⭐ ${repo.stars})`,
          description: repo.description,
        })),
        defaultEndpointId:
          preferredEndpoint?.status === "connected"
            ? preferredEndpoint.id
            : connectedEndpoints[0]?.id,
        defaultMode: "url",
        defaultSourceUrl: "https://github.com/srl-labs/srl-telemetry-lab",
        defaultTarget: lifecycleActionsAvailable ? "deploy" : "undeployed",
      });
      if (cloneRepoInput) {
        await cloneFromUrlFlow(
          cloneRepoInput.endpointId,
          cloneRepoInput.sourceUrl,
          {
            labNameOverride: cloneRepoInput.labNameOverride,
            skipLabNamePrompt: true,
            target: cloneRepoInput.target,
          },
        );
      }
    };

    const clonePopularFlow = async (
      target: CloneRepoDialogTarget,
    ): Promise<void> => {
      const endpointId = await resolveEndpointForAction(
        target === "undeployed"
          ? "clone a popular lab"
          : "deploy a popular lab",
        actionEndpointId,
      );
      const sourceUrl = endpointId
        ? await pickPopularRepo(
            target === "undeployed"
              ? "Clone popular lab"
              : "Deploy popular lab",
          )
        : undefined;
      if (endpointId && sourceUrl) {
        await cloneFromUrlFlow(endpointId, sourceUrl, { target });
      }
    };

    const runLabLifecycle = async (
      endpoint: LifecycleCommandEndpoint,
      cleanup = false,
    ): Promise<void> => {
      if (!lifecycleActionsAvailable) {
        runtimeUiActions.notify(
          "Deploy and lifecycle actions are not available in GitHub Pages mode.",
          "warning",
        );
        return;
      }
      const topologyRef = requireTopologyRef();
      if (!topologyRef) {
        return;
      }
      try {
        await options.runLifecycle(endpoint, topologyRef, cleanup);
      } catch (error) {
        console.error(`[Standalone] ${endpoint} failed:`, error);
      }
    };

    const deleteTopologyFlow = async (): Promise<void> => {
      const topologyRef = requireTopologyRef();
      if (!topologyRef) {
        return;
      }
      const deleted = await deleteTopologyFileFlow({
        endpointId: actionEndpointId,
        topologyRef,
      });
      if (deleted) {
        options.invalidateTopologyFileListCache(actionEndpointId);
        controller.scheduleSnapshot(0);
      }
    };

    const toggleFavoriteFlow = (): void => {
      const topologyRef = requireTopologyRef();
      if (!topologyRef) {
        return;
      }
      const nextFavorite = toggleStandaloneFavorite({
        endpointId: actionEndpointId,
        topologyRef,
      });
      controller.scheduleSnapshot(0);
      runtimeUiActions.notify(
        nextFavorite
          ? "Added lab to favorites."
          : "Removed lab from favorites.",
        "success",
      );
    };

    const openNodeAccessTerminal = (): void => {
      if (!actionTopologyRef || !item?.name) {
        postExplorerError("Node access requires a running lab item.");
        return;
      }
      const protocol = nodeAccessProtocol(commandId);
      runtimeUiActions.openTerminal({
        endpointId: actionEndpointId,
        topologyRef: actionTopologyRef,
        nodeName: item.name,
        protocol,
        title: `${nodeAccessTitlePrefix(protocol)}: ${item.label || item.name}`,
      });
    };

    const openInterfaceImpairments = (): void => {
      if (!actionTopologyRef || !item?.containerName) {
        postExplorerError(
          "Interface impairments require a running interface item.",
        );
        return;
      }
      const fieldByCommand: Record<string, keyof NetemFields> = {
        "containerlab.interface.setDelay": "delay",
        "containerlab.interface.setJitter": "jitter",
        "containerlab.interface.setLoss": "loss",
        "containerlab.interface.setRate": "rate",
        "containerlab.interface.setCorruption": "corruption",
      };
      runtimeUiActions.openNetem({
        endpointId: actionEndpointId,
        topologyRef: actionTopologyRef,
        nodeName: item.containerName,
        preferredField: fieldByCommand[commandId],
        preferredInterfaceName: item.label || item.name,
        title: `Impairments: ${item.containerName}`,
      });
    };

    const setSessionHostnameFlow = async (): Promise<void> => {
      const actionEndpointLabel =
        findEndpointConfig(endpoints, actionEndpointId)?.label ??
        actionEndpointId ??
        "default";
      const currentHostname =
        getSessionHostnameOverride(actionEndpointId) ?? "";
      const rawValue = await promptForTextInput({
        title: "Session Hostname Override",
        message: `Set the session hostname override for packet capture on "${actionEndpointLabel}". Leave empty to clear it.`,
        label: "Hostname override",
        defaultValue: currentHostname,
        confirmLabel: "Save",
        allowEmpty: true,
      });
      if (rawValue === undefined) {
        return;
      }
      const nextValue = setSessionHostnameOverride(rawValue, actionEndpointId);
      runtimeUiActions.notify(
        nextValue
          ? `Session hostname override for "${actionEndpointLabel}" set to "${nextValue}".`
          : `Session hostname override for "${actionEndpointLabel}" cleared.`,
        "success",
      );
    };

    const copyText = async (value: string | undefined): Promise<void> => {
      if (value) {
        await navigator.clipboard.writeText(value).catch(() => {});
      }
    };

    const requireFileEndpointId = (): string | undefined => {
      const endpointId = item?.endpointId ?? actionEndpointId;
      if (!endpointId) {
        postExplorerError("No endpoint is associated with this file item.");
        return undefined;
      }
      return endpointId;
    };

    const requireFilePath = (): string | undefined => {
      const pathValue = item?.resourcePath;
      if (typeof pathValue !== "string" || pathValue.trim().length === 0) {
        postExplorerError("No file path is associated with this item.");
        return undefined;
      }
      return pathValue;
    };

    const selectedDirectoryPath = (): string => {
      if (item?.resourceKind === "directory") {
        return item.resourcePath ?? "";
      }
      return fileParentPath(item?.resourcePath ?? "");
    };

    const promptWorkspacePath = async (
      title: string,
      defaultPath: string,
    ): Promise<string | undefined> => {
      const rawValue = await promptForTextInput({
        title,
        message: "Enter a path under ~/.clab.",
        label: "Path",
        defaultValue: defaultPath,
        confirmLabel: title.startsWith("Rename") ? "Rename" : "Create",
      });
      if (rawValue === undefined) {
        return undefined;
      }
      const normalized = normalizePathValue(rawValue);
      return normalized.length > 0 ? normalized : undefined;
    };

    const openFileEditor = async (): Promise<void> => {
      const endpointId = requireFileEndpointId();
      const pathValue = requireFilePath();
      if (!endpointId || !pathValue) {
        return;
      }
      const document = await readFileExplorerFile(endpointId, pathValue);
      await options.openFileEditor({
        ...document,
        title: safeFilename(pathValue),
      });
    };

    const createWorkspaceFile = async (): Promise<void> => {
      const endpointId = requireFileEndpointId();
      if (!endpointId) {
        return;
      }
      const parentPath = selectedDirectoryPath();
      const pathValue = await promptWorkspacePath(
        "New file path",
        joinWorkspacePath(parentPath, "untitled.txt"),
      );
      if (!pathValue) {
        return;
      }
      await writeFileExplorerFile({ endpointId, path: pathValue, content: "" });
      clearFileExplorerCache(endpointId);
      await options.openFileEditor({
        endpointId,
        path: pathValue,
        content: "",
        title: safeFilename(pathValue),
      });
      runtimeUiActions.notify(`Created ${pathValue}`, "success");
      controller.scheduleSnapshot(0);
    };

    const createWorkspaceFolder = async (): Promise<void> => {
      const endpointId = requireFileEndpointId();
      if (!endpointId) {
        return;
      }
      const parentPath = selectedDirectoryPath();
      const pathValue = await promptWorkspacePath(
        "New folder path",
        joinWorkspacePath(parentPath, "new-folder"),
      );
      if (!pathValue) {
        return;
      }
      await createFileExplorerDirectory(endpointId, pathValue);
      clearFileExplorerCache(endpointId);
      runtimeUiActions.notify(`Created ${pathValue}`, "success");
      controller.scheduleSnapshot(0);
    };

    const renameWorkspaceItem = async (): Promise<void> => {
      const endpointId = requireFileEndpointId();
      const oldPath = requireFilePath();
      if (!endpointId || !oldPath) {
        return;
      }
      const newPath = await promptWorkspacePath("Rename path", oldPath);
      if (!newPath || newPath === oldPath) {
        return;
      }
      await renameFileExplorerPath({ endpointId, oldPath, newPath });
      clearFileExplorerCache(endpointId);
      runtimeUiActions.notify(`Renamed ${oldPath} to ${newPath}`, "success");
      controller.scheduleSnapshot(0);
    };

    const deleteWorkspaceItem = async (): Promise<void> => {
      const endpointId = requireFileEndpointId();
      const pathValue = requireFilePath();
      if (!endpointId || !pathValue) {
        return;
      }
      const isDirectory = item?.resourceKind === "directory";
      const kind = isDirectory ? "folder" : "file";
      const suffix = isDirectory ? " and everything inside it" : "";
      const confirmed = await confirmRuntimeAction({
        title: `Delete ${kind}`,
        message: `Delete ${kind} "~/.clab/${pathValue}"${suffix}?`,
        confirmLabel: "Delete",
        severity: "error",
      });
      if (!confirmed) {
        return;
      }
      await deleteFileExplorerPath(endpointId, pathValue, {
        recursive: isDirectory,
      });
      clearFileExplorerCache(endpointId);
      runtimeUiActions.notify(`Deleted ${pathValue}`, "success");
      controller.scheduleSnapshot(0);
    };

    const copyWorkspacePath = async (): Promise<void> => {
      const pathValue = requireFilePath();
      if (!pathValue) {
        return;
      }
      await copyText(`~/.clab/${pathValue}`);
      runtimeUiActions.notify(`Copied path for ${pathValue}.`, "success");
    };

    const downloadWorkspaceFile = async (): Promise<void> => {
      const endpointId = requireFileEndpointId();
      const pathValue = requireFilePath();
      if (!endpointId || !pathValue) {
        return;
      }
      const download = await downloadFileExplorerFile(endpointId, pathValue);
      triggerBlobDownload(download.filename, download.blob);
      runtimeUiActions.notify(`Downloaded ${pathValue}.`, "success");
    };

    const uploadWorkspaceFile = async (): Promise<void> => {
      const endpointId = requireFileEndpointId();
      if (!endpointId) {
        return;
      }
      const files = await pickTransferFiles("", item?.resourceKind !== "file");
      if (files.length === 0) {
        return;
      }
      if (item?.resourceKind === "file") {
        const file = files[0];
        const targetPath = item.resourcePath ?? "";
        if (!targetPath) {
          postExplorerError("No upload target path is available.");
          return;
        }
        const confirmed = await confirmRuntimeAction({
          title: "Replace File",
          message: `Replace "~/.clab/${targetPath}" with "${file.name}"?`,
          confirmLabel: "Replace",
          severity: "warning",
        });
        if (!confirmed) {
          return;
        }
        await uploadFileExplorerFile({ endpointId, file, path: targetPath, targetKind: "file" });
        clearFileExplorerCache(endpointId);
        runtimeUiActions.notify(`Uploaded ${targetPath}.`, "success");
        controller.scheduleSnapshot(0);
        return;
      }

      const directoryPath = selectedDirectoryPath();
      await uploadFileExplorerFile({
        endpointId,
        files,
        path: directoryPath,
        targetKind: "directory",
      });
      clearFileExplorerCache(endpointId);
      runtimeUiActions.notify(
        `Uploaded ${files.length} file${files.length === 1 ? "" : "s"} to ~/.clab${directoryPath ? `/${directoryPath}` : ""}.`,
        "success",
      );
      controller.scheduleSnapshot(0);
    };

    const downloadLabArchiveFlow = async (): Promise<void> => {
      const endpointId = await resolveEndpointForAction(
        "download a lab archive",
        actionEndpointId,
      );
      if (!endpointId) {
        return;
      }
      const labFolder = resolveArchiveLabFolder({
        item,
        topologyRef: resolveActionTopologyRef(),
        targetLabel,
      });
      if (!labFolder) {
        postExplorerError("Select a lab folder before downloading an archive.");
        return;
      }
      const format = await promptArchiveFormat();
      if (!format) {
        return;
      }
      const download = await downloadLabArchive({
        endpointId,
        format,
        path: labFolder,
      });
      triggerBlobDownload(download.filename, download.blob);
      runtimeUiActions.notify(`Downloaded archive for ${labFolder}.`, "success");
    };

    const commandHandlers: Record<string, () => Promise<void> | void> = {
      "containerlab.openLink": () => {
        const link = typeof args[0] === "string" ? args[0] : undefined;
        if (link) {
          window.open(link, "_blank", "noopener,noreferrer");
        }
      },
      "containerlab.endpoint.reconnect": () =>
        actionEndpointId
          ? dispatchEndpointUiAction({
              action: "reconnect",
              endpointId: actionEndpointId,
            })
          : postExplorerError("No endpoint is associated with this item."),
      "containerlab.endpoint.remove": () =>
        actionEndpointId
          ? dispatchEndpointUiAction({
              action: "remove",
              endpointId: actionEndpointId,
            })
          : postExplorerError("No endpoint is associated with this item."),
      "containerlab.endpoint.copyUrl": async () => {
        const endpoint = findEndpointConfig(endpoints, actionEndpointId);
        if (!actionEndpointId || !endpoint) {
          postExplorerError(
            actionEndpointId
              ? "Endpoint metadata is not available."
              : "No endpoint is associated with this item.",
          );
          return;
        }
        await navigator.clipboard.writeText(endpoint.url).catch(() => {});
        runtimeUiActions.notify(
          `Copied endpoint URL for ${endpoint.label}.`,
          "success",
        );
      },
      "containerlab.file.open": openFileEditor,
      "containerlab.file.openTopology": openFileEditor,
      "containerlab.file.newFile": createWorkspaceFile,
      "containerlab.file.newFolder": createWorkspaceFolder,
      "containerlab.file.rename": renameWorkspaceItem,
      "containerlab.file.delete": deleteWorkspaceItem,
      "containerlab.file.copyPath": copyWorkspacePath,
      "containerlab.file.download": downloadWorkspaceFile,
      "containerlab.file.upload": uploadWorkspaceFile,
      "containerlab.file.downloadArchive": downloadLabArchiveFlow,
      "containerlab.file.refresh": () => {
        clearFileExplorerCache(actionEndpointId);
        controller.scheduleSnapshot(0);
      },
      "containerlab.install.edgeshark": () =>
        runEndpointEdgeSharkAction("install"),
      "containerlab.uninstall.edgeshark": () =>
        runEndpointEdgeSharkAction("uninstall"),
      "containerlab.lab.graph.topoViewer": openTopologyFile,
      "containerlab.lab.openFile": openTopologyFile,
      "containerlab.editor.topoViewerEditor.open": openTopologyFile,
      "containerlab.lab.graph.drawio.horizontal": () => runDrawio("horizontal"),
      "containerlab.lab.graph.drawio.vertical": () => runDrawio("vertical"),
      "containerlab.lab.graph.drawio.interactive": () =>
        runDrawio("interactive"),
      "containerlab.editor.topoViewerEditor": createTopologyFileFlow,
      "containerlab.lab.cloneRepo": cloneRepositoryFlow,
      "containerlab.lab.clonePopularRepo": () => clonePopularFlow("undeployed"),
      "containerlab.lab.deployPopular": () =>
        lifecycleActionsAvailable
          ? clonePopularFlow("deploy")
          : runtimeUiActions.notify(
              "Deploy is not available in GitHub Pages mode.",
              "warning",
            ),
      "containerlab.images.manage": runtimeUiActions.openImageManager,
      "containerlab.inspectAll": runtimeUiActions.openInspectAll,
      "containerlab.inspectOneLab": () => {
        const topologyRef = requireTopologyRef();
        if (topologyRef) {
          runtimeUiActions.openInspectLab(
            { endpointId: actionEndpointId, topologyRef },
            `Inspect: ${targetLabel ?? topologyRef.labName}`,
          );
        }
      },
      "containerlab.lab.deploy": () => runLabLifecycle("deploy", false),
      "containerlab.lab.deploy.specificFile": () =>
        runLabLifecycle("deploy", false),
      "containerlab.lab.deploy.cleanup": async () => {
        const confirmed = await confirmRuntimeAction({
          title: "Deploy With Cleanup",
          message:
            "Deploy (cleanup) may remove existing lab artifacts before deployment. Continue?",
          confirmLabel: "Deploy",
          severity: "warning",
        });
        if (confirmed) {
          await runLabLifecycle("deploy", true);
        }
      },
      "containerlab.lab.destroy": () => runLabLifecycle("destroy", false),
      "containerlab.lab.destroy.cleanup": () =>
        runLabLifecycle("destroy", true),
      "containerlab.lab.redeploy": () => runLabLifecycle("redeploy", false),
      "containerlab.lab.redeploy.cleanup": () =>
        runLabLifecycle("redeploy", true),
      "containerlab.lab.start": () => runLabLifecycle("start"),
      "containerlab.lab.stop": () => runLabLifecycle("stop"),
      "containerlab.lab.restart": () => runLabLifecycle("restart"),
      "containerlab.lab.save": async () => {
        const topologyRef = requireTopologyRef();
        if (topologyRef) {
          await saveConfigsFlow(
            { endpointId: actionEndpointId, topologyRef },
            `Saved configs for ${topologyRef.labName}.`,
          );
        }
      },
      "containerlab.lab.delete": deleteTopologyFlow,
      "containerlab.lab.downloadArchive": downloadLabArchiveFlow,
      "containerlab.lab.toggleFavorite": toggleFavoriteFlow,
      "containerlab.lab.sshToAllNodes": openSshToAllNodes,
      "containerlab.lab.sshx.attach": () => runShareAction("sshx", "attach"),
      "containerlab.lab.sshx.detach": () => runShareAction("sshx", "detach"),
      "containerlab.lab.sshx.reattach": () =>
        runShareAction("sshx", "reattach"),
      "containerlab.lab.gotty.attach": () => runShareAction("gotty", "attach"),
      "containerlab.lab.gotty.detach": () => runShareAction("gotty", "detach"),
      "containerlab.lab.gotty.reattach": () =>
        runShareAction("gotty", "reattach"),
      "containerlab.lab.sshx.copyLink": () => copyShareLink("sshx"),
      "containerlab.lab.sshx.copylink": () => copyShareLink("sshx"),
      "containerlab.lab.gotty.copyLink": () => copyShareLink("gotty"),
      "containerlab.lab.gotty.copylink": () => copyShareLink("gotty"),
      "containerlab.lab.fcli.bgpPeers": () => runFcli("bgp-peers"),
      "containerlab.lab.fcli.bgpRib": () => runFcli("bgp-rib"),
      "containerlab.lab.fcli.ipv4Rib": () => runFcli("ipv4-rib"),
      "containerlab.lab.fcli.lldp": () => runFcli("lldp"),
      "containerlab.lab.fcli.mac": () => runFcli("mac"),
      "containerlab.lab.fcli.ni": () => runFcli("ni"),
      "containerlab.lab.fcli.subif": () => runFcli("subif"),
      "containerlab.lab.fcli.sysInfo": () => runFcli("sys-info"),
      "containerlab.lab.fcli.custom": async () => {
        const customCommand = await promptForTextInput({
          title: "Custom fcli Command",
          label: "fcli command",
          defaultValue: "bgp-peers",
          confirmLabel: "Run",
        });
        if (customCommand?.trim()) {
          await runFcli(customCommand.trim());
        }
      },
      "containerlab.capture.killAllWiresharkVNC": async () => {
        const endpointId = await resolveEndpointForAction(
          "close all Wireshark VNC sessions",
          actionEndpointId,
        );
        if (
          endpointId &&
          (await confirmRuntimeAction({
            title: "Close Wireshark VNC Sessions",
            message: "Close all active Wireshark VNC sessions for this endpoint?",
            confirmLabel: "Close Sessions",
            severity: "warning",
          }))
        ) {
          try {
            const response = await closeAllWiresharkVncSessions(endpointId);
            runtimeUiActions.notify(
              response.message || "Closed Wireshark VNC sessions.",
              "success",
            );
          } catch (error) {
            runtimeUiActions.notify(
              error instanceof Error ? error.message : String(error),
              "error",
            );
          }
        }
      },
      "containerlab.treeView.runningLabs.hideNonOwnedLabs": () => {
        showNonOwnedLabs = false;
        persistShowNonOwnedLabsSetting(false);
        controller.scheduleSnapshot(0);
      },
      "containerlab.treeView.runningLabs.showNonOwnedLabs": () => {
        showNonOwnedLabs = true;
        persistShowNonOwnedLabsSetting(true);
        controller.scheduleSnapshot(0);
      },
      "containerlab.node.save": async () => {
        if (!actionTopologyRef || !item?.name) {
          postExplorerError("Node save requires a running lab item.");
          return;
        }
        await saveConfigsFlow(
          {
            endpointId: actionEndpointId,
            topologyRef: actionTopologyRef,
            nodeName: item.name,
          },
          `Saved config for ${item.label || item.name}.`,
        );
      },
      "containerlab.node.start": () =>
        runNodeLifecycle(
          "start",
          `Started ${item?.label || item?.name || "node"}.`,
        ),
      "containerlab.node.stop": () =>
        runNodeLifecycle(
          "stop",
          `Stopped ${item?.label || item?.name || "node"}.`,
        ),
      "containerlab.node.restart": () =>
        runNodeLifecycle(
          "restart",
          `Restarted ${item?.label || item?.name || "node"}.`,
        ),
      "containerlab.node.pause": () =>
        runNodeLifecycle(
          "pause",
          `Paused ${item?.label || item?.name || "node"}.`,
        ),
      "containerlab.node.unpause": () =>
        runNodeLifecycle(
          "unpause",
          `Unpaused ${item?.label || item?.name || "node"}.`,
        ),
      "containerlab.node.openBrowser": openNodeBrowser,
      "containerlab.node.ssh": openNodeAccessTerminal,
      "containerlab.node.attachShell": openNodeAccessTerminal,
      "containerlab.node.telnet": openNodeAccessTerminal,
      "containerlab.node.showLogs": () => {
        if (!actionTopologyRef || !item?.name) {
          postExplorerError("Node logs require a running lab item.");
          return;
        }
        runtimeUiActions.openLogs({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          nodeName: item.name,
          title: `Logs: ${item.label || item.name}`,
        });
      },
      "containerlab.node.manageImpairments": () => {
        if (!actionTopologyRef || !item?.name) {
          postExplorerError("Impairments require a running lab item.");
          return;
        }
        runtimeUiActions.openNetem({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          nodeName: item.name,
          title: `Impairments: ${item.label || item.name}`,
        });
      },
      "containerlab.interface.setDelay": openInterfaceImpairments,
      "containerlab.interface.setJitter": openInterfaceImpairments,
      "containerlab.interface.setLoss": openInterfaceImpairments,
      "containerlab.interface.setRate": openInterfaceImpairments,
      "containerlab.interface.setCorruption": openInterfaceImpairments,
      "containerlab.interface.capture": runPreferredCapture,
      "containerlab.interface.captureWithEdgeshark": runPacketflixCapture,
      "containerlab.interface.captureWithEdgesharkVNC": runWiresharkVncCapture,
      "containerlab.set.sessionHostname": setSessionHostnameFlow,
      "containerlab.node.copyName": () => copyText(item?.name || item?.label),
      "containerlab.node.copyID": () => copyText(item?.cID),
      "containerlab.node.copyKind": () => copyText(item?.kind),
      "containerlab.node.copyImage": () => copyText(item?.image),
      "containerlab.node.copyIPv4Address": () => copyText(item?.v4Address),
      "containerlab.node.copyIPv6Address": () => copyText(item?.v6Address),
      "containerlab.interface.copyMACAddress": () => copyText(item?.mac),
      "containerlab.lab.copyPath": async () =>
        copyText(
          actionTopologyRef?.yamlPath ??
            (await options.resolveApiTopologyPath(args)),
        ),
    };

    const handler = commandHandlers[commandId];
    if (handler) {
      await handler();
      return;
    }

    if (!unhandledCommands.has(commandId)) {
      unhandledCommands.add(commandId);
      console.warn(`[Standalone] Command not implemented: ${commandId}`);
    }
  }

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
        hideNonOwnedLabs: !showNonOwnedLabs,
        isLocalCaptureAllowed: true,
        hiddenCommandIds,
        commandMetadata: STANDALONE_TRANSFER_COMMAND_METADATA,
        sectionOrder: [
          "runningLabs",
          "localLabs",
          "fileExplorer",
          "helpFeedback",
        ],
        expandedBySection: explorerUiState.expandedBySection,
      };
    },
    onFilterTextChanged(filterText) {
      explorerFilterText = filterText;
    },
    onUiStateChanged(state) {
      explorerUiState = state ?? {};
    },
    refreshOnUiStateChanged(previous, next) {
      const previousExpanded = previous.expandedBySection as
        | Partial<Record<string, string[]>>
        | undefined;
      const nextExpanded = next.expandedBySection as
        | Partial<Record<string, string[]>>
        | undefined;
      return !stringArraysEqual(
        previousExpanded?.fileExplorer,
        nextExpanded?.fileExplorer,
      );
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
        void controller.persistUiState(state);
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
