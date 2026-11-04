import { runtimeFetch } from "./backend";
import { standaloneServerUrl } from "./standaloneServerOrigin";
import { loadLabHostInfo } from "./stores/labHostStore";

import type { EndpointHealthMetrics } from "@containerlab/clab-ui/workspace/types";
export type { EndpointHealthMetrics } from "@containerlab/clab-ui/workspace/types";
export { formatEndpointHealthTooltip } from "@containerlab/clab-ui/workspace/state";

async function readEndpointHealthError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown; message?: unknown };
  if (typeof payload.error === "string" && payload.error.trim().length > 0) {
    return payload.error;
  }
  if (typeof payload.message === "string" && payload.message.trim().length > 0) {
    return payload.message;
  }
  return `Health stats request failed (${response.status})`;
}

export async function fetchEndpointHealthMetrics(
  endpointId: string,
  signal?: AbortSignal
): Promise<EndpointHealthMetrics> {
  // A lab host whose runtime has no host to measure, such as a cluster, is not asked.
  if ((await loadLabHostInfo(endpointId))?.support.healthMetrics === false) {
    throw new Error("This lab host does not report CPU, memory and disk usage.");
  }
  const response = await runtimeFetch(
    standaloneServerUrl(`/auth/endpoints/${encodeURIComponent(endpointId)}/metrics`),
    {
      credentials: "include",
      signal
    }
  );
  if (!response.ok) {
    throw new Error(await readEndpointHealthError(response));
  }
  const payload = (await response.json()) as Partial<EndpointHealthMetrics> | null;
  if (typeof payload?.metrics !== "object" || payload.metrics === null) {
    throw new Error("Health stats response did not include metrics");
  }
  return payload as EndpointHealthMetrics;
}
