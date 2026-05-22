import { useEffect, useRef } from "react";

import type { EndpointConfig } from "../stores/endpointStore";
import { standaloneServerUrl } from "../standaloneServerOrigin";
import { isPagesRuntimeMode } from "../runtimeMode";

export interface WorkspaceFileEvent {
  action?: string;
  kind?: string;
  parentPath?: string;
  path?: string;
  type?: string;
}

export function useWorkspaceFileEvents(
  endpoints: EndpointConfig[],
  onWorkspaceFileEvent: (endpointId: string, event: WorkspaceFileEvent) => void,
): void {
  const handlerRef = useRef(onWorkspaceFileEvent);
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());
  const pagesMode = isPagesRuntimeMode();

  useEffect(() => {
    handlerRef.current = onWorkspaceFileEvent;
  }, [onWorkspaceFileEvent]);

  useEffect(() => {
    if (pagesMode) {
      for (const source of sourcesRef.current.values()) {
        source.close();
      }
      sourcesRef.current.clear();
      return;
    }

    const streamableEndpoints = endpoints.filter(
      (endpoint) => endpoint.status === "connected",
    );
    const activeEndpointIds = new Set(
      streamableEndpoints.map((endpoint) => endpoint.id),
    );

    for (const [endpointId, source] of sourcesRef.current.entries()) {
      if (activeEndpointIds.has(endpointId)) {
        continue;
      }
      source.close();
      sourcesRef.current.delete(endpointId);
    }

    for (const endpoint of streamableEndpoints) {
      if (sourcesRef.current.has(endpoint.id)) {
        continue;
      }

      const url = new URL(
        standaloneServerUrl("/api/runtime/file-explorer/events"),
      );
      url.searchParams.set("endpointId", endpoint.id);
      const source = new EventSource(url, { withCredentials: true });
      sourcesRef.current.set(endpoint.id, source);

      source.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data) as WorkspaceFileEvent;
          if (payload.type === "workspace-file") {
            handlerRef.current(endpoint.id, payload);
          }
        } catch {
          // Ignore malformed workspace event payloads.
        }
      };
    }
  }, [endpoints, pagesMode]);

  useEffect(() => {
    const sources = sourcesRef.current;
    return () => {
      for (const source of sources.values()) {
        source.close();
      }
      sources.clear();
    };
  }, []);
}
