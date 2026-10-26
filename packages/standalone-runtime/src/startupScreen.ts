import type { EndpointConfig } from "./stores/endpointStore";

export type StandaloneStartupScreen = "app" | "login";

export function resolveStandaloneStartupScreen(
  endpoints: ReadonlyArray<Pick<EndpointConfig, "status">>
): StandaloneStartupScreen {
  return endpoints.length === 0 ? "login" : "app";
}

export type StandaloneWorkspaceScreen = StandaloneStartupScreen | "loading";

/**
 * The loading screen covers the window only until the workspace showed once: later
 * checks and lost connections keep the workspace and its tabs, and the connection
 * banner reports them. Without any lab host left, sign-in shows again.
 */
export function resolveStandaloneWorkspaceScreen(input: {
  endpoints: ReadonlyArray<Pick<EndpointConfig, "status">>;
  hasLoadedOnce: boolean;
  loading: boolean;
}): StandaloneWorkspaceScreen {
  if (input.loading && !input.hasLoadedOnce) {
    return "loading";
  }
  return resolveStandaloneStartupScreen(input.endpoints);
}
