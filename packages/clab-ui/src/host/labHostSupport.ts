/**
 * What a lab host can do. A backend kind (this machine, clab-api-server) has
 * static capabilities; its lab runtime (Docker, Podman, c9s) decides the
 * features. Every host gates its UI on `effectiveSupport` of both.
 */
import { parseLabHostIdentity, type LabHostIdentity } from "./labHostIdentity";
import type { C9sExposeType, LabRuntimeKind } from "./lifecycleOptions";

/** c9s: one namespace per lab (`c9s-<lab>`), or every lab in one namespace. */
export type LabHostNamespaceMode = "per-lab" | "fixed";

/** When an API Server pulls the Wireshark VNC image: before every session, when missing, never. */
export type WiresharkPullPolicy = "always" | "missing" | "never";

/** How a clab-api-server captures packets, as `GET /api/v1/lab-host` reports it. */
export interface LabHostCaptureInfo {
  /** The server runs Wireshark VNC sessions for the user's labs. */
  wiresharkVnc?: boolean;
  /** The container image of a Wireshark VNC session, with its tag. */
  wiresharkImage?: string;
  wiresharkPullPolicy?: WiresharkPullPolicy;
  /** Docker and Podman: the port of Edgeshark's packetflix endpoint on the server. */
  packetflixPort?: number;
  /** Docker and Podman: the names of the variables the Edgeshark containers get, without their values. */
  edgesharkEnv?: string[];
}

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
  /** c9s: the deploy defaults of the host; a clab-api-server's are its policy. */
  exposeType?: C9sExposeType;
  persistence?: boolean;
  /** c9s: the image pull secret every lab's pods get. */
  imagePullSecret?: string;
  /** c9s through a clab-api-server: the cluster it runs labs on. */
  cluster?: string;
  /** c9s through a clab-api-server: the namespace of a user's lab, e.g. `c9s-alice-{lab}`. */
  namespacePattern?: string;
  /** c9s through a clab-api-server: the namespace of a shared lab, e.g. `c9s-shared-{lab}`. */
  sharedNamespacePattern?: string;
  /** c9s through a clab-api-server: every lab namespace gets a resource quota. */
  labQuota?: boolean;
  /** c9s through a clab-api-server: labs deploy without clabernetes' Topology resource. */
  noTopologyCR?: boolean;
  /** A clab-api-server: how it captures packets (`GET /api/v1/lab-host`). */
  capture?: LabHostCaptureInfo;
  /**
   * The timeout containerlab gets on a deploy, redeploy, apply or destroy
   * without one, as a duration such as `10m`: containerlab's default for the
   * runtime on this machine, a clab-api-server's own (`GET /api/v1/lab-host`).
   * Unset on an API Server that does not report it.
   */
  defaultTimeout?: string;
  /**
   * The lab host is older than this app needs, e.g. a clab-api-server that
   * does not report its runtime. What it can do runs as before; the message
   * says what to update for the rest.
   */
  updateRequired?: string;
  /**
   * Why the lab host offers no Wireshark VNC although it could, e.g. a
   * cluster used from this machine without Docker here. UIs show the choice
   * disabled with this reason instead of hiding it.
   */
  wiresharkVncUnavailable?: string;
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
  /**
   * containerlab's `--timeout` on deploy, redeploy, apply and destroy: this
   * machine, and a clab-api-server that lists `lab-lifecycle-timeout`.
   */
  lifecycleTimeout: boolean;

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

/** The reason the UI gives for an option a Kubernetes (c9s) lab host lacks; it shows greyed out. */
export const NOT_ON_KUBERNETES = "Not supported on Kubernetes (c9s)";

/**
 * Why a Kubernetes lab host has no image management. Hosts show it instead of
 * the image manager, and lab hosts answer image requests (501) with it.
 */
export const KUBERNETES_IMAGE_MANAGEMENT_MESSAGE =
  "Image management is not supported on a Kubernetes lab host: the cluster's nodes pull the images themselves. " +
  "For a private registry, set an image pull secret.";

/** Why a lab host offers no image management, for hosts that tell the user. */
export function imageManagementUnavailableMessage(profile: LabHostProfile | undefined): string {
  return profile?.runtime === "c9s"
    ? KUBERNETES_IMAGE_MANAGEMENT_MESSAGE
    : "This lab host does not offer image management.";
}

/** The lab host of a topology or explorer item, as hosts hand it to the UI. */
export interface LabHostInfo {
  profile: LabHostProfile;
  support: LabHostSupport;
  /** Which lab host it is, for the toolbar's lab host chip; hosts that omit it show none. */
  host?: LabHostIdentity;
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
  "validate",
  "graphMermaid",
  "graphDot",
  "sshxReaders",
  "gottyOptions",
  "nodeStats",
  "terminalResume",
  "lifecycleTimeout",
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
/** What a lab host list entry keeps of a host's profile. */
export type LabHostProfileDetails = Pick<
  LabHostProfile,
  | "runtime"
  | "kubeContext"
  | "namespace"
  | "cluster"
  | "namespacePattern"
  | "exposeType"
  | "persistence"
  | "imagePullSecret"
  | "defaultTimeout"
  | "noTopologyCR"
  | "capture"
  | "updateRequired"
>;

/**
 * What the lab host lists of every app keep of a host's profile, for its
 * badge, card and settings page: one pick, so no app drops what an API
 * Server reports.
 */
export function labHostProfileDetails(profile: LabHostProfile): LabHostProfileDetails {
  const details: LabHostProfileDetails = { runtime: profile.runtime };
  for (const key of ["kubeContext", "namespace", "cluster", "namespacePattern", "imagePullSecret", "defaultTimeout", "updateRequired"] as const) {
    const value = profile[key];
    if (value !== undefined && value !== "") details[key] = value;
  }
  if (profile.exposeType !== undefined) details.exposeType = profile.exposeType;
  if (profile.persistence !== undefined) details.persistence = profile.persistence;
  if (profile.noTopologyCR !== undefined) details.noTopologyCR = profile.noTopologyCR;
  if (profile.capture !== undefined) details.capture = profile.capture;
  return details;
}

const PULL_POLICIES: readonly WiresharkPullPolicy[] = ["always", "missing", "never"];

/**
 * How a clab-api-server captures packets, from the `capture` of
 * `GET /api/v1/lab-host` or a host transport; undefined without one.
 */
export function parseLabHostCaptureInfo(value: unknown): LabHostCaptureInfo | undefined {
  if (!isObject(value)) return undefined;
  const capture: LabHostCaptureInfo = {};
  if (typeof value.wiresharkVnc === "boolean") capture.wiresharkVnc = value.wiresharkVnc;
  const image = optionalString(value.wiresharkImage);
  if (image !== undefined && image !== "") capture.wiresharkImage = image;
  const policy = optionalString(value.wiresharkPullPolicy)?.toLowerCase();
  const knownPolicy = PULL_POLICIES.find((candidate) => candidate === policy);
  if (knownPolicy !== undefined) capture.wiresharkPullPolicy = knownPolicy;
  // The server nests Edgeshark (`edgeshark.packetflixPort`); hosts pass it on flat.
  const edgeshark = isObject(value.edgeshark) ? value.edgeshark : value;
  const port = edgeshark.packetflixPort;
  if (typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535) capture.packetflixPort = port;
  const env = isObject(value.edgeshark) ? edgeshark.extraEnvVars : value.edgesharkEnv;
  if (Array.isArray(env)) {
    capture.edgesharkEnv = env.filter((name): name is string => typeof name === "string" && name.trim() !== "").map((name) => name.trim());
  }
  return Object.keys(capture).length > 0 ? capture : undefined;
}

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
  for (const key of ["imagePullSecret", "cluster", "namespacePattern", "sharedNamespacePattern", "defaultTimeout"] as const) {
    const text = optionalString(raw[key]);
    if (text) profile[key] = text;
  }
  if (typeof raw.labQuota === "boolean") profile.labQuota = raw.labQuota;
  if (typeof raw.noTopologyCR === "boolean") profile.noTopologyCR = raw.noTopologyCR;
  const capture = parseLabHostCaptureInfo(raw.capture);
  if (capture) profile.capture = capture;
  const updateRequired = optionalString(raw.updateRequired);
  if (updateRequired) profile.updateRequired = updateRequired;
  const wiresharkVncUnavailable = optionalString(raw.wiresharkVncUnavailable);
  if (wiresharkVncUnavailable) profile.wiresharkVncUnavailable = wiresharkVncUnavailable;
  const supportRecord = value.support;
  const support = Object.fromEntries(
    BOOLEAN_KEYS.map((key) => [key, supportRecord[key] === true])
  ) as unknown as LabHostSupport;
  const host = parseLabHostIdentity(value.host);
  return { profile, support, ...(host ? { host } : {}) };
}

/** How the UI names a lab host's runtime, e.g. "Kubernetes · lab-prod/c9s-demo". */
export function labHostRuntimeLabel(profile: LabHostProfile, labNamespace?: string): string {
  if (profile.runtime !== "c9s") return profile.runtime === "podman" ? "Podman" : "Docker";
  const namespace = labNamespace ?? profile.namespace;
  const where = [profile.kubeContext ?? profile.cluster, namespace].filter(Boolean).join("/");
  return where ? `Kubernetes · ${where}` : "Kubernetes";
}

/**
 * One check of a lab host, as "Check connection" lists it: what was checked,
 * whether it passed, what was found and, for a failure, what to do.
 */
export interface LabHostCheck {
  /** Stable id, e.g. `containerlab`, `kubeconfig`, `cluster`, `clabernetes`, `access:pods/exec`. */
  id: string;
  /** What is checked, e.g. "containerlab 0.83.0 or newer". */
  label: string;
  /** `skipped` when an earlier check failed and this one could not run. */
  status: "ok" | "failed" | "skipped";
  /** What was found: a version, or what went wrong. */
  message?: string;
  /** What to do about a failure. */
  fix?: string;
  /** A command that fixes the failure, shown to copy, e.g. `kubectl create rolebinding …`. */
  command?: string;
}

/** The first check that failed, for a lab host's status line. */
export function firstFailedCheck(checks: readonly LabHostCheck[] | undefined): LabHostCheck | undefined {
  return checks?.find((check) => check.status === "failed");
}
