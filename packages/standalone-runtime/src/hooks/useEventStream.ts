import { useEffect, useRef } from "react";

import {
  useEndpointStore,
  type EndpointConfig
} from "../stores/endpointStore";
import { useLabStore, type EventData } from "../stores/labStore";
import { standaloneServerUrl } from "../standaloneServerOrigin";

export function useMultiEndpointEventStreams(endpoints: EndpointConfig[]): void {
  const processEvent = useLabStore((state) => state.processEvent);
  const setLabConnected = useLabStore((state) => state.setConnected);
  const setEndpointStatus = useEndpointStore((state) => state.setStatus);
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());

  useEffect(() => {
    const streamableEndpoints = endpoints.filter(
      (endpoint) => endpoint.status === "connected" || endpoint.status === "offline"
    );
    const activeEndpointIds = new Set(streamableEndpoints.map((endpoint) => endpoint.id));
    const configuredEndpointIds = new Set(endpoints.map((endpoint) => endpoint.id));

    for (const [endpointId, source] of sourcesRef.current.entries()) {
      if (activeEndpointIds.has(endpointId)) {
        continue;
      }
      source.close();
      sourcesRef.current.delete(endpointId);
      setLabConnected(endpointId, false);
      if (!configuredEndpointIds.has(endpointId)) {
        setEndpointStatus(endpointId, "saved");
      }
    }

    for (const endpoint of streamableEndpoints) {
      if (sourcesRef.current.has(endpoint.id)) {
        continue;
      }

      const url = new URL(standaloneServerUrl("/api/events"));
      url.searchParams.set("endpointId", endpoint.id);
      const source = new EventSource(url, { withCredentials: true });
      sourcesRef.current.set(endpoint.id, source);

      source.onopen = () => {
        setLabConnected(endpoint.id, true);
        setEndpointStatus(endpoint.id, "connected");
      };

      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as EventData;
          processEvent(endpoint.id, payload);
        } catch {
          // Ignore malformed event payloads.
        }
      };

      source.onerror = () => {
        setLabConnected(endpoint.id, false);
        setEndpointStatus(endpoint.id, "offline");
      };
    }
  }, [endpoints, processEvent, setEndpointStatus, setLabConnected]);

  useEffect(() => {
    const sources = sourcesRef.current;
    return () => {
      for (const source of sources.values()) {
        source.close();
      }
      for (const endpointId of sources.keys()) {
        setLabConnected(endpointId, false);
      }
      sources.clear();
    };
  }, [setLabConnected]);
}

export const useEventStream = useMultiEndpointEventStreams;
