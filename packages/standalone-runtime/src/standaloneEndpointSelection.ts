import type { EndpointConfig } from "./stores/endpointStore";

export function isConnectedEndpointId(
  endpoints: ReadonlyArray<EndpointConfig>,
  endpointId: string
): boolean {
  return endpoints.some((endpoint) => endpoint.id === endpointId && endpoint.status === "connected");
}

export function connectedEndpoints(endpoints: ReadonlyArray<EndpointConfig>): EndpointConfig[] {
  return endpoints.filter((endpoint) => endpoint.status === "connected");
}
