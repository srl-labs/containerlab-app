/** `api` is a clab-api-server; `local` runs labs with containerlab on the app's machine. */
export type EndpointKind = "api" | "local";

export interface EndpointSessionMetadata {
  id: string;
  kind: EndpointKind;
  label: string;
  sessionDuration: string;
  url: string;
  username: string;
}

/** Whether this app server can run labs on its own machine, and what is missing if not. */
export interface LocalEndpointStatus {
  available: boolean;
  problems: string[];
  /** Name of the local endpoint, e.g. "This computer". */
  label: string;
  username: string;
  containerlabVersion?: string;
}

export interface AppConfigResponse {
  defaultClabApiUrl: string;
  endpoints: EndpointSessionMetadata[];
  /** Present when the app server offers a local endpoint (the desktop app on Linux). */
  localEndpoint?: LocalEndpointStatus;
}

export * from "./runtime";
export * from "./endpoints";
