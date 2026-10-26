import { getStandaloneBackend } from "../backend";
import { useEffect } from "react";

import { probeEndpointStatus } from "../endpointStatusProbe";
import { eventChannel } from "../eventChannel";
import { createEventStreamManager, type EventStreamManager } from "../eventStreamManager";
import { useEndpointStore, type EndpointConfig } from "../stores/endpointStore";
import { useEventStreamStore } from "../stores/eventStreamStore";
import { useLabStore, type EventData } from "../stores/labStore";

let manager: EventStreamManager | null = null;

function eventStreamManager(): EventStreamManager {
  manager ??= createEventStreamManager({
    open: (endpointId) => eventChannel().open({ stream: "events", endpointId }),
    onMessage(endpointId, data) {
      try {
        useLabStore.getState().processEvent(endpointId, JSON.parse(data) as EventData);
      } catch {
        // Ignore malformed event payloads.
      }
    },
    onConnectedChange: (endpointId, connected) => useLabStore.getState().setConnected(endpointId, connected),
    probe: probeEndpointStatus,
    applyEndpointStatus: (endpointId, status) => useEndpointStore.getState().setStatus(endpointId, status),
    publish(endpointId, state) {
      if (state) useEventStreamStore.getState().set(endpointId, state);
      else useEventStreamStore.getState().remove(endpointId);
    }
  });
  return manager;
}

/** Checks a lab host again now instead of after the remaining backoff: its live events, or its API without them. */
export function retryEndpointConnection(endpointId: string): void {
  if (manager) {
    manager.retryNow(endpointId);
    return;
  }
  void probeEndpointStatus(endpointId).then((status) => useEndpointStore.getState().setStatus(endpointId, status));
}

function useMultiEndpointEventStreams(endpoints: EndpointConfig[]): void {
  useEffect(() => {
    if (!getStandaloneBackend().capabilities.events) return;
    eventStreamManager().sync(endpoints);
  }, [endpoints]);

  useEffect(() => () => {
    manager?.dispose();
    manager = null;
  }, []);
}

export const useEventStream = useMultiEndpointEventStreams;
