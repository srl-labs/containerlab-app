import { endpointRuntimeBadge, labHostKind } from "@containerlab/clab-ui/workspace/state";
import type { EndpointConfig } from "./stores/endpointStore";

type EndpointAddress = Pick<EndpointConfig, "kind" | "url">;

/**
 * How the endpoint's location reads in the UI: "This computer" with its
 * runtime, a cluster's "Kubernetes · lab-prod", or a URL with the lab runtime
 * when it is not Docker.
 */
export function endpointDisplayAddress(
  endpoint: EndpointAddress & Partial<Pick<EndpointConfig, "runtime" | "kubeContext" | "namespace">>
): string {
  const kind = labHostKind(endpoint);
  // A cluster whose check has not answered yet is still Kubernetes, never "This computer · Docker".
  const badge = endpointRuntimeBadge(kind === "cluster" ? { ...endpoint, runtime: "c9s" } : endpoint);
  if (kind === "cluster") return badge ?? "Kubernetes";
  if (kind === "this-computer") {
    return `This computer · ${endpoint.runtime === "podman" ? "Podman" : "Docker"}`;
  }
  return badge ? `${endpoint.url} · ${badge}` : endpoint.url;
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
