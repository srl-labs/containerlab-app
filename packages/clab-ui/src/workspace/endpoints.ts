import type { EndpointConfig, EndpointSessionDuration } from "./types";
export type {
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
