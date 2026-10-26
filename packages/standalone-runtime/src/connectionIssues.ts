import type { EndpointConnectionIssue } from "@containerlab/clab-ui/workspace/types";

import type { EndpointConfig } from "./stores/endpointStore";
import type { EventStreamState } from "./stores/eventStreamStore";

function apiState(status: EndpointConfig["status"]): EndpointConnectionIssue["api"] {
  if (status === "connected") return "reachable";
  return status === "session_expired" ? "session_expired" : "unreachable";
}

/**
 * Lab hosts with a connection problem: an API that does not answer or needs a new
 * sign-in, or live events that failed. Signed-out hosts are a choice, not a problem,
 * and a stream that is still opening for the first time is not one either.
 */
export function collectConnectionIssues(
  endpoints: Iterable<EndpointConfig>,
  streams: ReadonlyMap<string, EventStreamState>,
  eventsAvailable: boolean
): EndpointConnectionIssue[] {
  const issues: EndpointConnectionIssue[] = [];
  for (const endpoint of endpoints) {
    if (endpoint.status === "saved") continue;
    const api = apiState(endpoint.status);
    const stream = eventsAvailable ? streams.get(endpoint.id) : undefined;
    const eventsFailing = stream !== undefined && stream.state !== "connected" && (stream.failures > 0 || api !== "reachable");
    if (api === "reachable" && !eventsFailing) continue;
    issues.push({
      endpointId: endpoint.id,
      label: endpoint.label,
      api,
      ...(stream
        ? {
            events: {
              state: stream.state,
              ...(stream.retryAt === undefined ? {} : { retryAt: stream.retryAt }),
              ...(stream.error ? { error: stream.error } : {})
            }
          }
        : {})
    });
  }
  return issues;
}
