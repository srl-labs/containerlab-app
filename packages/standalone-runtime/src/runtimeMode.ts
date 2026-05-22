export type StandaloneRuntimeMode = "standalone" | "pages";

export const PAGES_SANDBOX_ENDPOINT_ID = "pages-sandbox";

function configuredRuntimeMode(): string {
  const env = (import.meta as ImportMeta & {
    env?: { VITE_CLAB_RUNTIME_MODE?: string };
  }).env;
  return env?.VITE_CLAB_RUNTIME_MODE ?? "standalone";
}

export function standaloneRuntimeMode(): StandaloneRuntimeMode {
  return configuredRuntimeMode() === "pages" ? "pages" : "standalone";
}

export function isPagesRuntimeMode(): boolean {
  return standaloneRuntimeMode() === "pages";
}
