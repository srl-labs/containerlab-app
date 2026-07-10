import {
  isValidEndpointSessionDuration,
  normalizeEndpointProfileUrl,
  normalizeEndpointSessionDuration,
  type EndpointProfile,
  type EndpointSessionDuration,
} from "@srl-labs/containerlab-app-contract";

export {
  DEFAULT_ENDPOINT_SESSION_DURATION,
  isValidEndpointSessionDuration,
  normalizeEndpointProfileUrl,
  normalizeEndpointSessionDuration,
  type EndpointProfile,
  type EndpointSessionDuration,
} from "@srl-labs/containerlab-app-contract";

export const ENDPOINT_EXPORT_KIND = "containerlab-app.endpoints";
export const ENDPOINT_EXPORT_VERSION = 1;
export const ENDPOINT_EXPORT_FILENAME = "containerlab-app-endpoints.json";

const LEGACY_ENDPOINT_EXPORT_KIND = "containerlab-web.endpoints";

export interface EndpointExportDocument {
  endpoints: EndpointProfile[];
  kind: typeof ENDPOINT_EXPORT_KIND;
  version: typeof ENDPOINT_EXPORT_VERSION;
}

export interface EndpointImportResult {
  added: number;
  duplicates: number;
  total: number;
  unchanged: number;
  updated: number;
}

export class EndpointTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EndpointTransferError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function endpointProfileKey(profile: Pick<EndpointProfile, "url" | "username">): string {
  const normalizedUrl = normalizeEndpointProfileUrl(profile.url);
  if (!normalizedUrl) {
    throw new EndpointTransferError("Invalid endpoint URL");
  }
  return `${normalizedUrl}\u0000${profile.username.trim()}`;
}

export function normalizeEndpointProfile(input: unknown, index = 0): EndpointProfile {
  if (!isRecord(input)) {
    throw new EndpointTransferError(`Endpoint ${index + 1} must be an object`);
  }

  const rawUrl = input.url;
  const rawLabel = input.label;
  const rawUsername = input.username;
  const rawSessionDuration = input.sessionDuration;
  if (
    typeof rawUrl !== "string" ||
    typeof rawLabel !== "string" ||
    typeof rawUsername !== "string" ||
    typeof rawSessionDuration !== "string"
  ) {
    throw new EndpointTransferError(
      `Endpoint ${index + 1} must include url, label, username, and sessionDuration strings`
    );
  }

  const url = normalizeEndpointProfileUrl(rawUrl);
  if (!url) {
    throw new EndpointTransferError(`Endpoint ${index + 1} has an invalid URL`);
  }

  const label = rawLabel.trim();
  if (!label) {
    throw new EndpointTransferError(`Endpoint ${index + 1} has an empty label`);
  }

  const username = rawUsername.trim();
  if (!username) {
    throw new EndpointTransferError(`Endpoint ${index + 1} has an empty username`);
  }

  const sessionDuration = normalizeEndpointSessionDuration(rawSessionDuration);
  if (!isValidEndpointSessionDuration(sessionDuration)) {
    throw new EndpointTransferError(`Endpoint ${index + 1} has an invalid sessionDuration`);
  }

  return {
    url,
    label,
    username,
    sessionDuration
  };
}

export function buildEndpointExportDocument(
  endpoints: Iterable<EndpointProfile>
): EndpointExportDocument {
  return {
    kind: ENDPOINT_EXPORT_KIND,
    version: ENDPOINT_EXPORT_VERSION,
    endpoints: Array.from(endpoints, (endpoint, index) => normalizeEndpointProfile(endpoint, index))
  };
}

export function serializeEndpointProfiles(endpoints: Iterable<EndpointProfile>): string {
  return `${JSON.stringify(buildEndpointExportDocument(endpoints), null, 2)}\n`;
}

export function parseEndpointProfiles(content: string): EndpointProfile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new EndpointTransferError("Endpoint import file must be valid JSON");
  }

  if (!isRecord(parsed)) {
    throw new EndpointTransferError("Endpoint import file must contain a JSON object");
  }
  if (
    (parsed.kind !== ENDPOINT_EXPORT_KIND && parsed.kind !== LEGACY_ENDPOINT_EXPORT_KIND) ||
    parsed.version !== ENDPOINT_EXPORT_VERSION
  ) {
    throw new EndpointTransferError("Endpoint import file has an unsupported format or version");
  }
  if (!Array.isArray(parsed.endpoints)) {
    throw new EndpointTransferError("Endpoint import file must include an endpoints array");
  }

  return parsed.endpoints.map((endpoint, index) => normalizeEndpointProfile(endpoint, index));
}
