import type { EndpointSessionDuration } from "./types";
export type { EndpointConfig, EndpointImportResult, EndpointSessionDuration } from "./types";

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
