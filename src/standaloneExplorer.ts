import { createExplorerController } from "@srl-labs/clab-ui/host";
import type {
  ExplorerAction,
  ExplorerIncomingMessage,
  ExplorerSnapshotProviders,
  ExplorerUiState
} from "@srl-labs/clab-ui/explorer";
import type { TopologyRef } from "@srl-labs/clab-ui/session";

import { dispatchEndpointUiAction } from "./endpointActions";
import {
  buildPacketflixCapture,
  closeAllWiresharkVncSessions,
  controlNodeLifecycle,
  createTopologyFile,
  deployLabFromUrl,
  importTopologyFromUrl,
  fetchNodeBrowserPorts,
  generateDrawioGraph,
  installEdgeShark,
  runFcliCommand,
  runGottyShareAction,
  runSshxShareAction,
  createWiresharkVncSessions,
  uninstallEdgeShark,
  type NetemFields
} from "./runtimeApi";
import {
  deleteTopologyFileFlow,
  promptForCloneRepo,
  promptForCreateTopology,
  promptForEndpointSelection,
  saveConfigsFlow,
  type CloneRepoDialogTarget
} from "./components/RuntimeActionDialogs";
import type { EndpointConfig } from "./stores/endpointStore";
import type { LabState } from "./stores/labStore";
import { runtimeUiActions } from "./stores/runtimeUiStore";
import {
  getSessionHostnameOverride,
  loadCapturePreferences,
  setSessionHostnameOverride
} from "./runtimeCaptureSettings";
import type { LifecycleApiCallResult } from "./standaloneLifecycle";
import type {
  DeploymentState,
  ExplorerTreeItem,
  LifecycleCommandEndpoint,
  TopologyFileEntry
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
  isTopologyRunning,
  normalizeLabName,
  normalizePathValue,
  safeFilename,
  topologyPathsLikelyMatch,
  topologyEntryLabName
} from "./standaloneHostShared";
import { resolveStandaloneTheme } from "./standaloneTheme";
import {
  isStandaloneFavorite,
  toggleStandaloneFavorite
} from "./standaloneFavorites";

const SHOW_NON_OWNED_LABS_STORAGE_KEY = "clab-standalone-show-non-owned-labs";
const STANDALONE_HIDDEN_COMMAND_IDS = [
  "containerlab.lab.addToWorkspace",
  "containerlab.lab.openFolderInNewWindow"
] as const;

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

function disconnectedEndpointLabel(status: EndpointConfig["status"]): string {
  if (status === "saved") {
    return "Saved endpoint — reconnect to restore the session";
  }
  if (status === "session_expired") {
    return "Session expired — reconnect with your credentials";
  }
  return "Endpoint is offline — reconnect when it is reachable";
}

function deploymentStateFromContext(contextValue: string | undefined): DeploymentState | undefined {
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

type ExplorerSnapshotMessage = Extract<ExplorerIncomingMessage, { command: "snapshot" }>;

interface StandaloneExplorerBridgeOptions {
  debounceMs: number;
  getEndpoints: () => EndpointConfig[];
  getLabs: () => Map<string, LabState>;
  invalidateTopologyFileListCache: (endpointId?: string) => void;
  invokeLifecycleApi: (
    endpoint: LifecycleCommandEndpoint,
    topologyRef: TopologyRef,
    cleanup: boolean,
    options?: { sessionId?: string; signal?: AbortSignal }
  ) => Promise<LifecycleApiCallResult>;
  listTopologyFiles: () => Promise<TopologyFileEntry[]>;
  loadTopologyFile: (
    topologyRef: TopologyRef,
    options?: { deploymentState?: DeploymentState; endpointId?: string }
  ) => Promise<void>;
  removeEndpoint: (endpointId: string) => Promise<void>;
  resolveApiTopologyPath: (args: unknown[]) => Promise<string | undefined>;
  resolveDeploymentState: (topologyRef: TopologyRef) => Promise<DeploymentState | undefined>;
  resolveTopologyRef: (args: unknown[]) => Promise<TopologyRef | undefined>;
}

export interface StandaloneExplorerBridge {
  explorer: {
    connect: () => void;
    invokeAction: (actionRef: string) => Promise<void>;
    persistUiState: (state: ExplorerUiState) => void;
    setFilter: (filterText: string) => void;
    subscribe: (handler: (message: ExplorerIncomingMessage) => void) => () => void;
  };
  scheduleSnapshot: (delay?: number) => void;
}

const HELP_LINKS = [
  { label: "Containerlab Documentation", url: "https://containerlab.dev/" },
  { label: "VS Code Extension Documentation", url: "https://containerlab.dev/manual/vsc-extension/" },
  { label: "Browse Labs on GitHub (srl-labs)", url: "https://github.com/srl-labs/" },
  { label: "Join our Discord server", url: "https://discord.gg/vAyddtaEV9" }
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
    stars: 85
  },
  {
    name: "netbox-nrx-clab",
    htmlUrl: "https://github.com/srl-labs/netbox-nrx-clab",
    description: "NetBox NRX Containerlab integration for network automation use cases.",
    stars: 65
  },
  {
    name: "sros-anysec-macsec-lab",
    htmlUrl: "https://github.com/srl-labs/sros-anysec-macsec-lab",
    description: "SR OS Anysec and MACsec lab with containerlab.",
    stars: 42
  },
  {
    name: "intent-based-ansible-lab",
    htmlUrl: "https://github.com/srl-labs/intent-based-ansible-lab",
    description: "Intent-based networking lab with Ansible and SR Linux.",
    stars: 38
  },
  {
    name: "multivendor-evpn-lab",
    htmlUrl: "https://github.com/srl-labs/multivendor-evpn-lab",
    description: "Multivendor EVPN lab with Nokia, Arista, and Cisco network operating systems.",
    stars: 78
  }
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
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      name: typeof entry.name === "string" ? entry.name : "",
      htmlUrl: typeof entry.html_url === "string" ? entry.html_url : "",
      description: typeof entry.description === "string" ? entry.description : "",
      stars: typeof entry.stargazers_count === "number" ? entry.stargazers_count : 0
    }))
    .filter((entry) => entry.name.length > 0 && entry.htmlUrl.length > 0);
}

async function fetchPopularRepos(): Promise<PopularLabRepo[]> {
  try {
    const response = await fetch("/api/runtime/popular-repos", { credentials: "include" });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim());
    }
    const parsed = normalizePopularRepos(await response.json());
    return parsed.length > 0 ? parsed : FALLBACK_POPULAR_REPOS;
  } catch {
    return FALLBACK_POPULAR_REPOS;
  }
}

async function pickPopularRepo(promptTitle: string): Promise<string | undefined> {
  const repos = (await fetchPopularRepos()).slice(0, 12);
  if (repos.length === 0) {
    runtimeUiActions.notify("No popular repositories are available right now.", "warning");
    return undefined;
  }

  const optionsText = repos
    .map(
      (repo, index) =>
        `${index + 1}. ${repo.name} (⭐ ${repo.stars})` +
        `${repo.description ? ` — ${repo.description}` : ""}`
    )
    .join("\n");
  const rawSelection = window.prompt(
    `${promptTitle}:\n${optionsText}\n\nEnter number (1-${repos.length}).`,
    "1"
  );
  if (!rawSelection) {
    return undefined;
  }

  const selectedIndex = Number.parseInt(rawSelection, 10);
  if (!Number.isFinite(selectedIndex) || selectedIndex < 1 || selectedIndex > repos.length) {
    runtimeUiActions.notify("Invalid popular repository selection.", "error");
    return undefined;
  }

  return repos[selectedIndex - 1].htmlUrl;
}

function triggerTextDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function extractFirstHttpLink(value: string): string | undefined {
  const match = value.match(/https?:\/\/[^\s"'<>]+/i);
  const link = match?.[0]?.trim();
  return link && link.length > 0 ? link : undefined;
}

function describeBrowserPort(port: number): string {
  switch (port) {
    case 22:
      return "SSH";
    case 23:
      return "Telnet";
    case 25:
      return "SMTP";
    case 53:
      return "DNS";
    case 80:
      return "HTTP";
    case 443:
      return "HTTPS";
    case 1880:
      return "Node-RED";
    case 3000:
      return "Grafana";
    case 5432:
      return "PostgreSQL";
    case 5601:
      return "Kibana";
    case 8080:
      return "Web Server";
    case 8443:
      return "HTTPS (Alt)";
    case 9000:
      return "Web Server";
    case 9090:
      return "Prometheus";
    case 9200:
      return "Elasticsearch";
    default:
      return "";
  }
}

function filterTreeItems(items: ExplorerTreeItem[], filterText: string): ExplorerTreeItem[] {
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
    `ID: ${input.id}`
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
    `MTU: ${input.mtu || "N/A"}`
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
  return state.toLowerCase() === "up" ? "containerlabInterfaceUp" : "containerlabInterfaceDown";
}

function getLabOwner(lab: LabState): string {
  if (lab.owner.trim().length > 0) {
    return lab.owner.trim();
  }
  return lab.containers.values().next().value?.owner?.trim() ?? "";
}

function shouldShowRunningLab(
  lab: LabState,
  endpointsById: ReadonlyMap<string, EndpointConfig>
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
  files: TopologyFileEntry[]
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
    const exact = files.find((entry) => normalizePathValue(entry.path) === containerPath);
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
    (entry) => normalizeLabName(topologyEntryLabName(entry)) === normalizedLabName
  );
  if (nameMatches.length === 1) {
    return nameMatches[0];
  }
  if (nameMatches.length > 1 && loosePathMatches.length > 0) {
    const combinedMatches = nameMatches.filter((entry) =>
      loosePathMatches.some((candidate) => candidate.path === entry.path)
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
  children: ExplorerTreeItem[]
): ExplorerTreeItem {
  const endpointUrl = endpoint.url.replace(/^https?:\/\//i, "");
  return {
    id: `${idPrefix}:${endpoint.id}`,
    label: endpoint.label,
    description: endpointUrl,
    tooltip: `${endpoint.url}\nUsername: ${endpoint.username}\nStatus: ${endpoint.status.replace(/_/g, " ")}`,
    contextValue: "containerlabEndpoint",
    endpointId: endpoint.id,
    state: endpoint.status,
    collapsibleState: children.length > 0 ? TREE_ITEM_COLLAPSED : TREE_ITEM_NONE,
    children
  };
}

function buildEndpointSectionItem(
  endpointId: string,
  kind: "running" | "local",
  children: ExplorerTreeItem[]
): ExplorerTreeItem {
  const count = children.length;
  return {
    id: `endpoint-section:${kind}:${endpointId}`,
    label: kind === "running" ? "Running Labs" : "Undeployed Labs",
    tooltip: `${count} ${kind === "running" ? "running" : "undeployed"} lab${count === 1 ? "" : "s"}`,
    contextValue:
      kind === "running" ? "containerlabEndpointSectionRunning" : "containerlabEndpointSectionLocal",
    endpointId,
    collapsibleState: count > 0 ? TREE_ITEM_COLLAPSED : TREE_ITEM_NONE,
    children
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
  options: StandaloneExplorerBridgeOptions
): StandaloneExplorerBridge {
  let explorerFilterText = "";
  let explorerUiState: ExplorerUiState = {};
  const explorerSubscribers = new Set<(message: ExplorerIncomingMessage) => void>();
  const unhandledCommands = new Set<string>();
  const sshxLinksByLab = new Map<string, string>();
  const gottyLinksByLab = new Map<string, string>();

  function sendExplorerMessage(message: ExplorerIncomingMessage): void {
    const outgoing =
      message.command === "snapshot" ? transformSnapshotForEndpointRoots(message) : message;
    for (const subscriber of explorerSubscribers) {
      subscriber(outgoing);
    }
  }

  function postExplorerError(message: string): void {
    sendExplorerMessage({ command: "error", message });
  }

  function collectRunningLabItemsByEndpoint(files: TopologyFileEntry[]): Map<string, ExplorerTreeItem[]> {
    const labs = options.getLabs();
    const endpoints = options.getEndpoints();
    const endpointsById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
    const filesByEndpoint = new Map<string, TopologyFileEntry[]>();
    for (const file of files) {
      const bucket = filesByEndpoint.get(file.endpointId) ?? [];
      bucket.push(file);
      filesByEndpoint.set(file.endpointId, bucket);
    }

    const labItemsByEndpoint = new Map<string, ExplorerTreeItem[]>();
    for (const lab of labs.values()) {
      if (!shouldShowRunningLab(lab, endpointsById)) {
        continue;
      }

      const endpointFiles = filesByEndpoint.get(lab.endpointId) ?? [];
      const topologyEntry = findTopologyEntryForRunningLab(lab, endpointFiles);
      const topologyRef =
        topologyEntry?.topologyRef ??
        (lab.topologyPath
          ? buildStandaloneTopologyRefFromPath(lab.topologyPath, lab.name, lab.endpointId)
          : undefined);
      const containers: ExplorerTreeItem[] = [];

      for (const [, container] of lab.containers) {
        const interfaces = [...container.interfaces.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .filter((iface) => {
            const state = iface.state.toLowerCase();
            return iface.name !== "lo" && state !== "unknown";
          })
          .map((iface) => {
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
                txBps: iface.txBps
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
              children: []
            } satisfies ExplorerTreeItem;
          });

        containers.push({
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
            ipv6: container.ipv6Address
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
          collapsibleState: interfaces.length > 0 ? TREE_ITEM_COLLAPSED : TREE_ITEM_NONE,
          children: interfaces
        });
      }

      const fallbackPathHint =
        lab.topologyPath || (lab.containers.values().next().value?.labPath as string | undefined);
      const pathHint = topologyEntry?.path ?? fallbackPathHint;
      const owner = getLabOwner(lab);
      const labLabel = owner ? `${lab.name} (${owner})` : lab.name;
      const shareChildren: ExplorerTreeItem[] = [];
      const normalizedLabKey = normalizeLabName(lab.name);
      const sshxLink = (sshxLinksByLab.get(normalizedLabKey) ?? "").trim();
      const gottyLink = (gottyLinksByLab.get(normalizedLabKey) ?? "").trim();
      if (sshxLink) {
        shareChildren.push({
          id: `running-lab-share:sshx:${lab.endpointId}:${lab.name}`,
          label: "Shared Terminal",
          contextValue: "containerlabSSHXLink",
          collapsibleState: TREE_ITEM_NONE,
          endpointId: lab.endpointId,
          labName: lab.name,
          topologyRef,
          link: sshxLink,
          children: []
        });
      } else if (gottyLink) {
        shareChildren.push({
          id: `running-lab-share:gotty:${lab.endpointId}:${lab.name}`,
          label: "Web Terminal",
          contextValue: "containerlabGottyLink",
          collapsibleState: TREE_ITEM_NONE,
          endpointId: lab.endpointId,
          labName: lab.name,
          topologyRef,
          link: gottyLink,
          children: []
        });
      }
      const labItem: ExplorerTreeItem = {
        id: `running-lab:${lab.endpointId}:${lab.name}`,
        label: labLabel,
        description: pathHint || "No API topology file",
        tooltip: pathHint || `No API topology file available for running lab "${lab.name}"`,
        contextValue:
          topologyRef && isStandaloneFavorite({ endpointId: lab.endpointId, topologyRef })
            ? "containerlabLabDeployedFavorite"
            : "containerlabLabDeployed",
        collapsibleState:
          shareChildren.length > 0 || containers.length > 0 ? TREE_ITEM_COLLAPSED : TREE_ITEM_NONE,
        endpointId: lab.endpointId,
        labName: lab.name,
        topologyRef,
        children: [...shareChildren, ...containers]
      };

      if (topologyRef) {
        labItem.command = {
          command: "containerlab.lab.graph.topoViewer",
          title: "Open TopoViewer",
          arguments: [labItem]
        };
      }

      const bucket = labItemsByEndpoint.get(lab.endpointId) ?? [];
      bucket.push(labItem);
      labItemsByEndpoint.set(lab.endpointId, bucket);
    }

    return labItemsByEndpoint;
  }

  function collectLocalLabItemsByEndpoint(files: TopologyFileEntry[]): Map<string, ExplorerTreeItem[]> {
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
              topologyRef: file.topologyRef
            })
              ? "containerlabLabUndeployedFavorite"
              : "containerlabLabUndeployed",
            collapsibleState: TREE_ITEM_NONE,
            endpointId: file.endpointId,
            labName,
            topologyRef: file.topologyRef,
            children: []
          };
          item.command = {
            command: "containerlab.lab.graph.topoViewer",
            title: "Open TopoViewer",
            arguments: [item]
          };
          return item;
        });
      localItemsByEndpoint.set(endpointId, items);
    }

    return localItemsByEndpoint;
  }

  function buildEndpointGroupedItems(
    filterText: string,
    files: TopologyFileEntry[]
  ): ExplorerTreeItem[] {
    const endpoints = options.getEndpoints();
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
          children: []
        };
        return buildEndpointRootItem(endpoint, "endpoint", [placeholder]);
      }
      const runningItems = filterTreeItems(runningByEndpoint.get(endpoint.id) ?? [], filterText);
      const localItems = filterTreeItems(localByEndpoint.get(endpoint.id) ?? [], filterText);
      const groups = [
        buildEndpointSectionItem(endpoint.id, "running", runningItems),
        buildEndpointSectionItem(endpoint.id, "local", localItems)
      ];
      return buildEndpointRootItem(endpoint, "endpoint", filterTreeItems(groups, filterText));
    });

    return filterTreeItems(endpointItems, filterText);
  }

  function buildHelpItems(): ExplorerTreeItem[] {
    return HELP_LINKS.map((link) => ({
      id: `help:${link.url}`,
      label: link.label,
      tooltip: link.url,
      collapsibleState: TREE_ITEM_NONE,
      command: {
        command: "containerlab.openLink",
        title: "Open Link",
        arguments: [link.url]
      },
      children: []
    }));
  }

  function transformSnapshotForEndpointRoots(
    message: ExplorerSnapshotMessage
  ): ExplorerSnapshotMessage {
    const runningSection = message.sections.find((section) => section.id === "runningLabs");
    const localSection = message.sections.find((section) => section.id === "localLabs");
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
              ...(localSection?.toolbarActions ?? [])
            ])
          };
        })
    };
  }

  async function buildExplorerProviders(
    filterText: string = explorerFilterText
  ): Promise<ExplorerSnapshotProviders> {
    const files = await options.listTopologyFiles();
    const runningItems = buildEndpointGroupedItems(filterText, files);
    const localItems: ExplorerTreeItem[] = [];
    const helpItems = buildHelpItems();

    return {
      runningProvider: new SimpleExplorerProvider(runningItems) as ExplorerSnapshotProviders["runningProvider"],
      localProvider: new SimpleExplorerProvider(localItems) as ExplorerSnapshotProviders["localProvider"],
      helpProvider: new SimpleExplorerProvider(helpItems) as ExplorerSnapshotProviders["helpProvider"]
    };
  }

  async function executeExplorerCommand(commandId: string, args: unknown[]): Promise<void> {
    const requestedTopologyRef = firstArgAsTopologyRef(args);
    const item = firstArgAsTreeItem(args);
    const actionTopologyRef = requestedTopologyRef ?? (await options.resolveTopologyRef(args));
    const actionEndpointId =
      item?.endpointId ??
      extractEndpointIdFromTopologyId(actionTopologyRef?.topologyId);
    const endpoints = options.getEndpoints();
    const findEndpointById = (endpointId?: string): EndpointConfig | undefined =>
      endpointId ? endpoints.find((entry) => entry.id === endpointId) : undefined;
    const resolveEndpointForAction = async (
      actionDescription: string,
      preferredEndpointId?: string
    ): Promise<string | null> => {
      const preferred = findEndpointById(preferredEndpointId);
      if (preferred?.status === "connected") {
        return preferred.id;
      }

      const connectedEndpoints = endpoints.filter((endpoint) => endpoint.status === "connected");
      if (connectedEndpoints.length === 0) {
        postExplorerError(`Connect an endpoint before trying to ${actionDescription}.`);
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
          description: endpoint.url
        })),
        preferredValue: connectedEndpoints[0]?.id
      });
      if (!selectedEndpointId) {
        return null;
      }
      if (!connectedEndpoints.some((endpoint) => endpoint.id === selectedEndpointId)) {
        runtimeUiActions.notify("Invalid endpoint selection.", "error");
        return null;
      }
      return selectedEndpointId;
    };
    const targetLabel =
      actionTopologyRef?.labName ??
      item?.labName ??
      (typeof item?.label === "string" ? item.label : undefined);
    const resolveActionTopologyRef = (): TopologyRef | undefined => {
      if (actionTopologyRef) {
        return actionTopologyRef;
      }

      const labNameHint = (item?.labName ?? targetLabel ?? "").trim();
      if (!labNameHint) {
        return undefined;
      }

      const normalizedLabNameHint = normalizeLabName(labNameHint);
      for (const lab of options.getLabs().values()) {
        if (actionEndpointId && lab.endpointId !== actionEndpointId) {
          continue;
        }
        if (normalizeLabName(lab.name) !== normalizedLabNameHint) {
          continue;
        }
        return buildStandaloneTopologyRefFromPath(
          lab.topologyPath || `${lab.name}.clab.yml`,
          lab.name,
          lab.endpointId
        );
      }

      return undefined;
    };
    const resolveCaptureTargets = (): Array<{ containerName: string; interfaceName: string }> => {
      const byKey = new Map<string, { containerName: string; interfaceName: string }>();

      const pushCandidate = (candidate: unknown): void => {
        if (!candidate || typeof candidate !== "object") {
          return;
        }
        const containerName =
          typeof (candidate as { containerName?: unknown }).containerName === "string"
            ? (candidate as { containerName: string }).containerName.trim()
            : "";
        const interfaceName =
          typeof (candidate as { name?: unknown }).name === "string"
            ? (candidate as { name: string }).name.trim()
            : "";
        if (!containerName || !interfaceName) {
          return;
        }
        byKey.set(`${containerName}::${interfaceName}`, { containerName, interfaceName });
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
        postExplorerError("No canonical topology reference is available for this item.");
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
          remoteHostname: getSessionHostnameOverride(actionEndpointId)
        });

        const captures = captureResponse.captures ?? [];
        if (captures.length === 0) {
          runtimeUiActions.notify("No packet capture targets were returned.", "warning");
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
          "success"
        );
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const runWiresharkVncCapture = async (): Promise<void> => {
      if (!actionTopologyRef) {
        postExplorerError("No canonical topology reference is available for this item.");
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
          theme
        });

        const sessions = sessionsResponse.sessions ?? [];
        if (sessions.length === 0) {
          runtimeUiActions.notify("No Wireshark sessions were created.", "warning");
          return;
        }

        for (const session of sessions) {
          const params = new URLSearchParams({ sessionId: session.sessionId, theme });
          if (actionEndpointId) {
            params.set("endpointId", actionEndpointId);
          }
          if (session.showVolumeTip) {
            params.set("showVolumeTip", "1");
          }
          const capturePageUrl = `/wireshark.html?${params.toString()}`;
          window.open(capturePageUrl, "_blank", "noopener,noreferrer");
        }

        runtimeUiActions.notify(
          sessions.length > 1
            ? `Opened ${sessions.length} Wireshark VNC sessions.`
            : "Opened Wireshark VNC session.",
          "success"
        );
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const runPreferredCapture = async (): Promise<void> => {
      const preferredAction = loadCapturePreferences(actionEndpointId).preferredAction;
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
      }
    ): Promise<void> => {
      const topologySourceUrl = sourceUrl.trim();
      if (!topologySourceUrl) {
        runtimeUiActions.notify("A repository or topology URL is required.", "error");
        return;
      }
      const target = cloneOptions?.target ?? "deploy";

      let labNameOverride: string | undefined;
      if (cloneOptions?.skipLabNamePrompt) {
        labNameOverride = cloneOptions.labNameOverride?.trim() || undefined;
      } else {
        const rawLabNameOverride = window.prompt(
          "Optional lab name override (leave empty to use default)",
          ""
        );
        if (rawLabNameOverride === null) {
          return;
        }
        labNameOverride = rawLabNameOverride.trim() || undefined;
      }

      try {
        if (target === "undeployed") {
          const response = await importTopologyFromUrl({
            endpointId,
            topologySourceUrl,
            labNameOverride
          });
          options.invalidateTopologyFileListCache(endpointId);
          controller.scheduleSnapshot(0);
          runtimeUiActions.notify(
            `Cloned ${response.labName} to undeployed labs.`,
            "success"
          );
          await options.loadTopologyFile(response.topologyRef, {
            deploymentState: "undeployed",
            endpointId
          });
          return;
        }

        const response = await deployLabFromUrl({
          endpointId,
          topologySourceUrl,
          labNameOverride
        });
        options.invalidateTopologyFileListCache(endpointId);
        controller.scheduleSnapshot(0);
        const labNames = response.labNames ?? [];
        runtimeUiActions.notify(
          labNames.length > 0
            ? `Deployed ${labNames.join(", ")} from source URL.`
            : "Deployment from source URL finished successfully.",
          "success"
        );
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const openSshToAllNodes = (): void => {
      const topologyForSearch = {
        yamlPath: actionTopologyRef?.yamlPath ?? "",
        topologyId: actionTopologyRef?.topologyId,
        labName: actionTopologyRef?.labName ?? item?.labName,
        endpointId: actionEndpointId
      };
      const lab = findLabStateForTopology(topologyForSearch, options.getLabs());
      if (!lab) {
        postExplorerError("No running lab context is available for this action.");
        return;
      }

      const topologyRef =
        actionTopologyRef ??
        buildStandaloneTopologyRefFromPath(
          lab.topologyPath || `${lab.name}.clab.yml`,
          lab.name,
          lab.endpointId
        );
      const containers = [...lab.containers.values()].sort((left, right) =>
        (left.nodeName || left.name).localeCompare(right.nodeName || right.name)
      );
      if (containers.length === 0) {
        runtimeUiActions.notify(`No containers were found in lab "${lab.name}".`, "warning");
        return;
      }

      for (const container of containers) {
        const nodeName = container.nodeName || container.name;
        runtimeUiActions.openTerminal({
          endpointId: lab.endpointId,
          topologyRef,
          nodeName,
          protocol: "ssh",
          title: `SSH: ${nodeName}`
        });
      }
      runtimeUiActions.notify(
        containers.length > 1
          ? `Opened SSH terminals for ${containers.length} nodes.`
          : `Opened SSH terminal for ${containers[0]?.nodeName || containers[0]?.name}.`,
        "success"
      );
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
      topologyRef?: TopologyRef
    ): void => {
      const content = output.trim();
      runtimeUiActions.openTerminal({
        endpointId: actionEndpointId,
        sessionId: `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        topologyRef,
        nodeName: commandLabel,
        protocol: "output",
        title,
        initialOutput: content || "(no output)"
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

      const endpoint = findEndpointById(actionEndpointId);
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
      action: "start" | "stop" | "pause" | "unpause",
      successLabel: string
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
          action
        });
        runtimeUiActions.notify(successLabel, "success");
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
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
          nodeName: item.name
        });
        const ports = payload.ports ?? [];
        if (ports.length === 0) {
          runtimeUiActions.notify(`No exposed ports were found for ${item.name}.`, "warning");
          return;
        }

        const candidates = ports.map((port) => {
          const host = resolveBrowserHost(port.hostIp);
          const hostForUrl = host.includes(":") ? `[${host}]` : host;
          const description = port.description || describeBrowserPort(port.containerPort);
          return {
            ...port,
            description,
            url: `http://${hostForUrl}:${port.hostPort}`
          };
        });

        if (candidates.length === 1) {
          window.open(candidates[0].url, "_blank", "noopener,noreferrer");
          runtimeUiActions.notify(`Opened ${candidates[0].url}.`, "success");
          return;
        }

        const optionText = candidates
          .map(
            (candidate, index) =>
              `${index + 1}. ${candidate.hostPort}:${candidate.containerPort}/${candidate.protocol || "tcp"}` +
              `${candidate.description ? ` — ${candidate.description}` : ""}`
          )
          .join("\n");

        const rawSelection = window.prompt(
          `Select a port to open:\n${optionText}\n\nEnter number (1-${candidates.length}).`,
          "1"
        );
        if (!rawSelection) {
          return;
        }

        const selectedIndex = Number.parseInt(rawSelection, 10);
        if (!Number.isFinite(selectedIndex) || selectedIndex < 1 || selectedIndex > candidates.length) {
          runtimeUiActions.notify("Invalid port selection.", "error");
          return;
        }

        const target = candidates[selectedIndex - 1];
        window.open(target.url, "_blank", "noopener,noreferrer");
        runtimeUiActions.notify(`Opened ${target.url}.`, "success");
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const runShareAction = async (
      kind: "sshx" | "gotty",
      action: "attach" | "detach" | "reattach"
    ): Promise<void> => {
      const topologyRef = resolveActionTopologyRef();
      if (!topologyRef) {
        postExplorerError("Sharing actions require a running lab item.");
        return;
      }

      try {
        runtimeUiActions.notify(
          `${kind.toUpperCase()} ${action} started. This may take a moment...`,
          "info"
        );

        const payload =
          kind === "sshx"
            ? await runSshxShareAction({
                endpointId: actionEndpointId,
                topologyRef,
                action
              })
            : await runGottyShareAction({
                endpointId: actionEndpointId,
                topologyRef,
                action
              });

        const link = payload.link?.trim() || extractFirstHttpLink(payload.output ?? "") || "";
        const labKey = normalizeLabName(topologyRef.labName || resolveShareLabKey());
        if (labKey) {
          const bucket = kind === "sshx" ? sshxLinksByLab : gottyLinksByLab;
          if (action === "detach") {
            bucket.delete(labKey);
          } else if (link) {
            bucket.set(labKey, link);
          }
        }
        controller.scheduleSnapshot(0);

        if (link && (action === "attach" || action === "reattach")) {
          await navigator.clipboard.writeText(link).catch(() => {});
          const shouldOpen = window.confirm(
            `${kind.toUpperCase()} link copied to clipboard.\n\nOpen link now?`
          );
          if (shouldOpen) {
            window.open(link, "_blank", "noopener,noreferrer");
          }
        }

        if (!link && (action === "attach" || action === "reattach")) {
          runtimeUiActions.notify(
            `${kind.toUpperCase()} ${action} completed, but no share link was returned.`,
            "warning"
          );
        }

        runtimeUiActions.notify(payload.message || `${kind.toUpperCase()} ${action} completed.`, "success");
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const copyShareLink = async (kind: "sshx" | "gotty"): Promise<void> => {
      const argLink = typeof args[0] === "string" ? args[0].trim() : "";
      const bucket = kind === "sshx" ? sshxLinksByLab : gottyLinksByLab;
      const storedLabKey = normalizeLabName(resolveShareLabKey());
      const storedLink = storedLabKey ? bucket.get(storedLabKey) ?? "" : "";
      const link = argLink || storedLink;
      if (!link) {
        runtimeUiActions.notify(
          `No ${kind.toUpperCase()} link is currently available for this lab.`,
          "warning"
        );
        return;
      }

      await navigator.clipboard.writeText(link).catch(() => {});
      runtimeUiActions.notify(`${kind.toUpperCase()} link copied to clipboard.`, "success");
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
          "info"
        );
        const response = await runFcliCommand({
          endpointId: actionEndpointId,
          topologyRef,
          command
        });
        const content = response.output?.trim() || "(no output)";
        openCommandOutputTerminal(
          `fcli: ${command}`,
          `fcli ${command}`,
          content,
          topologyRef
        );
        if (/\bNo data\.\.\./i.test(content)) {
          runtimeUiActions.notify(
            `fcli "${command}" returned no data. Check lab state/filter and try a different command (for example sys-info).`,
            "warning"
          );
        } else {
          runtimeUiActions.notify(`fcli "${command}" finished. Output opened in terminal.`, "success");
        }
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const runDrawio = async (layout: "horizontal" | "vertical" | "interactive"): Promise<void> => {
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
          layout
        });

        triggerTextDownload(
          safeFilename(response.fileName || `${topologyRef.labName}.drawio`),
          response.content,
          "application/xml"
        );

        if (layout === "interactive") {
          const output = [response.output?.trim(), response.message?.trim()]
            .filter((value): value is string => Boolean(value && value.length > 0))
            .join("\n\n");
          openCommandOutputTerminal(
            `draw.io interactive: ${topologyRef.labName}`,
            "graph drawio -I",
            output || "Interactive draw.io output is unavailable.",
            topologyRef
          );
        }

        runtimeUiActions.notify(
          response.message || `Generated draw.io (${layout}) for ${topologyRef.labName}.`,
          "success"
        );
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    switch (commandId) {
      case "containerlab.openLink": {
        const link = typeof args[0] === "string" ? args[0] : undefined;
        if (link) {
          window.open(link, "_blank", "noopener,noreferrer");
        }
        return;
      }
      case "containerlab.endpoint.reconnect": {
        if (!actionEndpointId) {
          postExplorerError("No endpoint is associated with this item.");
          return;
        }
        dispatchEndpointUiAction({ action: "reconnect", endpointId: actionEndpointId });
        return;
      }
      case "containerlab.endpoint.remove": {
        if (!actionEndpointId) {
          postExplorerError("No endpoint is associated with this item.");
          return;
        }
        dispatchEndpointUiAction({ action: "remove", endpointId: actionEndpointId });
        return;
      }
      case "containerlab.endpoint.copyUrl": {
        if (!actionEndpointId) {
          postExplorerError("No endpoint is associated with this item.");
          return;
        }
        const endpoint = findEndpointById(actionEndpointId);
        if (!endpoint) {
          postExplorerError("Endpoint metadata is not available.");
          return;
        }
        await navigator.clipboard.writeText(endpoint.url).catch(() => {});
        runtimeUiActions.notify(`Copied endpoint URL for ${endpoint.label}.`, "success");
        return;
      }
      case "containerlab.install.edgeshark": {
        const endpointId = await resolveEndpointForAction("install EdgeShark", actionEndpointId);
        if (!endpointId) {
          return;
        }
        try {
          await installEdgeShark(endpointId);
          runtimeUiActions.notify("Installed EdgeShark.", "success");
        } catch (error) {
          runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }
      case "containerlab.uninstall.edgeshark": {
        const endpointId = await resolveEndpointForAction("uninstall EdgeShark", actionEndpointId);
        if (!endpointId) {
          return;
        }
        if (!window.confirm("Uninstall EdgeShark on this endpoint?")) {
          return;
        }
        try {
          await uninstallEdgeShark(endpointId);
          runtimeUiActions.notify("Uninstalled EdgeShark.", "success");
        } catch (error) {
          runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }
      case "containerlab.lab.graph.topoViewer":
      case "containerlab.lab.openFile":
      case "containerlab.editor.topoViewerEditor.open": {
        if (!actionTopologyRef) {
          postExplorerError(
            targetLabel
              ? `No canonical topology reference is available for running lab "${targetLabel}".`
              : "No canonical topology reference is available for this item."
          );
          return;
        }
        const itemState = deploymentStateFromContext(item?.contextValue);
        const resolvedState = await options.resolveDeploymentState(actionTopologyRef);
        const deploymentState = resolvedState ?? itemState;
        await options.loadTopologyFile(actionTopologyRef, { deploymentState, endpointId: actionEndpointId });
        return;
      }
      case "containerlab.lab.graph.drawio.horizontal": {
        await runDrawio("horizontal");
        return;
      }
      case "containerlab.lab.graph.drawio.vertical": {
        await runDrawio("vertical");
        return;
      }
      case "containerlab.lab.graph.drawio.interactive": {
        await runDrawio("interactive");
        return;
      }
      case "containerlab.editor.topoViewerEditor": {
        const connectedEndpoints = endpoints.filter((endpoint) => endpoint.status === "connected");
        if (connectedEndpoints.length === 0) {
          postExplorerError("Connect an endpoint before trying to create a topology file.");
          return;
        }
        const preferredEndpoint = findEndpointById(actionEndpointId);
        const createTopologyInput = await promptForCreateTopology({
          title: "Create Topology File",
          message: "Choose endpoint and file name for the new topology file.",
          confirmLabel: "Create",
          endpointOptions: connectedEndpoints.map((endpoint) => ({
            value: endpoint.id,
            label: endpoint.label,
            description: endpoint.url
          })),
          defaultEndpointId:
            preferredEndpoint?.status === "connected" ? preferredEndpoint.id : connectedEndpoints[0]?.id,
          defaultFileName: "new-lab.clab.yml"
        });
        if (!createTopologyInput) {
          return;
        }
        const { endpointId, fileName: rawFileName } = createTopologyInput;

        try {
          const created = await createTopologyFile({ endpointId, fileName: rawFileName });
          options.invalidateTopologyFileListCache(endpointId);
          controller.scheduleSnapshot(0);
          runtimeUiActions.notify(`Created topology file "${rawFileName}".`, "success");
          await options.loadTopologyFile(created.topologyRef, {
            deploymentState: "undeployed",
            endpointId
          });
        } catch (error) {
          runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }
      case "containerlab.lab.cloneRepo": {
        const connectedEndpoints = endpoints.filter((endpoint) => endpoint.status === "connected");
        if (connectedEndpoints.length === 0) {
          postExplorerError("Connect an endpoint before trying to clone a repository.");
          return;
        }
        const preferredEndpoint = findEndpointById(actionEndpointId);
        const popularRepos = (await fetchPopularRepos()).slice(0, 12);
        const cloneRepoInput = await promptForCloneRepo({
          title: "Clone Repository",
          message: "Choose endpoint, source, and target action.",
          confirmLabel: "Continue",
          endpointOptions: connectedEndpoints.map((endpoint) => ({
            value: endpoint.id,
            label: endpoint.label,
            description: endpoint.url
          })),
          popularOptions: popularRepos.map((repo) => ({
            value: repo.htmlUrl,
            label: `${repo.name} (⭐ ${repo.stars})`,
            description: repo.description
          })),
          defaultEndpointId:
            preferredEndpoint?.status === "connected" ? preferredEndpoint.id : connectedEndpoints[0]?.id,
          defaultMode: "url",
          defaultSourceUrl: "https://github.com/srl-labs/srl-telemetry-lab",
          defaultTarget: "deploy"
        });
        if (!cloneRepoInput) {
          return;
        }
        await cloneFromUrlFlow(cloneRepoInput.endpointId, cloneRepoInput.sourceUrl, {
          labNameOverride: cloneRepoInput.labNameOverride,
          skipLabNamePrompt: true,
          target: cloneRepoInput.target
        });
        return;
      }
      case "containerlab.lab.clonePopularRepo":
      case "containerlab.lab.deployPopular": {
        const endpointId = await resolveEndpointForAction(
          commandId === "containerlab.lab.clonePopularRepo"
            ? "clone a popular lab"
            : "deploy a popular lab",
          actionEndpointId
        );
        if (!endpointId) {
          return;
        }
        const sourceUrl = await pickPopularRepo(
          commandId === "containerlab.lab.clonePopularRepo"
            ? "Clone popular lab"
            : "Deploy popular lab"
        );
        if (!sourceUrl) {
          return;
        }
        await cloneFromUrlFlow(endpointId, sourceUrl, {
          target: commandId === "containerlab.lab.clonePopularRepo" ? "undeployed" : "deploy"
        });
        return;
      }
      case "containerlab.inspectAll": {
        runtimeUiActions.openInspectAll();
        return;
      }
      case "containerlab.inspectOneLab": {
        if (!actionTopologyRef) {
          postExplorerError("No canonical topology reference is available for this item.");
          return;
        }
        runtimeUiActions.openInspectLab(
          { endpointId: actionEndpointId, topologyRef: actionTopologyRef },
          `Inspect: ${targetLabel ?? actionTopologyRef.labName}`
        );
        return;
      }
      case "containerlab.lab.deploy":
      case "containerlab.lab.deploy.cleanup":
      case "containerlab.lab.deploy.specificFile": {
        if (!actionTopologyRef) {
          postExplorerError("No canonical topology reference is available for this item.");
          return;
        }
        const withCleanup = commandId === "containerlab.lab.deploy.cleanup";
        if (
          withCleanup &&
          !window.confirm(
            "Deploy (cleanup) may remove existing lab artifacts before deployment. Continue?"
          )
        ) {
          return;
        }
        try {
          await options.invokeLifecycleApi("deploy", actionTopologyRef, withCleanup);
          options.invalidateTopologyFileListCache(actionEndpointId);
        } catch (error) {
          console.error("[Standalone] Deploy failed:", error);
        }
        return;
      }
      case "containerlab.lab.destroy":
      case "containerlab.lab.destroy.cleanup": {
        if (!actionTopologyRef) {
          postExplorerError("No canonical topology reference is available for this item.");
          return;
        }
        try {
          await options.invokeLifecycleApi(
            "destroy",
            actionTopologyRef,
            commandId === "containerlab.lab.destroy.cleanup"
          );
          options.invalidateTopologyFileListCache(actionEndpointId);
        } catch (error) {
          console.error("[Standalone] Destroy failed:", error);
        }
        return;
      }
      case "containerlab.lab.redeploy":
      case "containerlab.lab.redeploy.cleanup": {
        if (!actionTopologyRef) {
          postExplorerError("No canonical topology reference is available for this item.");
          return;
        }
        try {
          await options.invokeLifecycleApi(
            "redeploy",
            actionTopologyRef,
            commandId === "containerlab.lab.redeploy.cleanup"
          );
          options.invalidateTopologyFileListCache(actionEndpointId);
        } catch (error) {
          console.error("[Standalone] Redeploy failed:", error);
        }
        return;
      }
      case "containerlab.lab.save": {
        if (!actionTopologyRef) {
          postExplorerError("No canonical topology reference is available for this item.");
          return;
        }
        await saveConfigsFlow(
          { endpointId: actionEndpointId, topologyRef: actionTopologyRef },
          `Saved configs for ${actionTopologyRef.labName}.`
        );
        return;
      }
      case "containerlab.lab.delete": {
        if (!actionTopologyRef) {
          postExplorerError("No canonical topology reference is available for this item.");
          return;
        }
        const deleted = await deleteTopologyFileFlow({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef
        });
        if (deleted) {
          options.invalidateTopologyFileListCache(actionEndpointId);
          controller.scheduleSnapshot(0);
        }
        return;
      }
      case "containerlab.lab.toggleFavorite": {
        if (!actionTopologyRef) {
          postExplorerError("No canonical topology reference is available for this item.");
          return;
        }
        const nextFavorite = toggleStandaloneFavorite({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef
        });
        controller.scheduleSnapshot(0);
        runtimeUiActions.notify(
          nextFavorite ? "Added lab to favorites." : "Removed lab from favorites.",
          "success"
        );
        return;
      }
      case "containerlab.lab.sshToAllNodes": {
        openSshToAllNodes();
        return;
      }
      case "containerlab.lab.sshx.attach": {
        await runShareAction("sshx", "attach");
        return;
      }
      case "containerlab.lab.sshx.detach": {
        await runShareAction("sshx", "detach");
        return;
      }
      case "containerlab.lab.sshx.reattach": {
        await runShareAction("sshx", "reattach");
        return;
      }
      case "containerlab.lab.gotty.attach": {
        await runShareAction("gotty", "attach");
        return;
      }
      case "containerlab.lab.gotty.detach": {
        await runShareAction("gotty", "detach");
        return;
      }
      case "containerlab.lab.gotty.reattach": {
        await runShareAction("gotty", "reattach");
        return;
      }
      case "containerlab.lab.sshx.copyLink":
      case "containerlab.lab.sshx.copylink": {
        await copyShareLink("sshx");
        return;
      }
      case "containerlab.lab.gotty.copyLink":
      case "containerlab.lab.gotty.copylink": {
        await copyShareLink("gotty");
        return;
      }
      case "containerlab.lab.fcli.bgpPeers": {
        await runFcli("bgp-peers");
        return;
      }
      case "containerlab.lab.fcli.bgpRib": {
        await runFcli("bgp-rib");
        return;
      }
      case "containerlab.lab.fcli.ipv4Rib": {
        await runFcli("ipv4-rib");
        return;
      }
      case "containerlab.lab.fcli.lldp": {
        await runFcli("lldp");
        return;
      }
      case "containerlab.lab.fcli.mac": {
        await runFcli("mac");
        return;
      }
      case "containerlab.lab.fcli.ni": {
        await runFcli("ni");
        return;
      }
      case "containerlab.lab.fcli.subif": {
        await runFcli("subif");
        return;
      }
      case "containerlab.lab.fcli.sysInfo": {
        await runFcli("sys-info");
        return;
      }
      case "containerlab.lab.fcli.custom": {
        const customCommand = window.prompt(
          "Custom fcli command",
          "bgp-peers"
        );
        if (!customCommand || customCommand.trim().length === 0) {
          return;
        }
        await runFcli(customCommand.trim());
        return;
      }
      case "containerlab.capture.killAllWiresharkVNC": {
        const endpointId = await resolveEndpointForAction(
          "close all Wireshark VNC sessions",
          actionEndpointId
        );
        if (!endpointId) {
          return;
        }
        const confirmed = window.confirm(
          "Close all active Wireshark VNC sessions for this endpoint?"
        );
        if (!confirmed) {
          return;
        }

        try {
          const response = await closeAllWiresharkVncSessions(endpointId);
          runtimeUiActions.notify(response.message || "Closed Wireshark VNC sessions.", "success");
        } catch (error) {
          runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
        }
        return;
      }
      case "containerlab.treeView.runningLabs.hideNonOwnedLabs": {
        showNonOwnedLabs = false;
        persistShowNonOwnedLabsSetting(false);
        controller.scheduleSnapshot(0);
        return;
      }
      case "containerlab.treeView.runningLabs.showNonOwnedLabs": {
        showNonOwnedLabs = true;
        persistShowNonOwnedLabsSetting(true);
        controller.scheduleSnapshot(0);
        return;
      }
      case "containerlab.node.save": {
        if (!actionTopologyRef || !item?.name) {
          postExplorerError("Node save requires a running lab item.");
          return;
        }
        await saveConfigsFlow(
          {
            endpointId: actionEndpointId,
            topologyRef: actionTopologyRef,
            nodeName: item.name
          },
          `Saved config for ${item.label || item.name}.`
        );
        return;
      }
      case "containerlab.node.start": {
        await runNodeLifecycle(
          "start",
          `Started ${item?.label || item?.name || "node"}.`
        );
        return;
      }
      case "containerlab.node.stop": {
        await runNodeLifecycle(
          "stop",
          `Stopped ${item?.label || item?.name || "node"}.`
        );
        return;
      }
      case "containerlab.node.pause": {
        await runNodeLifecycle(
          "pause",
          `Paused ${item?.label || item?.name || "node"}.`
        );
        return;
      }
      case "containerlab.node.unpause": {
        await runNodeLifecycle(
          "unpause",
          `Unpaused ${item?.label || item?.name || "node"}.`
        );
        return;
      }
      case "containerlab.node.openBrowser": {
        await openNodeBrowser();
        return;
      }
      case "containerlab.node.ssh":
      case "containerlab.node.attachShell":
      case "containerlab.node.telnet": {
        if (!actionTopologyRef || !item?.name) {
          postExplorerError("Node access requires a running lab item.");
          return;
        }

        const protocol = nodeAccessProtocol(commandId);
        const titlePrefix = nodeAccessTitlePrefix(protocol);

        runtimeUiActions.openTerminal({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          nodeName: item.name,
          protocol,
          title: `${titlePrefix}: ${item.label || item.name}`
        });
        return;
      }
      case "containerlab.node.showLogs": {
        if (!actionTopologyRef || !item?.name) {
          postExplorerError("Node logs require a running lab item.");
          return;
        }
        runtimeUiActions.openLogs({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          nodeName: item.name,
          title: `Logs: ${item.label || item.name}`
        });
        return;
      }
      case "containerlab.node.manageImpairments": {
        if (!actionTopologyRef || !item?.name) {
          postExplorerError("Impairments require a running lab item.");
          return;
        }
        runtimeUiActions.openNetem({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          nodeName: item.name,
          title: `Impairments: ${item.label || item.name}`
        });
        return;
      }
      case "containerlab.interface.setDelay":
      case "containerlab.interface.setJitter":
      case "containerlab.interface.setLoss":
      case "containerlab.interface.setRate":
      case "containerlab.interface.setCorruption": {
        if (!actionTopologyRef || !item?.containerName) {
          postExplorerError("Interface impairments require a running interface item.");
          return;
        }

        const fieldByCommand: Record<string, keyof NetemFields> = {
          "containerlab.interface.setDelay": "delay",
          "containerlab.interface.setJitter": "jitter",
          "containerlab.interface.setLoss": "loss",
          "containerlab.interface.setRate": "rate",
          "containerlab.interface.setCorruption": "corruption"
        };

        runtimeUiActions.openNetem({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          nodeName: item.containerName,
          preferredField: fieldByCommand[commandId],
          preferredInterfaceName: item.label || item.name,
          title: `Impairments: ${item.containerName}`
        });
        return;
      }
      case "containerlab.interface.capture": {
        await runPreferredCapture();
        return;
      }
      case "containerlab.interface.captureWithEdgeshark": {
        await runPacketflixCapture();
        return;
      }
      case "containerlab.interface.captureWithEdgesharkVNC": {
        await runWiresharkVncCapture();
        return;
      }
      case "containerlab.set.sessionHostname": {
        const actionEndpointLabel = findEndpointById(actionEndpointId)?.label ?? actionEndpointId ?? "default";
        const currentHostname = getSessionHostnameOverride(actionEndpointId) ?? "";
        const rawValue = window.prompt(
          `Set session hostname override for packet capture on "${actionEndpointLabel}" (leave empty to clear)`,
          currentHostname
        );
        if (rawValue === null) {
          return;
        }
        const nextValue = setSessionHostnameOverride(rawValue, actionEndpointId);
        runtimeUiActions.notify(
          nextValue
            ? `Session hostname override for "${actionEndpointLabel}" set to "${nextValue}".`
            : `Session hostname override for "${actionEndpointLabel}" cleared.`,
          "success"
        );
        return;
      }
      case "containerlab.node.copyName": {
        if (item) {
          await navigator.clipboard.writeText(item.name || item.label || "").catch(() => {});
        }
        return;
      }
      case "containerlab.node.copyID": {
        if (item?.cID) {
          await navigator.clipboard.writeText(item.cID).catch(() => {});
        }
        return;
      }
      case "containerlab.node.copyKind": {
        if (item?.kind) {
          await navigator.clipboard.writeText(item.kind).catch(() => {});
        }
        return;
      }
      case "containerlab.node.copyImage": {
        if (item?.image) {
          await navigator.clipboard.writeText(item.image).catch(() => {});
        }
        return;
      }
      case "containerlab.node.copyIPv4Address": {
        if (item?.v4Address) {
          await navigator.clipboard.writeText(item.v4Address).catch(() => {});
        }
        return;
      }
      case "containerlab.node.copyIPv6Address": {
        if (item?.v6Address) {
          await navigator.clipboard.writeText(item.v6Address).catch(() => {});
        }
        return;
      }
      case "containerlab.interface.copyMACAddress": {
        if (item?.mac) {
          await navigator.clipboard.writeText(item.mac).catch(() => {});
        }
        return;
      }
      case "containerlab.lab.copyPath": {
        const apiLabPath = actionTopologyRef?.yamlPath ?? (await options.resolveApiTopologyPath(args));
        if (apiLabPath) {
          await navigator.clipboard.writeText(apiLabPath).catch(() => {});
        }
        return;
      }
      default: {
        if (!unhandledCommands.has(commandId)) {
          unhandledCommands.add(commandId);
          console.warn(`[Standalone] Command not implemented: ${commandId}`);
        }
      }
    }
  }

  const controller = createExplorerController({
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
        hiddenCommandIds: STANDALONE_HIDDEN_COMMAND_IDS
      };
    },
    onFilterTextChanged(filterText) {
      explorerFilterText = filterText;
    },
    onUiStateChanged(state) {
      explorerUiState = state ?? {};
    }
  });

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
      }
    },
    scheduleSnapshot(delay = options.debounceMs) {
      controller.scheduleSnapshot(delay);
    }
  };
}
