/**
 * The settings of one lab host, as every app's settings show them under
 * "Lab hosts": the same sections for each host (Containerlab, Connection,
 * Deploy defaults, Capture), and for each setting whether it applies to that
 * kind of host, is set by an API Server, or is greyed out with the reason.
 * The one source for that matrix; the apps only store and read the values.
 */
import { CAPTURE_METHODS, CAPTURE_METHOD_LABELS } from "./captureMethod";
import { KUBERNETES_LIMITS } from "./kubernetesLimits";
import { LAB_RUNTIME_NAMES } from "./labHostIdentity";
import type { LabHostProfile } from "./labHostSupport";
import {
  C9S_EXPOSE_TYPES,
  isValidKubeSecretName,
  isValidLifecycleTimeout,
  type LabRuntimeKind
} from "./lifecycleOptions";

/** Where labs run: this computer (Docker or Podman), a Kubernetes cluster used from here, or an API Server. */
export type LabHostSettingsKind = "this-computer" | "cluster" | "server";

export type LabHostSettingId =
  // Containerlab
  | "runtime"
  | "socket"
  | "binaryPath"
  // Connection
  | "kubeconfig"
  | "namespaces"
  // Deploy defaults
  | "timeout"
  | "exposeType"
  | "persistence"
  | "imagePullSecret"
  | "noTopologyCR"
  | "deployArgs"
  | "destroyArgs"
  // Capture
  | "captureMethod"
  | "wiresharkImage"
  | "wiresharkPullPolicy"
  | "vncHostname"
  | "edgeshark"
  | "captureHostname"
  | "packetflixPort"
  | "edgesharkEnv";

export type LabHostSettingSectionId = "containerlab" | "connection" | "deploy" | "capture";

export interface LabHostSettingSection {
  id: LabHostSettingSectionId;
  title: string;
  settings: readonly LabHostSettingId[];
}

/** The sections of every lab host page, in order. */
export const LAB_HOST_SETTING_SECTIONS: readonly LabHostSettingSection[] = [
  { id: "containerlab", title: "Containerlab", settings: ["runtime", "socket", "binaryPath"] },
  { id: "connection", title: "Connection", settings: ["kubeconfig", "namespaces"] },
  {
    id: "deploy",
    title: "Deploy defaults",
    settings: ["timeout", "exposeType", "persistence", "imagePullSecret", "noTopologyCR", "deployArgs", "destroyArgs"]
  },
  {
    id: "capture",
    title: "Capture",
    settings: [
      "captureMethod",
      "wiresharkImage",
      "wiresharkPullPolicy",
      "vncHostname",
      "edgeshark",
      "captureHostname",
      "packetflixPort",
      "edgesharkEnv"
    ]
  }
];

/** A value of a lab host setting: text, a choice, a number or a switch. */
export type LabHostSettingValue = string | number | boolean;

export type LabHostSettingControl =
  | { type: "text"; monospace?: boolean }
  | { type: "number"; min: number; max: number }
  | { type: "switch" }
  | { type: "select"; options: readonly { value: string; label: string }[] }
  /** Drawn by the page itself: the cluster form, Edgeshark's status and buttons. */
  | { type: "custom" };

export interface LabHostSettingDefinition {
  id: LabHostSettingId;
  title: string;
  description: string;
  control: LabHostSettingControl;
  /** What is wrong with a value; undefined when it is fine. */
  validate?: (value: LabHostSettingValue) => string | undefined;
}

function textOf(value: LabHostSettingValue): string {
  return typeof value === "string" ? value.trim() : String(value);
}

const PORT_ERROR = "A port from 1 to 65535";

export const LAB_HOST_SETTINGS: Readonly<Record<LabHostSettingId, LabHostSettingDefinition>> = {
  runtime: {
    id: "runtime",
    title: "Container runtime",
    description: "What runs the labs: Docker or Podman, or Kubernetes (c9s).",
    control: {
      type: "select",
      options: [
        { value: "docker", label: "Docker" },
        { value: "podman", label: "Podman" }
      ]
    }
  },
  socket: {
    id: "socket",
    title: "Container socket",
    description: "The Docker or Podman API socket, e.g. /run/user/1000/podman/podman.sock for Podman.",
    control: { type: "text", monospace: true }
  },
  binaryPath: {
    id: "binaryPath",
    title: "containerlab binary",
    description: "containerlab on this computer; looked up on PATH when empty.",
    control: { type: "text", monospace: true }
  },
  kubeconfig: {
    id: "kubeconfig",
    title: "Cluster",
    description: "The kubeconfig file and context: which cluster, and as whom.",
    control: { type: "custom" }
  },
  namespaces: {
    id: "namespaces",
    title: "Namespaces",
    description: "One namespace per lab, or one fixed namespace for every lab.",
    control: { type: "custom" }
  },
  timeout: {
    id: "timeout",
    title: "Timeout",
    description:
      "How long containerlab waits for a deploy, e.g. 30m. A lab's own timeout (Lab settings, Deploy) wins.",
    control: { type: "text" },
    validate: (value) =>
      textOf(value) === "" || isValidLifecycleTimeout(textOf(value)) ? undefined : "A duration such as 90s, 30m or 1h"
  },
  exposeType: {
    id: "exposeType",
    title: "Port exposure",
    description: "How clabernetes makes node ports reachable.",
    control: {
      type: "select",
      options: C9S_EXPOSE_TYPES.map((type) => ({ value: type, label: type }))
    }
  },
  persistence: {
    id: "persistence",
    title: "Persistent node storage",
    description: "Nodes keep saved configuration and files when their pod is replaced.",
    control: { type: "switch" }
  },
  imagePullSecret: {
    id: "imagePullSecret",
    title: "Image pull secret",
    description: "A Secret for private registries that every lab's pods get.",
    control: { type: "text", monospace: true },
    validate: (value) =>
      textOf(value) === "" || isValidKubeSecretName(textOf(value))
        ? undefined
        : "Lowercase letters, digits, '-' and '.' only"
  },
  noTopologyCR: {
    id: "noTopologyCR",
    title: "Without a Topology resource",
    description: "Create the nodes directly, without clabernetes' Topology resource.",
    control: { type: "switch" }
  },
  deployArgs: {
    id: "deployArgs",
    title: "Deploy arguments",
    description: "Added to every containerlab deploy and redeploy.",
    control: { type: "text", monospace: true }
  },
  destroyArgs: {
    id: "destroyArgs",
    title: "Destroy arguments",
    description: "Added to every containerlab destroy.",
    control: { type: "text", monospace: true }
  },
  captureMethod: {
    id: "captureMethod",
    title: "Default capture method",
    description: "Where a capture opens. When the lab host lacks it, captures open the automatic way and say why.",
    control: {
      type: "select",
      options: CAPTURE_METHODS.map((method) => ({ value: method, label: CAPTURE_METHOD_LABELS[method] }))
    }
  },
  wiresharkImage: {
    id: "wiresharkImage",
    title: "Wireshark VNC image",
    description: "The container image of Wireshark in a browser window, with its tag.",
    control: { type: "text", monospace: true }
  },
  wiresharkPullPolicy: {
    id: "wiresharkPullPolicy",
    title: "Wireshark VNC image pull",
    description: "When the Wireshark VNC image is pulled.",
    control: {
      type: "select",
      options: [
        { value: "always", label: "Always" },
        { value: "missing", label: "When missing" },
        { value: "never", label: "Never" }
      ]
    }
  },
  vncHostname: {
    id: "vncHostname",
    title: "Wireshark VNC hostname",
    description: "The host Wireshark VNC captures name in their packetflix link; localhost when empty.",
    control: { type: "text", monospace: true }
  },
  edgeshark: {
    id: "edgeshark",
    title: "Edgeshark",
    description: "Edgeshark on the lab host: its status, install and uninstall.",
    control: { type: "custom" }
  },
  captureHostname: {
    id: "captureHostname",
    title: "Capture hostname",
    description: "The host packetflix links name, an IP address or DNS name; found automatically when empty.",
    control: { type: "text", monospace: true }
  },
  packetflixPort: {
    id: "packetflixPort",
    title: "Packetflix port",
    description: "The port of Edgeshark's packetflix endpoint.",
    control: { type: "number", min: 1, max: 65535 },
    validate: (value) => {
      const port = Number(value);
      return Number.isInteger(port) && port >= 1 && port <= 65535 ? undefined : PORT_ERROR;
    }
  },
  edgesharkEnv: {
    id: "edgesharkEnv",
    title: "Edgeshark environment",
    description: "Comma-separated variables for the Edgeshark containers, e.g. HTTP_PROXY=, NO_PROXY=localhost.",
    control: { type: "text", monospace: true }
  }
};

/** What an app knows about one setting of the host. */
export interface LabHostSettingRow {
  /** The host's own value; undefined when it follows the default. */
  value?: LabHostSettingValue;
  /** What applies without a value of its own, e.g. "2m (containerlab default)". */
  defaultLabel?: string;
  /** The value to show when the setting is read-only here. */
  shown?: string;
  /** Read-only in this app, and why, e.g. "Set by the app's configuration". */
  fixed?: string;
  /** Choices this host lacks, with why; they show disabled. */
  unavailableOptions?: Partial<Record<string, string>>;
  /** A hint under the control. */
  note?: string;
}

export type LabHostSettingRows = Partial<Record<LabHostSettingId, LabHostSettingRow>>;

/** The lab host a page shows, as far as the matrix needs it. */
export interface LabHostSettingsSubject {
  kind: LabHostSettingsKind;
  /** What runs the labs, once known; an API Server tells after sign-in. */
  runtime?: LabRuntimeKind;
  /**
   * A Kubernetes lab host this app can change. False for one from the app's
   * configuration (`WEB_LOCAL_*`, `CONTAINERLAB_DESKTOP_*`).
   */
  editable?: boolean;
  /** What an API Server reports about itself (`GET /api/v1/lab-host`). */
  server?: Partial<
    Pick<
      LabHostProfile,
      | "cluster"
      | "namespacePattern"
      | "exposeType"
      | "persistence"
      | "imagePullSecret"
      | "defaultTimeout"
      | "noTopologyCR"
      | "capture"
    >
  >;
}

/** "Set by the API Server": its own value, read-only in the app. */
export const SET_BY_API_SERVER = "Set by the API Server";
/** A Kubernetes lab host from the app's configuration. */
export const SET_BY_APP_CONFIGURATION = "Set by the app's configuration";

/**
 * How a setting shows on a lab host's page:
 * - `edit`: the user sets it for this host;
 * - `unsupported`: greyed out with the reason;
 * - `server`: the API Server's own value, read-only, with "Set by the API Server";
 *   without a value (signed out, or a server too old to report it) `note` says why;
 * - `fixed`: read-only, set elsewhere (the app's configuration, This computer).
 */
export type LabHostSettingAccess =
  | { access: "edit" }
  | { access: "unsupported"; reason: string }
  | { access: "server"; value?: string; reason: string; note?: string }
  | { access: "fixed"; reason: string };

const ONLY_KUBERNETES = "Only for Kubernetes lab hosts.";
/** Why an API Server's value is missing: not signed in yet, or a server that does not report it. */
const SIGN_IN_TO_SEE = "Sign in to see what it sets.";
const NOT_REPORTED_BY_SERVER = "This API Server does not report it; update it to see the value here.";

const THIS_COMPUTER_ONLY: Partial<Record<LabHostSettingId, { cluster: string; server: string }>> = {
  runtime: {
    cluster: "Not on Kubernetes: the cluster runs the nodes as pods, and containerlab deploys with -r c9s.",
    server: SET_BY_API_SERVER
  },
  socket: {
    cluster: "Not on Kubernetes: containerlab reaches the cluster through the kubeconfig.",
    server: "The API Server reaches its own container runtime."
  }
};

const KUBERNETES_SETTINGS = new Set<LabHostSettingId>([
  "kubeconfig",
  "namespaces",
  "exposeType",
  "persistence",
  "imagePullSecret",
  "noTopologyCR"
]);

/** Edgeshark and what only its packetflix links use. */
const EDGESHARK_SETTINGS = new Set<LabHostSettingId>(["edgeshark", "captureHostname", "packetflixPort", "edgesharkEnv"]);

function onOff(value: boolean | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value ? "On" : "Off";
}

/** A choice's label, e.g. "When missing" for the pull policy `missing`. */
function optionLabel(id: LabHostSettingId, value: string): string {
  const control = LAB_HOST_SETTINGS[id].control;
  return control.type === "select" ? (control.options.find((option) => option.value === value)?.label ?? value) : value;
}

type ServerReport = NonNullable<LabHostSettingsSubject["server"]>;

/** How the page shows each value an API Server reports; the others it does not report. */
const SERVER_VALUES: Partial<Record<LabHostSettingId, (server: ServerReport, subject: LabHostSettingsSubject) => string | undefined>> = {
  runtime: (_server, subject) => {
    if (subject.runtime === undefined) return undefined;
    return subject.runtime === "c9s" ? "Kubernetes (c9s)" : LAB_RUNTIME_NAMES[subject.runtime];
  },
  kubeconfig: (server) => server.cluster,
  namespaces: (server) => server.namespacePattern,
  timeout: (server) => server.defaultTimeout,
  exposeType: (server) => server.exposeType,
  persistence: (server) => onOff(server.persistence),
  // A server that reports its settings and names no secret has none.
  imagePullSecret: (server) => server.imagePullSecret ?? (server.exposeType !== undefined ? "None" : undefined),
  noTopologyCR: (server) => onOff(server.noTopologyCR),
  wiresharkImage: (server) => server.capture?.wiresharkImage,
  wiresharkPullPolicy: (server) => {
    const policy = server.capture?.wiresharkPullPolicy;
    return policy ? optionLabel("wiresharkPullPolicy", policy) : undefined;
  },
  packetflixPort: (server) => server.capture?.packetflixPort?.toString(),
  edgesharkEnv: (server) => {
    const names = server.capture?.edgesharkEnv;
    if (names === undefined) return undefined;
    return names.length > 0 ? `${names.join(", ")} (values not shown)` : "None";
  }
};

/** The value an API Server reports for a setting, as the page shows it; undefined when it reports none. */
function serverValue(id: LabHostSettingId, subject: LabHostSettingsSubject): string | undefined {
  return SERVER_VALUES[id]?.(subject.server ?? {}, subject);
}

function server(id: LabHostSettingId, subject: LabHostSettingsSubject): LabHostSettingAccess {
  const value = serverValue(id, subject);
  if (value !== undefined) return { access: "server", reason: SET_BY_API_SERVER, value };
  return { access: "server", reason: SET_BY_API_SERVER, note: subject.runtime === undefined ? SIGN_IN_TO_SEE : NOT_REPORTED_BY_SERVER };
}

function clusterAccess(id: LabHostSettingId, subject: LabHostSettingsSubject): LabHostSettingAccess {
  const only = THIS_COMPUTER_ONLY[id];
  if (only) return { access: "unsupported", reason: only.cluster };
  if (id === "binaryPath") {
    return { access: "fixed", reason: "containerlab on This computer deploys these labs; its path is set there." };
  }
  if (EDGESHARK_SETTINGS.has(id)) return { access: "unsupported", reason: `${KUBERNETES_LIMITS.edgeshark.reason}.` };
  if (id === "wiresharkPullPolicy") {
    return { access: "unsupported", reason: "Pulled when it is missing: Wireshark VNC of a Kubernetes lab host has no pull policy." };
  }
  if (id === "vncHostname") {
    return { access: "unsupported", reason: "Wireshark VNC of a Kubernetes lab host reads its capture stream, without packetflix links." };
  }
  const configured = KUBERNETES_SETTINGS.has(id) || id === "timeout";
  if (configured && subject.editable === false) return { access: "fixed", reason: SET_BY_APP_CONFIGURATION };
  return { access: "edit" };
}

/** Why an API Server has no Wireshark VNC, when it says so. */
function noWiresharkVnc(subject: LabHostSettingsSubject): string | undefined {
  if (subject.server?.capture?.wiresharkVnc !== false) return undefined;
  return subject.runtime === "c9s"
    ? "This API Server runs no Wireshark VNC sessions: for c9s labs they need Docker on the server host."
    : "This API Server runs no Wireshark VNC sessions.";
}

/** The capture settings of an API Server: Wireshark VNC everywhere, Edgeshark next to Docker and Podman labs. */
function serverCaptureAccess(id: LabHostSettingId, subject: LabHostSettingsSubject): LabHostSettingAccess {
  const kubernetes = subject.runtime === "c9s";
  if (id === "captureMethod") return { access: "edit" };
  if (id === "wiresharkImage" || id === "wiresharkPullPolicy") {
    const reason = noWiresharkVnc(subject);
    return reason !== undefined ? { access: "unsupported", reason } : server(id, subject);
  }
  if (id === "vncHostname") {
    return {
      access: "unsupported",
      reason: kubernetes
        ? "Wireshark VNC of c9s labs reads the API Server's capture stream, without packetflix links."
        : "Wireshark VNC sessions run on the API Server, which reaches Edgeshark itself: there is no hostname to set."
    };
  }
  if (kubernetes) return { access: "unsupported", reason: `${KUBERNETES_LIMITS.edgeshark.reason}.` };
  // Docker and Podman API Servers run Edgeshark next to their labs; packetflix links name the server.
  if (id === "edgeshark" || id === "captureHostname") return { access: "edit" };
  return server(id, subject);
}

function serverAccess(id: LabHostSettingId, subject: LabHostSettingsSubject): LabHostSettingAccess {
  if (id === "runtime" || id === "timeout") return server(id, subject);
  if (id === "socket") return { access: "unsupported", reason: THIS_COMPUTER_ONLY.socket?.server ?? "" };
  if (id === "binaryPath") return { access: "unsupported", reason: "The API Server runs its own containerlab." };
  if (id === "deployArgs" || id === "destroyArgs") {
    return { access: "unsupported", reason: "The API Server takes no containerlab arguments." };
  }
  if (KUBERNETES_SETTINGS.has(id)) {
    if (subject.runtime === "c9s" || subject.runtime === undefined) return server(id, subject);
    return { access: "unsupported", reason: `${ONLY_KUBERNETES} This API Server runs ${LAB_RUNTIME_NAMES[subject.runtime]}.` };
  }
  return serverCaptureAccess(id, subject);
}

function thisComputerAccess(id: LabHostSettingId): LabHostSettingAccess {
  if (KUBERNETES_SETTINGS.has(id)) return { access: "unsupported", reason: ONLY_KUBERNETES };
  return { access: "edit" };
}

/** How a setting shows on a lab host's page: editable, greyed out, or set by the API Server. */
export function labHostSettingAccess(id: LabHostSettingId, subject: LabHostSettingsSubject): LabHostSettingAccess {
  if (subject.kind === "cluster") return clusterAccess(id, subject);
  if (subject.kind === "server") return serverAccess(id, subject);
  return thisComputerAccess(id);
}

/** Every setting of a lab host with how it shows, section by section; for tests and summaries. */
export function labHostSettingsMatrix(
  subject: LabHostSettingsSubject
): Record<LabHostSettingId, LabHostSettingAccess["access"]> {
  const matrix = {} as Record<LabHostSettingId, LabHostSettingAccess["access"]>;
  for (const section of LAB_HOST_SETTING_SECTIONS) {
    for (const id of section.settings) matrix[id] = labHostSettingAccess(id, subject).access;
  }
  return matrix;
}
