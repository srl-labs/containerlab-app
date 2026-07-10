import { parseBooleanEnv } from "./env.ts";
import { normalizeApiUrl } from "./middleware.ts";

const LOCAL_ENDPOINT_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "host.docker.internal",
  "host.containers.internal",
]);

export class EndpointPolicyError extends Error {
  readonly statusCode = 403;

  constructor(url: string) {
    super(
      `clab-api-server endpoint ${url} is not allowed by this app server. ` +
        "Configure CLAB_API_ALLOWED_ORIGINS or enable the explicit local-host mode.",
    );
  }
}

export interface EndpointAccessPolicy {
  assertAllowed(url: string): void;
  isAllowed(url: string): boolean;
}

export interface CreateEndpointAccessPolicyOptions {
  allowedOrigins?: Iterable<string>;
  defaultApiUrl: string;
  localHostMode?: boolean;
}

interface LocalEndpointShape {
  port: string;
  protocol: string;
}

function parseEndpointUrl(raw: string): URL | null {
  const normalized = normalizeApiUrl(raw);
  if (!normalized) {
    return null;
  }
  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function normalizeConfiguredOrigin(raw: string): string {
  const url = parseEndpointUrl(raw);
  if (!url) {
    throw new Error(`Invalid clab-api-server origin in endpoint policy: ${raw}`);
  }
  return url.origin;
}

function isLocalEndpointHost(hostname: string): boolean {
  return LOCAL_ENDPOINT_HOSTS.has(hostname.toLowerCase());
}

function sameLocalEndpointShape(url: URL, shape: LocalEndpointShape): boolean {
  return url.protocol === shape.protocol && url.port === shape.port;
}

export function createEndpointAccessPolicy(
  options: CreateEndpointAccessPolicyOptions,
): EndpointAccessPolicy {
  const defaultUrl = parseEndpointUrl(options.defaultApiUrl);
  if (!defaultUrl) {
    throw new Error(`Invalid default clab-api-server URL: ${options.defaultApiUrl}`);
  }

  const allowedOrigins = new Set<string>([defaultUrl.origin]);
  for (const configuredOrigin of options.allowedOrigins ?? []) {
    const value = configuredOrigin.trim();
    if (value) {
      allowedOrigins.add(normalizeConfiguredOrigin(value));
    }
  }

  const defaultLocalShape: LocalEndpointShape = {
    port: defaultUrl.port,
    protocol: defaultUrl.protocol,
  };

  const isAllowed = (raw: string): boolean => {
    const url = parseEndpointUrl(raw);
    if (!url) {
      return false;
    }
    if (allowedOrigins.has(url.origin)) {
      return true;
    }
    return Boolean(
      options.localHostMode &&
        isLocalEndpointHost(url.hostname) &&
        sameLocalEndpointShape(url, defaultLocalShape),
    );
  };

  return {
    assertAllowed(url: string): void {
      if (!isAllowed(url)) {
        throw new EndpointPolicyError(url);
      }
    },
    isAllowed,
  };
}

export function createEndpointAccessPolicyFromEnv(
  defaultApiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): EndpointAccessPolicy {
  const allowedOrigins = (env.CLAB_API_ALLOWED_ORIGINS ?? "").split(",");
  return createEndpointAccessPolicy({
    allowedOrigins,
    defaultApiUrl,
    localHostMode: parseBooleanEnv(env.CLAB_API_LOCAL_HOST_MODE, false),
  });
}
