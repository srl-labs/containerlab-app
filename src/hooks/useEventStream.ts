import { useEffect, useRef } from "react";
import { useLabStore, type EventData } from "../stores/labStore";

/**
 * Connects to the SSE events endpoint and processes events into the lab store.
 * Handles reconnection automatically via EventSource.
 */
export function useEventStream(enabled: boolean): void {
  const processEvent = useLabStore((s) => s.processEvent);
  const setConnected = useLabStore((s) => s.setConnected);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setConnected(false);
      }
      return;
    }

    const es = new EventSource("/api/events");
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as EventData;
        processEvent(data);
      } catch {
        // Skip malformed events
      }
    };

    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      setConnected(false);
    };
  }, [enabled, processEvent, setConnected]);
}
