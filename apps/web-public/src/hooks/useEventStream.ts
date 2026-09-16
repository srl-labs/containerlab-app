import type { EndpointConfig } from "../stores/endpointStore";

// The public sandbox has no API server to stream lab events from, so this is a
// no-op. The single local workspace endpoint is always "connected".
export function useMultiEndpointEventStreams(_endpoints: EndpointConfig[]): void {}

export const useEventStream = useMultiEndpointEventStreams;
