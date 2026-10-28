/**
 * `api` is a clab-api-server; `local` runs labs with containerlab on the app's
 * machine, with Docker or Podman there or on a Kubernetes cluster (c9s). The
 * one definition of the endpoint kinds; the published clab-ui library keeps
 * an identical copy that a type test checks against this one.
 */
export type EndpointKind = "api" | "local";

/** The lab runtime of a lab host, as `containerlab -r` names it. */
export type EndpointRuntime = "docker" | "podman" | "c9s";

/** How node ports of a c9s lab are exposed (`--expose-type`). */
export type C9sExposeType = "ClusterIP" | "Headless" | "LoadBalancer" | "None";

/**
 * One check of a lab host, as "Check connection" lists it. The same as
 * `LabHostCheck` in clab-ui, which a type test keeps identical.
 */
export interface LabHostCheck {
  id: string;
  label: string;
  status: "ok" | "failed" | "skipped";
  message?: string;
  fix?: string;
  command?: string;
}

/**
 * A Kubernetes cluster lab host as the user sets it up in the app (the
 * desktop app's `clusters` in `local-backend.json`). The same as
 * `ClusterHostSettings` in clab-ui.
 */
export interface ClusterHostSettings {
  label?: string;
  kubeconfig?: string;
  kubeContext: string;
  namespace?: string;
  exposeType?: C9sExposeType;
  persistence?: boolean;
  imagePullSecret?: string;
}

/** What runs a lab host's labs, for its badge. Missing until the host answered. */
export interface EndpointRuntimeInfo {
  runtime?: EndpointRuntime;
  /** c9s: the kubeconfig context of a cluster on this machine. */
  kubeContext?: string;
  /** c9s: the kubeconfig file of a cluster the user manages in the app. */
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
  /** A lab host on the app's machine: its checks, when it cannot run labs. */
  checks?: LabHostCheck[];
  /** A cluster the user added in the app, which they may edit and remove there. */
  editable?: boolean;
  /** The lab host is older than the app needs, and what to update. */
  updateRequired?: string;
}

export interface EndpointSessionMetadata extends EndpointRuntimeInfo {
  id: string;
  kind: EndpointKind;
  label: string;
  sessionDuration: string;
  /** A clab-api-server URL, or `local://…` naming one of the app's local lab hosts. */
  url: string;
  username: string;
}

/** Whether this app server can run labs on its own machine, and what is missing if not. */
export interface LocalEndpointStatus extends EndpointRuntimeInfo {
  /** The `local://…` address of this local lab host; the first host's when missing. */
  url?: string;
  available: boolean;
  problems: string[];
  /** Name of the local endpoint, e.g. "This computer". */
  label: string;
  username: string;
  containerlabVersion?: string;
  /** Docs page that explains how to set this machine up. */
  setupUrl?: string;
}

/** The checks of a lab host on the app's machine (`POST /api/lab-hosts/check`). */
export interface LabHostCheckResponse {
  available: boolean;
  checks: LabHostCheck[];
}

/** The contexts of a kubeconfig file (`GET /api/lab-hosts/kubeconfig/contexts`), or why it does not load. */
export interface KubeconfigContextsResponse {
  kubeconfig: string;
  contexts: Array<{ name: string; cluster: string; namespace?: string; current: boolean }>;
  error?: string;
}

export interface AppConfigResponse {
  defaultClabApiUrl: string;
  endpoints: EndpointSessionMetadata[];
  /**
   * Present when the app server offers a local endpoint (the desktop app on
   * Linux): its first local lab host, usually this machine's Docker.
   */
  localEndpoint?: LocalEndpointStatus;
  /** Every local lab host, e.g. this machine and Kubernetes clusters; the first is `localEndpoint`. */
  localEndpoints?: LocalEndpointStatus[];
  /**
   * The app server starts Wireshark on this machine for capture streams
   * (`POST /api/runtime/capture/local-wireshark`): the desktop app.
   */
  localWireshark?: boolean;
  /**
   * The user adds, edits and removes Kubernetes clusters in the app (the
   * desktop app): the `/api/lab-hosts/clusters` routes are there.
   */
  clusterHosts?: { defaultKubeconfig?: string };
  /** Why clusters cannot be added in the app, e.g. in the web app only its server's configuration adds them. */
  clustersUnavailable?: string;
  /** Why the app offers no labs on its own machine, e.g. not Linux, or the web app without WEB_LOCAL_LABS. */
  localUnavailable?: string;
}

export * from "./endpoints";
