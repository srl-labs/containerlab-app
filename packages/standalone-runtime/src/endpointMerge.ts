import type { EndpointConfig, EndpointStatus } from "./stores/endpointStore";

function markEndpointStatus(endpoint: EndpointConfig, status: EndpointStatus): EndpointConfig {
  return { ...endpoint, status, connected: status === "connected" };
}

/**
 * The lab hosts the browser keeps, updated with what the app server lists.
 * An API Server the server no longer lists stays, signed out, to sign in
 * again. A local host (this computer, a Kubernetes cluster on the app's
 * machine) is the server's own: one it does not list is gone, so an earlier
 * session's entry never lingers next to the host the server lists now.
 */
export function mergeStoredAndServerEndpoints(
  previous: Map<string, EndpointConfig>,
  nextEndpoints: EndpointConfig[]
): EndpointConfig[] {
  const merged = new Map<string, EndpointConfig>();

  for (const endpoint of previous.values()) {
    if (endpoint.kind === "local") continue;
    merged.set(endpoint.id, markEndpointStatus(endpoint, "saved"));
  }

  for (const endpoint of nextEndpoints) {
    const previousEndpoint = previous.get(endpoint.id);
    merged.set(endpoint.id, {
      ...endpoint,
      sessionDuration: previousEndpoint?.status === "saved"
        ? previousEndpoint.sessionDuration
        : endpoint.sessionDuration
    });
  }

  return Array.from(merged.values());
}
