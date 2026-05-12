import type { EndpointConfig } from "./stores/endpointStore";

export type StandaloneStartupScreen = "app" | "login";

export function resolveStandaloneStartupScreen(
  endpoints: ReadonlyArray<Pick<EndpointConfig, "status">>
): StandaloneStartupScreen {
  return endpoints.length === 0 ? "login" : "app";
}
