import type { C9sExposeType } from "../host/lifecycleOptions";
import type { EndpointConfig, EndpointSessionDuration } from "./types";
export type {
  ClusterHostSettings,
  EndpointConfig,
  EndpointImportResult,
  EndpointSessionDuration,
  LocalEndpointOffer
} from "./types";

const ENDPOINT_SESSION_DURATION_PATTERN =
  /^(?:(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))|(?:\d+(?:\.\d+)?(?:d|w)))+$/i;

export const DEFAULT_ENDPOINT_SESSION_DURATION: EndpointSessionDuration = "24h";

function normalizeEndpointSessionDuration(value: unknown): EndpointSessionDuration {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : DEFAULT_ENDPOINT_SESSION_DURATION;
}

export function isValidEndpointSessionDuration(value: string): boolean {
  return ENDPOINT_SESSION_DURATION_PATTERN.test(value.trim());
}


export const endpointSessionDurationLabel = normalizeEndpointSessionDuration;
export const ENDPOINT_EXPORT_FILENAME = "containerlab-app-endpoints.json";

/** The apps' documentation; setup help links into it. */
export const APP_DOCS_URL = "https://srl-labs.github.io/containerlab-app/docs/";

/**
 * Splits a setup problem such as "… Run: sudo usermod -aG docker alice, then
 * log in again." around its command, so the command can show as code.
 */
export function splitSetupCommand(problem: string): { before: string; command?: string; after: string } {
  const match = /^(.*?(?:with|Run): )(.+?)((?:, then .*)?)$/.exec(problem);
  if (!match) return { before: problem, after: "" };
  return { before: match[1], command: match[2], after: match[3] };
}

/** A lab host's runtime as its badge reads, e.g. "Kubernetes · lab-prod/team-a"; nothing for Docker. */
export function endpointRuntimeBadge(
  endpoint: Pick<EndpointConfig, "runtime" | "kubeContext" | "namespace">
): string | undefined {
  if (endpoint.runtime === "podman") return "Podman";
  if (endpoint.runtime !== "c9s") return undefined;
  const where = [endpoint.kubeContext, endpoint.namespace].filter(Boolean).join("/");
  return where ? `Kubernetes · ${where}` : "Kubernetes";
}

/** Where a lab host runs labs, as the lab host list and "Add lab host" name it. */
export type LabHostKind = "this-computer" | "cluster" | "server";

/** A lab host's kind: a clab-api-server, a Kubernetes cluster used from this machine, or this machine. */
export function labHostKind(endpoint: Pick<EndpointConfig, "kind" | "runtime">): LabHostKind {
  if (endpoint.kind !== "local") return "server";
  return endpoint.runtime === "c9s" ? "cluster" : "this-computer";
}

/** What each kind is called. */
export const LAB_HOST_KIND_LABELS: Record<LabHostKind, string> = {
  "this-computer": "This computer",
  cluster: "Kubernetes cluster",
  server: "Lab server"
};

const RUNTIME_NAMES: Record<NonNullable<EndpointConfig["runtime"]>, string> = {
  docker: "Docker",
  podman: "Podman",
  c9s: "Kubernetes"
};

/** How a cluster lab host places labs, e.g. "one namespace per lab" or "namespace team-a". */
function clusterNamespaceLabel(namespace: string | undefined): string {
  return namespace ? `namespace ${namespace}` : "one namespace per lab";
}

/**
 * The line under a lab host's name: where its labs run, e.g.
 * "This computer · Docker", "Kubernetes · kind-c9s-app · one namespace per lab"
 * or "Lab server · Kubernetes · cluster c9s".
 */
export function labHostSubtitle(
  endpoint: Pick<EndpointConfig, "kind" | "runtime" | "kubeContext" | "namespace" | "cluster">
): string {
  const kind = labHostKind(endpoint);
  if (kind === "this-computer") {
    return `This computer · ${endpoint.runtime === "podman" ? "Podman" : "Docker"}`;
  }
  if (kind === "cluster") {
    return ["Kubernetes", endpoint.kubeContext ?? "current context", clusterNamespaceLabel(endpoint.namespace)].join(" · ");
  }
  const runtime = endpoint.runtime ? RUNTIME_NAMES[endpoint.runtime] : undefined;
  return ["Lab server", runtime, endpoint.cluster ? `cluster ${endpoint.cluster}` : undefined]
    .filter(Boolean)
    .join(" · ");
}

/** How node ports of a c9s lab are exposed, in a few words each. */
export const C9S_EXPOSE_DESCRIPTIONS: Record<C9sExposeType, string> = {
  None: "No Services: reach nodes through this app (terminals, port forwards).",
  ClusterIP: "A Service per node, reachable inside the cluster.",
  Headless: "DNS names for each node inside the cluster, without a virtual IP.",
  LoadBalancer: "A load balancer address per node, reachable from outside the cluster."
};

/**
 * A lab server's c9s deploy settings in a line, e.g. "Ports: None · node
 * storage kept · no image pull secret". Empty when it reports none.
 */
export function c9sDefaultsSummary(
  endpoint: Pick<EndpointConfig, "exposeType" | "persistence" | "imagePullSecret">
): string {
  const parts: string[] = [];
  if (endpoint.exposeType) parts.push(`ports exposed: ${endpoint.exposeType}`);
  if (endpoint.persistence !== undefined) parts.push(endpoint.persistence ? "node storage kept" : "no node storage");
  if (endpoint.exposeType || endpoint.persistence !== undefined) {
    parts.push(endpoint.imagePullSecret ? `image pull secret ${endpoint.imagePullSecret}` : "no image pull secret");
  }
  return parts.join(" · ");
}
