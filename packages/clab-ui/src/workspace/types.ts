import type { TopologyRef } from "../session";
import type { LabHostCheck } from "../host/labHostSupport";
import type { C9sExposeType } from "../host/lifecycleOptions";

/** Brand assets used by the shared workspace views; every host serves all of them. */
export const WORKSPACE_ASSETS = [
  "containerlab.svg",
  "containerlab-animated.svg",
  "clab-animated-no-logo.svg"
] as const;

export type WorkspaceAsset = (typeof WORKSPACE_ASSETS)[number];

export interface RuntimeTargetRequest {
  endpointId?: string;
  sessionId?: string;
  topologyRef?: TopologyRef;
}

export interface InspectContainerInfo {
  name: string;
  containerId: string;
  image: string;
  kind: string;
  state: string;
  status: string;
  ipv4Address: string;
  ipv6Address: string;
  labName: string;
  labPath: string;
  absLabPath: string;
  nodeName: string;
  group: string;
  owner: string;
}

export type InspectAllLabsResponse = Record<string, InspectContainerInfo[]>;
export type InspectLabResponse = InspectContainerInfo[];

export interface IconImportResponse {
  imported: number;
  renamed: Record<string, string>;
}

export interface NetemFields {
  delay: string;
  jitter: string;
  loss: string;
  rate: string;
  corruption: string;
}

export interface FileExplorerEntry {
  endpointId: string;
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  modifiedAt?: string;
  hasChildren?: boolean;
  labName?: string;
  deploymentState?: string;
  topologyRef?: TopologyRef;
}

export interface FileExplorerDocument {
  endpointId: string;
  path: string;
  content: string;
}

/** A topology template as containerlab renders it, for the read-only preview. */
export interface RenderedTopologyPreview {
  /** Topology YAML after the template and environment variables are expanded. */
  content: string;
  labName?: string;
  /** Template variable files used, relative to the topology directory. */
  varsFiles?: string[];
  /** Why containerlab rejects the rendered topology, when it does. */
  error?: string;
}

export type LabArchiveFormat = "zip" | "tar.gz";

export interface BinaryDownloadResult {
  blob: Blob;
  contentType: string;
  filename: string;
}

export interface DeployLabFromUrlResponse {
  success: boolean;
  labNames: string[];
}

export interface ImportTopologyFromUrlResponse {
  success: boolean;
  topologyRef: TopologyRef;
  labName: string;
  fileName: string;
}

export type NodeLifecycleAction = "start" | "stop" | "restart" | "pause" | "unpause";

export interface ContainerState {
  endpointId: string;
  name: string;
  containerId: string;
  labName: string;
  labPath: string;
  owner: string;
  nodeName: string;
  kind: string;
  image: string;
  state: string;
  status: string;
  ipv4Address: string;
  ipv6Address: string;
  interfaces: Map<string, InterfaceState>;
}

export interface InterfaceState {
  name: string;
  alias: string;
  label: string;
  state: string;
  type: string;
  mac: string;
  mtu: string;
  ifIndex?: string;
  rxBps?: string;
  txBps?: string;
  rxPps?: string;
  txPps?: string;
  rxBytes?: string;
  txBytes?: string;
  rxPackets?: string;
  txPackets?: string;
  statsIntervalSeconds?: string;
  netemDelay?: string;
  netemJitter?: string;
  netemLoss?: string;
  netemRate?: string;
  netemCorruption?: string;
}

export interface LabState {
  endpointId: string;
  name: string;
  owner: string;
  topologyPath: string;
  containers: Map<string, ContainerState>;
}

export type InterfaceNetemPatch = Partial<Pick<InterfaceState, "netemDelay" | "netemJitter" | "netemLoss" | "netemRate" | "netemCorruption">>;
/**
 * `api` is a clab-api-server; `local` runs labs with containerlab on the app's
 * machine. The same as `EndpointKind` in the app contract, which a type test
 * keeps identical; this published library cannot depend on that package.
 */
export type EndpointKind = "api" | "local";

/** The lab runtime of a lab host, for its badge. */
export type EndpointRuntime = "docker" | "podman" | "c9s";

export interface EndpointConfig {
  id: string;
  /** Missing on endpoints from before endpoint kinds, which are all `api`. */
  kind?: EndpointKind;
  /** What runs the host's labs, once the host answered. */
  runtime?: EndpointRuntime;
  /** c9s on this machine: the kubeconfig context. */
  kubeContext?: string;
  /** c9s on this machine: the kubeconfig file, when the host names one. */
  kubeconfig?: string;
  /** c9s: the namespace of every lab, when the host has one. */
  namespace?: string;
  /** c9s: the deploy defaults of the host; a lab server's are its policy. */
  exposeType?: C9sExposeType;
  persistence?: boolean;
  imagePullSecret?: string;
  /** c9s through a lab server: the cluster it runs labs on. */
  cluster?: string;
  /** c9s through a lab server: the namespace of a user's lab, e.g. `c9s-alice-{lab}`. */
  namespacePattern?: string;
  /** The checks of a lab host on this machine, from its last check. */
  checks?: LabHostCheck[];
  /** A Kubernetes cluster lab host the user may edit and remove in this app. */
  editable?: boolean;
  /** The lab host is older than the app needs, and what to update. */
  updateRequired?: string;
  url: string;
  label: string;
  username: string;
  sessionDuration: EndpointSessionDuration;
  status: EndpointStatus;
  connected: boolean;
}

export type EndpointStatus = "connected" | "session_expired" | "offline" | "saved";

/** The live-events stream of one lab host. */
export interface EndpointEventStreamStatus {
  state: "connected" | "connecting" | "reconnecting" | "paused";
  /** When the next attempt starts, for a countdown. */
  retryAt?: number;
  /** The last error the stream reported. */
  error?: string;
}

/** A lab host with a connection problem, as the connection banner shows it. */
export interface EndpointConnectionIssue {
  endpointId: string;
  label: string;
  /** Whether the lab host's API answers, as the app server last checked it. */
  api: "reachable" | "unreachable" | "session_expired";
  /** Missing where the host offers no live events, such as the browser sandbox. */
  events?: EndpointEventStreamStatus;
}

/**
 * Labs on the app's own machine, which hosts that can run containerlab there
 * offer (the desktop app on Linux). It needs no URL or sign-in.
 */
export interface LocalEndpointOffer {
  /** The `local://…` address of this local lab host; the app's first one when unset. */
  url?: string;
  /** containerlab and the container runtime are ready for this user. */
  available: boolean;
  /** What is missing, each with how to fix it. */
  problems: string[];
  /** Every check of the last look, for "Check connection". */
  checks?: LabHostCheck[];
  /** The containerlab version found on this machine. */
  containerlabVersion?: string;
  /** How the app names this machine; "This computer" when unset. */
  label?: string;
  /** Docs page that explains how to set this machine up. */
  setupUrl?: string;
  /** The action that adds this machine; "Use this computer" when unset. */
  addLabel?: string;
  onAdd: () => Promise<void>;
  /** Looks for containerlab again, after the user fixed a problem. */
  onCheckAgain?: () => Promise<void>;
}
/** A Kubernetes cluster lab host as the user sets it up: containerlab on this machine runs its labs. */
export interface ClusterHostSettings {
  label?: string;
  /** The kubeconfig file; the app's default kubeconfig when unset. */
  kubeconfig?: string;
  kubeContext: string;
  /** The namespace of every lab; one namespace per lab (`c9s-<lab>`) when unset. */
  namespace?: string;
  exposeType?: C9sExposeType;
  /** False: nodes keep no state across restarts (`--no-persistence`). */
  persistence?: boolean;
  imagePullSecret?: string;
}

/** A context of a kubeconfig, for the context list of the cluster form. */
export interface KubeContextChoice {
  name: string;
  cluster: string;
  namespace?: string;
  current: boolean;
}

/** The contexts of a kubeconfig file, or why it does not load. */
export interface KubeconfigContextList {
  kubeconfig: string;
  contexts: KubeContextChoice[];
  error?: string;
}

/**
 * How an app adds, edits and checks Kubernetes cluster lab hosts. Apps that
 * cannot (the web app, where the browser never handles a kubeconfig) leave
 * it out and say why instead.
 */
export interface ClusterHostsSupport {
  /** The kubeconfig a cluster without its own file reads, e.g. `~/.kube/config`. */
  defaultKubeconfig?: string;
  /** The contexts of a kubeconfig file; of the default one when unset. */
  listContexts(kubeconfig?: string): Promise<KubeconfigContextList>;
  /** The app's file dialog for a kubeconfig; undefined when cancelled. Without it the path is typed in. */
  chooseKubeconfig?(): Promise<string | undefined>;
  /** Runs the checks of settings that are not saved yet. */
  check(settings: ClusterHostSettings): Promise<LabHostCheck[]>;
  /** Saves a new cluster lab host, or the edited one with `endpointId`. */
  save(settings: ClusterHostSettings, endpointId?: string): Promise<void>;
}

/** What an app adds to "Add lab host" beyond lab servers: clusters, checks, and why a kind is not offered. */
export interface LabHostSetupProps {
  /** Checks a lab host on this machine again and answers with each check ("Check connection"). */
  onCheckEndpoint?: (endpointId: string) => Promise<LabHostCheck[]>;
  /** How this app adds, edits and checks Kubernetes clusters; without it they cannot be added here. */
  clusterHosts?: ClusterHostsSupport;
  /** Why clusters cannot be added in this app, and what to do instead. */
  clustersUnavailable?: string;
  /** Why "This computer" cannot run labs in this app, when there is no local offer. */
  thisComputerUnavailable?: string;
}

export type EndpointSessionDuration = string;
export interface EndpointImportResult { added: number; duplicates: number; total: number; unchanged: number; updated: number; }
export interface EndpointHealthMetrics {
  serverInfo: {
    version: string;
    uptime: string;
    startTime: string;
  };
  metrics: {
    cpu?: {
      usagePercent: number;
      numCPU: number;
      loadAvg1?: number;
      loadAvg5?: number;
      loadAvg15?: number;
      processPercent?: number;
    };
    mem?: {
      totalMem: number;
      usedMem: number;
      availableMem: number;
      usagePercent: number;
      processMemMB?: number;
      processMemPct?: number;
    };
    disk?: {
      path: string;
      totalDisk: number;
      usedDisk: number;
      freeDisk: number;
      usagePercent: number;
    };
  };
}

export type TerminalProtocol = "ssh" | "shell" | "telnet";

export interface TerminalSessionInfo {
  sessionId: string;
  username: string;
  labName: string;
  nodeName: string;
  protocol: TerminalProtocol;
  state: string;
  createdAt: string;
  expiresAt: string;
  lastActivity: string;
  exitCode?: number | null;
  error?: string;
}

export interface LogsResponse {
  containerName: string;
  logs: string;
}

/** One line of a node's container log. */
export interface NodeLogLine {
  line: string;
  /** The container output the line came from, when the lab host tells. */
  stream?: "stdout" | "stderr";
}

export interface VersionResponse {
  versionInfo: string;
}

export interface VersionCheckResponse {
  checkResult: string;
}

export interface EdgeSharkStatusResponse {
  running: boolean;
  version?: string;
  packetflixPort: number;
  runtime: string;
}
