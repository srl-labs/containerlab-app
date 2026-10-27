/**
 * `api` is a clab-api-server; `local` runs labs with containerlab on the app's
 * machine, with Docker or Podman there or on a Kubernetes cluster (c9s). The
 * one definition of the endpoint kinds; the published clab-ui library keeps
 * an identical copy that a type test checks against this one.
 */
export type EndpointKind = "api" | "local";

/** The lab runtime of a lab host, as `containerlab -r` names it. */
export type EndpointRuntime = "docker" | "podman" | "c9s";

/** What runs a lab host's labs, for its badge. Missing until the host answered. */
export interface EndpointRuntimeInfo {
  runtime?: EndpointRuntime;
  /** c9s: the kubeconfig context of a cluster on this machine. */
  kubeContext?: string;
  /** c9s: the namespace of every lab, when the host has one. */
  namespace?: string;
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
}

export * from "./endpoints";
