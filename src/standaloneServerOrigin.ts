function configuredStandaloneServerOrigin(): string {
  return import.meta.env.VITE_CLAB_STANDALONE_SERVER_ORIGIN ?? "";
}

function shouldUseConfiguredStandaloneServerOrigin(): boolean {
  return import.meta.env.DEV;
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

export function standaloneServerUrl(path: string): string {
  return new URL(path, resolveStandaloneServerOrigin()).toString();
}
