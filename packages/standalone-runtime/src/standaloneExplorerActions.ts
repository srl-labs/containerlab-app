import type { TopologyRef } from "@containerlab/clab-ui/session";
import {
  runGottyShareAction,
  runSshxShareAction,
  type FileExplorerDocument,
  type LabArchiveFormat
} from "./runtimeApi";
import {
  confirmRuntimeAction,
  promptForEndpointSelection,
  promptForOptionSelection
} from "./runtimeActionFlows";
import type { EndpointConfig } from "./stores/endpointStore";
import type { ContainerState, LabState } from "./stores/labStore";
import { runtimeUiActions } from "./stores/runtimeUiStore";
import type {
  DeploymentState,
  ExplorerTreeItem,
  LifecycleCommandEndpoint,
  TopologyFileEntry
} from "./standaloneHostShared";
import {
  buildStandaloneTopologyRefFromPath,
  extractEndpointIdFromTopologyId,
  normalizeLabName,
  normalizePathValue,
  stripTopologySuffix
} from "./standaloneHostShared";

const SHOW_NON_OWNED_LABS_STORAGE_KEY = "clab-standalone-show-non-owned-labs";

export type ShareActionKind = "sshx" | "gotty";

export type ShareLifecycleAction = "attach" | "detach" | "reattach";

function loadShowNonOwnedLabsSetting(): boolean {
  try {
    const raw = localStorage.getItem(SHOW_NON_OWNED_LABS_STORAGE_KEY);
    return raw !== "false";
  } catch {
    return true;
  }
}

export function persistShowNonOwnedLabsSetting(nextValue: boolean): void {
  try {
    localStorage.setItem(SHOW_NON_OWNED_LABS_STORAGE_KEY, String(nextValue));
  } catch {
    // Ignore persistence failures.
  }
}

export const explorerPreferences = {
  showNonOwnedLabs: loadShowNonOwnedLabsSetting()
};

export function findEndpointConfig(
  endpoints: EndpointConfig[],
  endpointId?: string
): EndpointConfig | undefined {
  return endpointId ? endpoints.find((entry) => entry.id === endpointId) : undefined;
}

export function resolveExplorerActionTopologyRef(input: {
  actionEndpointId?: string;
  actionTopologyRef?: TopologyRef;
  item?: ExplorerTreeItem;
  labs: Map<string, LabState>;
  targetLabel?: string;
}): TopologyRef | undefined {
  const { actionEndpointId, actionTopologyRef, item, labs, targetLabel } = input;
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
      lab.endpointId
    );
  }

  return undefined;
}

export function resolveExplorerActionEndpointId(
  item: ExplorerTreeItem | undefined,
  topologyRef: TopologyRef | undefined
): string | undefined {
  if (item?.endpointId) {
    return item.endpointId;
  }
  return extractEndpointIdFromTopologyId(topologyRef?.topologyId);
}

export function resolveExplorerTargetLabel(
  item: ExplorerTreeItem | undefined,
  topologyRef: TopologyRef | undefined
): string | undefined {
  if (topologyRef?.labName) {
    return topologyRef.labName;
  }
  if (item?.labName) {
    return item.labName;
  }
  return typeof item?.label === "string" ? item.label : undefined;
}

export async function resolveEndpointForExplorerAction(input: {
  actionDescription: string;
  endpoints: EndpointConfig[];
  postError: (message: string) => void;
  preferredEndpointId?: string;
}): Promise<string | null> {
  const { actionDescription, endpoints, postError, preferredEndpointId } = input;
  const preferred = findEndpointConfig(endpoints, preferredEndpointId);
  if (preferred?.status === "connected") {
    return preferred.id;
  }

  const connectedEndpoints = endpoints.filter((endpoint) => endpoint.status === "connected");
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
}

export function sortedRunningContainers(lab: LabState): ContainerState[] {
  return [...lab.containers.values()].sort((left, right) =>
    (left.nodeName || left.name).localeCompare(right.nodeName || right.name)
  );
}

export function topologyRefForNodeActions(
  lab: LabState,
  actionTopologyRef?: TopologyRef
): TopologyRef {
  return (
    actionTopologyRef ??
    buildStandaloneTopologyRefFromPath(
      lab.topologyPath || `${lab.name}.clab.yml`,
      lab.name,
      lab.endpointId
    )
  );
}

export function sshOpenedNotification(containers: ContainerState[]): string {
  if (containers.length > 1) {
    return `Opened SSH terminals for ${containers.length} nodes.`;
  }
  return `Opened SSH terminal for ${containers[0]?.nodeName || containers[0]?.name}.`;
}

export async function runLabShareAction(input: {
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

export function persistShareLink(input: {
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

export async function handleShareActionLink(
  kind: ShareActionKind,
  action: ShareLifecycleAction,
  link: string
): Promise<void> {
  if (!shareActionCanOpenLink(action)) {
    return;
  }
  if (!link) {
    runtimeUiActions.notify(
      `${kind.toUpperCase()} ${action} completed, but no share link was returned.`,
      "warning"
    );
    return;
  }

  await navigator.clipboard.writeText(link).catch(() => {});
  const shouldOpen = await confirmRuntimeAction({
    title: `${kind.toUpperCase()} Link Copied`,
    message: "The link was copied to clipboard.\n\nOpen link now?",
    confirmLabel: "Open Link"
  });
  if (shouldOpen) {
    window.open(link, "_blank", "noopener,noreferrer");
  }
}

export function deploymentStateFromContext(
  contextValue: string | undefined
): DeploymentState | undefined {
  if (contextValue?.includes("containerlabLabDeployed")) {
    return "deployed";
  }
  if (contextValue?.includes("containerlabLabUndeployed")) {
    return "undeployed";
  }
  return undefined;
}

export function nodeAccessProtocol(commandId: string): "shell" | "ssh" | "telnet" {
  if (commandId === "containerlab.node.attachShell") {
    return "shell";
  }
  if (commandId === "containerlab.node.telnet") {
    return "telnet";
  }
  return "ssh";
}

export function nodeAccessTitlePrefix(protocol: "shell" | "ssh" | "telnet"): string {
  if (protocol === "shell") {
    return "Shell";
  }
  if (protocol === "telnet") {
    return "Telnet";
  }
  return "SSH";
}

export interface StandaloneExplorerBridgeOptions {
  debounceMs: number;
  getEndpoints: () => EndpointConfig[];
  getLabs: () => Map<string, LabState>;
  invalidateTopologyFileListCache: (endpointId?: string) => void;
  defaultExpandExplorerTrees?: boolean;
  lifecycleActionsAvailable?: boolean;
  openFileEditor: (document: FileExplorerDocument & { title: string }) => Promise<void> | void;
  runLifecycle: (
    endpoint: LifecycleCommandEndpoint,
    topologyRef: TopologyRef,
    cleanup: boolean
  ) => Promise<void>;
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

export interface PopularLabRepo {
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
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null
    )
    .map((entry) => ({
      name: typeof entry.name === "string" ? entry.name : "",
      htmlUrl: typeof entry.html_url === "string" ? entry.html_url : "",
      description: typeof entry.description === "string" ? entry.description : "",
      stars: typeof entry.stargazers_count === "number" ? entry.stargazers_count : 0
    }))
    .filter((entry) => entry.name.length > 0 && entry.htmlUrl.length > 0);
}

export async function fetchPopularRepos(): Promise<PopularLabRepo[]> {
  try {
    const response = await fetch("/api/runtime/popular-repos", {
      credentials: "include"
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

export async function pickPopularRepo(promptTitle: string): Promise<string | undefined> {
  const repos = (await fetchPopularRepos()).slice(0, 12);
  if (repos.length === 0) {
    runtimeUiActions.notify("No popular repositories are available right now.", "warning");
    return undefined;
  }

  return promptForOptionSelection({
    title: promptTitle,
    message: "Choose a popular lab repository.",
    label: "Popular lab",
    confirmLabel: "Use Repository",
    options: repos.map((repo) => ({
      label: repo.name,
      description: `${repo.stars} stars` + (repo.description ? ` - ${repo.description}` : ""),
      value: repo.htmlUrl
    })),
    preferredValue: repos[0]?.htmlUrl
  });
}

export function triggerTextDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function triggerBlobDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function pickTransferFiles(accept = "", multiple = false): Promise<File[]> {
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

export async function promptArchiveFormat(): Promise<LabArchiveFormat | undefined> {
  const value = await promptForOptionSelection({
    title: "Archive Format",
    message: "Choose the archive format to download.",
    label: "Format",
    confirmLabel: "Download",
    options: [
      { label: "ZIP", value: "zip" },
      { label: "tar.gz", value: "tar.gz" }
    ],
    preferredValue: "zip"
  });
  if (value === "zip" || value === "tar.gz") {
    return value;
  }
  return undefined;
}

export function resolveArchiveLabFolder(input: {
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

export function extractFirstHttpLink(value: string): string | undefined {
  const match = value.match(/https?:\/\/[^\s"'<>]+/i);
  const link = match?.[0]?.trim();
  return link && link.length > 0 ? link : undefined;
}

export function describeBrowserPort(port: number): string {
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
    9200: "Elasticsearch"
  };
  return descriptions[port] ?? "";
}

export function fileParentPath(pathValue: string): string {
  const normalized = normalizePathValue(pathValue);
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

export function joinWorkspacePath(parentPath: string, childPath: string): string {
  const parent = normalizePathValue(parentPath);
  const child = normalizePathValue(childPath);
  return parent ? `${parent}/${child}` : child;
}
