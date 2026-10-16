import type { EndpointConfig } from "./stores/endpointStore";

type EndpointAddress = Pick<EndpointConfig, "kind" | "url">;

/** How the endpoint's location reads in the UI: its URL, or "local". */
export function endpointDisplayAddress(endpoint: EndpointAddress): string {
  return endpoint.kind === "local" ? "local" : endpoint.url;
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
