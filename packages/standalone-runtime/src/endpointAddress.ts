import { endpointKindLabel, labHostKind } from "@containerlab/clab-ui/workspace/state";
import type { EndpointConfig } from "./stores/endpointStore";

type EndpointAddress = Pick<EndpointConfig, "kind" | "url">;
type EndpointWhere = EndpointAddress & Partial<Pick<EndpointConfig, "runtime" | "kubeContext" | "namespace">>;

/**
 * Where a lab host's labs go, after its kind: a cluster's context and
 * namespace ("kind-c9s-app/team-a"), an API Server's URL; nothing for This
 * computer.
 */
export function endpointWhere(endpoint: EndpointWhere): string | undefined {
  const kind = labHostKind(endpoint);
  if (kind === "cluster") return [endpoint.kubeContext, endpoint.namespace].filter(Boolean).join("/") || undefined;
  if (kind === "this-computer") return undefined;
  return endpoint.url;
}

/**
 * How the endpoint's location reads in the UI: its kind and runtime, then
 * where its labs go, e.g. "This computer · Docker", "Kubernetes · c9s ·
 * lab-prod" or "API Server · c9s · https://lab:8090".
 */
export function endpointDisplayAddress(endpoint: EndpointWhere): string {
  return [endpointKindLabel(endpoint), endpointWhere(endpoint)].filter(Boolean).join(" · ");
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
