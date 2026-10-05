function configuredStandaloneServerOrigin(): string {
  const env = (import.meta as ImportMeta & {
    env?: { VITE_CLAB_STANDALONE_SERVER_ORIGIN?: string };
  }).env;
  return env?.VITE_CLAB_STANDALONE_SERVER_ORIGIN ?? "";
}

function shouldUseConfiguredStandaloneServerOrigin(): boolean {
  const env = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;
  return env?.DEV ?? false;
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function resolveStandaloneServerOrigin(
  location: Pick<Location, "origin"> = window.location,
  configuredOrigin = configuredStandaloneServerOrigin(),
  useConfiguredOrigin = shouldUseConfiguredStandaloneServerOrigin()
): string {
  if (!useConfiguredOrigin) {
    return location.origin;
  }

  return normalizeOrigin(configuredOrigin) ?? location.origin;
}

function documentBaseUri(): string {
  return typeof document === "undefined" ? "/" : document.baseURI;
}

export function resolveAppBasePath(baseUri: string = documentBaseUri()): string {
  try {
    // A document without a base tag may be an HTML entrypoint served by Vite.
    // Resolve its containing directory instead of treating the filename as a path prefix.
    return new URL(".", baseUri).pathname;
  } catch {
    return "/";
  }
}

export function standaloneServerUrl(
  path: string,
  origin = resolveStandaloneServerOrigin(),
  basePath = resolveAppBasePath()
): string {
  return new URL(path.replace(/^\/+/, ""), `${origin}${basePath}`).toString();
}
