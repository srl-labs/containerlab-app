import { endpointRuntimeBadge } from "@containerlab/clab-ui/workspace/state";
import type { EndpointConfig } from "./stores/endpointStore";

type EndpointAddress = Pick<EndpointConfig, "kind" | "url">;

/**
 * How the endpoint's location reads in the UI: its URL, or "local", with the
 * lab runtime when it is not Docker, e.g. "local · Kubernetes · lab-prod".
 */
export function endpointDisplayAddress(
  endpoint: EndpointAddress & Partial<Pick<EndpointConfig, "runtime" | "kubeContext" | "namespace">>
): string {
  const address = endpoint.kind === "local" ? "local" : endpoint.url;
  const badge = endpointRuntimeBadge(endpoint);
  return badge ? `${address} · ${badge}` : address;
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
