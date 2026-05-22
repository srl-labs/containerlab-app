import { standaloneRuntimeMode, type StandaloneRuntimeMode } from "./runtimeMode";

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
  useConfiguredOrigin = shouldUseConfiguredStandaloneServerOrigin(),
  runtimeMode: StandaloneRuntimeMode = standaloneRuntimeMode()
): string {
  if (runtimeMode === "pages") {
    return location.origin;
  }

  if (!useConfiguredOrigin) {
    return location.origin;
  }

  return normalizeOrigin(configuredOrigin) ?? location.origin;
}

export function standaloneServerUrl(path: string): string {
  return new URL(path, resolveStandaloneServerOrigin()).toString();
}
