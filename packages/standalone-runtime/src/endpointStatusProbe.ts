import { runtimeFetch } from "./backend";
import { standaloneServerUrl } from "./standaloneServerOrigin";
import type { EndpointStatus } from "./stores/endpointStore";

const STATUSES = new Set<EndpointStatus>(["connected", "session_expired", "offline", "saved"]);

let inFlight: Promise<Map<string, EndpointStatus>> | null = null;

async function fetchEndpointStatuses(): Promise<Map<string, EndpointStatus>> {
  const response = await runtimeFetch(standaloneServerUrl("/auth/endpoints"), { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Lab host check failed with ${response.status}`);
  }
  const payload = (await response.json().catch(() => ({}))) as { endpoints?: unknown };
  const statuses = new Map<string, EndpointStatus>();
  for (const entry of Array.isArray(payload.endpoints) ? payload.endpoints : []) {
    const { id, status } = (entry ?? {}) as { id?: unknown; status?: unknown };
    if (typeof id === "string" && STATUSES.has(status as EndpointStatus)) {
      statuses.set(id, status as EndpointStatus);
    }
  }
  return statuses;
}

/**
 * Whether the app server reaches a lab host's API. Hosts that retry together share
 * one request. A host the server no longer knows needs a new sign-in; when the app
 * server itself does not answer, the host is unreachable from here.
 */
export async function probeEndpointStatus(endpointId: string): Promise<EndpointStatus> {
  inFlight ??= fetchEndpointStatuses().finally(() => {
    inFlight = null;
  });
  try {
    return (await inFlight).get(endpointId) ?? "session_expired";
  } catch {
    return "offline";
  }
}
