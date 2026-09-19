import { runtimeFetch } from "./backend";
import { standaloneServerUrl } from "./standaloneServerOrigin";

import type { EndpointHealthMetrics } from "@containerlab/clab-ui/workspace/types";
export type { EndpointHealthMetrics } from "@containerlab/clab-ui/workspace/types";
export { formatEndpointHealthPercent, formatEndpointHealthBytes, formatEndpointHealthUsedTotal, formatEndpointHealthTooltip } from "@containerlab/clab-ui/workspace/state";

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
  return (await response.json()) as EndpointHealthMetrics;
}
