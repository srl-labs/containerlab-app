import { endpointRuntimeBadge, labHostKind } from "@containerlab/clab-ui/workspace/state";
import type { EndpointConfig } from "./stores/endpointStore";

type EndpointAddress = Pick<EndpointConfig, "kind" | "url">;

const SERVER_RUNTIMES: Record<NonNullable<EndpointConfig["runtime"]>, string> = {
  docker: "Docker",
  podman: "Podman",
  c9s: "c9s"
};

/**
 * How the endpoint's location reads in the UI: "This computer" with its
 * runtime, a cluster's "Kubernetes · lab-prod", or "API Server" with its
 * runtime and URL.
 */
export function endpointDisplayAddress(
  endpoint: EndpointAddress & Partial<Pick<EndpointConfig, "runtime" | "kubeContext" | "namespace">>
): string {
  const kind = labHostKind(endpoint);
  // A cluster whose check has not answered yet is still Kubernetes, never "This computer · Docker".
  if (kind === "cluster") return endpointRuntimeBadge({ ...endpoint, runtime: "c9s" }) ?? "Kubernetes";
  if (kind === "this-computer") {
    return `This computer · ${endpoint.runtime === "podman" ? "Podman" : "Docker"}`;
  }
  // An API Server names its kind and runtime, e.g. "API Server · c9s · https://lab:8090".
  const runtime = endpoint.runtime ? SERVER_RUNTIMES[endpoint.runtime] : undefined;
  return ["API Server", runtime, endpoint.url].filter(Boolean).join(" · ");
}

/** The host that reaches the endpoint's labs, e.g. for published node ports. */
export function endpointHostname(endpoint: EndpointAddress): string | undefined {
  if (endpoint.kind === "local") {
    return "localhost";
  }
  try {
    return new URL(endpoint.url).hostname;
  } catch {
    return undefined;
  }
}
