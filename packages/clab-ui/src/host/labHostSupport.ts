/**
 * What a lab host can do. A backend kind (this machine, clab-api-server) has
 * static capabilities; its lab runtime (Docker, Podman, c9s) decides the
 * features. Every host gates its UI on `effectiveSupport` of both.
 */
import type { C9sExposeType, LabRuntimeKind } from "./lifecycleOptions";

/** c9s: one namespace per lab (`c9s-<lab>`), or every lab in one namespace. */
export type LabHostNamespaceMode = "per-lab" | "fixed";

/** What runs labs on a lab host. */
export interface LabHostProfile {
  runtime: LabRuntimeKind;
  /** c9s on this machine: the kubeconfig context. */
  kubeContext?: string;
  /** c9s on this machine: the kubeconfig file, when the host names one. */
  kubeconfig?: string;
  namespaceMode?: LabHostNamespaceMode;
  /** c9s with `namespaceMode: "fixed"`: the namespace of every lab. */
  namespace?: string;
  /** c9s on this machine: the deploy defaults of the host. */
  exposeType?: C9sExposeType;
  persistence?: boolean;
  /**
   * The lab host is older than this app needs, e.g. a clab-api-server that
   * does not report its runtime. What it can do runs as before; the message
   * says what to update for the rest.
   */
  updateRequired?: string;
}

/**
 * What a backend kind can do, whatever runtime the lab host has. Combine it
 * with `features()` through `effectiveSupport` before offering anything.
 */
export interface LabBackendCapabilities {
  /** Temporary SSH access to a node through a port the lab host forwards. */
  sshAccess: boolean;
  /** Deploy a lab straight from a Git or HTTP URL. */
  deployFromUrl: boolean;
  /** Copy a topology from a Git or HTTP URL into the workspace. */
  importFromUrl: boolean;
  /** Install and remove Edgeshark on the lab host. */
  edgesharkManagement: boolean;
  /** Wireshark in a browser window, through one VNC container per capture. */
  wiresharkVnc: boolean;
  /** CPU, memory and disk usage of the lab host. */
  healthMetrics: boolean;
  /** The `@shared/` workspace folder for labs that several users edit. */
  sharedWorkspace: boolean;
  /** The Tailscale devices of a running lab (`mgmt.tailscale`). */
  tailscaleStatus: boolean;
  /**
   * Single-use `packetflix:` links to the lab host's own capture stream
   * (clab-api-server). Needs the `captureStream` feature.
   */
  captureTickets: boolean;
}

/**
 * Operations a lab host may lack although the backend kind has them, e.g. an
 * older clab-api-server. Hosts ask before offering them.
 */
export interface LabBackendFeatures {
  /** `containerlab validate`. */
  validate: boolean;
  /** `containerlab graph --mermaid`. */
  graphMermaid: boolean;
  /** `containerlab graph --dot`. */
  graphDot: boolean;
  /** Read-only sshx links. */
  sshxReaders: boolean;
  /** GoTTY credentials and shell. */
  gottyOptions: boolean;
  /** CPU and memory usage of a lab's nodes (`streamLabStats`). */
  nodeStats: boolean;
  /** Terminal sessions that keep running when the client disconnects, and replay their output. */
  terminalResume: boolean;

  // Features of the lab runtime. Docker and Podman have them; c9s does not.

  /** List, pull and remove the runtime's images. */
  imageManagement: boolean;
  /** Link impairments (`tools netem`). */
  netem: boolean;
  /** VM snapshots: `tools snapshot save` and deploy restore. */
  snapshots: boolean;
  /** Pause and unpause single nodes. */
  nodePause: boolean;
  /** `fcli` reports over the lab's nodes. */
  fcli: boolean;
  /** `containerlab inspect interfaces`. */
  interfaceInspect: boolean;
  /** Edgeshark capture (Packetflix links and Wireshark VNC) and its management. */
  edgeshark: boolean;
  /** CPU, memory and disk usage of the lab host. */
  hostMetrics: boolean;
  /** The Tailscale devices of a running lab. */
  tailscale: boolean;
  /** sshx and GoTTY sessions (`tools sshx|gotty`). */
  shareTools: boolean;
  /** Capture on the lab host itself: tcpdump in a node's network namespace. */
  hostCapture: boolean;

  // Features of c9s lab hosts.

  /** Kubernetes manifests of a topology (`exportManifests`). */
  manifestExport: boolean;
  /** The c9s deploy options of `LabLifecycleOptions` (namespace, exposure, persistence). */
  c9sDeployOptions: boolean;
  /**
   * Packet capture as one pcapng stream of lab-link interfaces, with their
   * link peers (`captureInterfaces`, `openCaptureStream`): c9s lab hosts.
   */
  captureStream: boolean;
  /**
   * Wireshark VNC sessions fed by the lab host's capture stream instead of
   * Edgeshark: a c9s clab-api-server that runs Docker next to it.
   */
  captureVnc: boolean;
}

/** What a lab host offers: its backend kind's capabilities narrowed by its runtime's features. */
export interface LabHostSupport extends LabBackendCapabilities, LabBackendFeatures {}

/**
 * What a lab host offers: the static capabilities of its backend kind,
 * narrowed by the features of its runtime. The one place that decides it, so
 * every host hides the same actions.
 */
export function effectiveSupport(
  capabilities: LabBackendCapabilities,
  features: LabBackendFeatures
): LabHostSupport {
  return {
    ...features,
    sshAccess: capabilities.sshAccess,
    deployFromUrl: capabilities.deployFromUrl,
    importFromUrl: capabilities.importFromUrl,
    sharedWorkspace: capabilities.sharedWorkspace,
    edgesharkManagement: capabilities.edgesharkManagement && features.edgeshark,
    // The Wireshark VNC containers read their capture from Edgeshark, or from the host's capture stream.
    wiresharkVnc: capabilities.wiresharkVnc && (features.edgeshark || features.captureVnc),
    captureTickets: capabilities.captureTickets && features.captureStream,
    healthMetrics: capabilities.healthMetrics && features.hostMetrics,
    tailscaleStatus: capabilities.tailscaleStatus && features.tailscale
  };
}

/** The features of a lab runtime that Docker and Podman have and c9s lacks. */
export type ContainerRuntimeFeature =
  | "imageManagement"
  | "netem"
  | "snapshots"
  | "nodePause"
  | "fcli"
  | "interfaceInspect"
  | "edgeshark"
  | "hostMetrics"
  | "tailscale"
  | "shareTools"
  | "hostCapture";

/** The runtime features of a Docker or Podman host (`true`) or a c9s host (`false`). */
export function containerRuntimeFeatures(
  containerRuntime: boolean
): Pick<LabBackendFeatures, ContainerRuntimeFeature> {
  return {
    imageManagement: containerRuntime,
    netem: containerRuntime,
    snapshots: containerRuntime,
    nodePause: containerRuntime,
    fcli: containerRuntime,
    interfaceInspect: containerRuntime,
    edgeshark: containerRuntime,
    hostMetrics: containerRuntime,
    tailscale: containerRuntime,
    shareTools: containerRuntime,
    hostCapture: containerRuntime
  };
}

/** The lab host of a topology or explorer item, as hosts hand it to the UI. */
export interface LabHostInfo {
  profile: LabHostProfile;
  support: LabHostSupport;
}

const BOOLEAN_KEYS: readonly (keyof LabHostSupport)[] = [
  "sshAccess",
  "deployFromUrl",
  "importFromUrl",
  "edgesharkManagement",
  "wiresharkVnc",
  "healthMetrics",
  "sharedWorkspace",
  "tailscaleStatus",
  "captureTickets",
  "validate",
  "graphMermaid",
  "graphDot",
  "sshxReaders",
  "gottyOptions",
  "nodeStats",
  "terminalResume",
  "imageManagement",
  "netem",
  "snapshots",
  "nodePause",
  "fcli",
  "interfaceInspect",
  "edgeshark",
  "hostMetrics",
  "tailscale",
  "shareTools",
  "hostCapture",
  "manifestExport",
  "c9sDeployOptions",
  "captureStream",
  "captureVnc"
];

const RUNTIMES: readonly LabRuntimeKind[] = ["docker", "podman", "c9s"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Lab host info from a host transport. Anything missing or malformed is
 * unsupported, so a host that sends nothing hides what depends on it.
 */
export function parseLabHostInfo(value: unknown): LabHostInfo | undefined {
  if (!isObject(value) || !isObject(value.profile) || !isObject(value.support)) return undefined;
  const runtime = value.profile.runtime;
  if (typeof runtime !== "string" || !(RUNTIMES as readonly string[]).includes(runtime)) return undefined;
  const raw = value.profile;
  const profile: LabHostProfile = { runtime: runtime as LabRuntimeKind };
  const kubeContext = optionalString(raw.kubeContext);
  if (kubeContext) profile.kubeContext = kubeContext;
  const kubeconfig = optionalString(raw.kubeconfig);
  if (kubeconfig) profile.kubeconfig = kubeconfig;
  if (raw.namespaceMode === "per-lab" || raw.namespaceMode === "fixed") profile.namespaceMode = raw.namespaceMode;
  const namespace = optionalString(raw.namespace);
  if (namespace) profile.namespace = namespace;
  const exposeType = optionalString(raw.exposeType);
  if (exposeType === "ClusterIP" || exposeType === "Headless" || exposeType === "LoadBalancer" || exposeType === "None") {
    profile.exposeType = exposeType;
  }
  if (typeof raw.persistence === "boolean") profile.persistence = raw.persistence;
  const updateRequired = optionalString(raw.updateRequired);
  if (updateRequired) profile.updateRequired = updateRequired;
  const supportRecord = value.support;
  const support = Object.fromEntries(
    BOOLEAN_KEYS.map((key) => [key, supportRecord[key] === true])
  ) as unknown as LabHostSupport;
  return { profile, support };
}

/** How the UI names a lab host's runtime, e.g. "Kubernetes · lab-prod/c9s-demo". */
export function labHostRuntimeLabel(profile: LabHostProfile, labNamespace?: string): string {
  if (profile.runtime !== "c9s") return profile.runtime === "podman" ? "Podman" : "Docker";
  const namespace = labNamespace ?? profile.namespace;
  const where = [profile.kubeContext, namespace].filter(Boolean).join("/");
  return where ? `Kubernetes · ${where}` : "Kubernetes";
}
