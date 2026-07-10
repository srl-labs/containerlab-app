const ENDPOINT_SESSION_DURATION_PATTERN =
  /^(?:(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))|(?:\d+(?:\.\d+)?(?:d|w)))+$/i;
const ENDPOINT_SESSION_DURATION_COMPONENT_PATTERN =
  /(\d+(?:\.\d+)?)(?:ns|us|µs|ms|s|m|h|d|w)/gi;

export type EndpointSessionDuration = string;
export type EndpointStatus =
  | "connected"
  | "session_expired"
  | "offline"
  | "saved";

export const DEFAULT_ENDPOINT_SESSION_DURATION: EndpointSessionDuration = "24h";

export interface EndpointProfile {
  label: string;
  sessionDuration: EndpointSessionDuration;
  url: string;
  username: string;
}

export interface EndpointSessionMetadata extends EndpointProfile {
  id: string;
}

export interface AppConfigResponse {
  defaultClabApiUrl: string;
  endpoints: EndpointSessionMetadata[];
}

export function normalizeEndpointSessionDuration(
  value: unknown,
): EndpointSessionDuration {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : DEFAULT_ENDPOINT_SESSION_DURATION;
}

export function isValidEndpointSessionDuration(value: string): boolean {
  const normalized = value.trim();
  return (
    ENDPOINT_SESSION_DURATION_PATTERN.test(normalized) &&
    Array.from(
      normalized.matchAll(ENDPOINT_SESSION_DURATION_COMPONENT_PATTERN),
    ).some((match) => Number(match[1]) > 0)
  );
}

export function normalizeEndpointProfileUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const withProtocol = /^[a-z][a-z0-9+\-.]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}
