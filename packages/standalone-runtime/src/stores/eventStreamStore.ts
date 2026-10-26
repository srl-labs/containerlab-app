import type { EndpointEventStreamStatus } from "@containerlab/clab-ui/workspace/types";
import { create } from "zustand";

export interface EventStreamState extends EndpointEventStreamStatus {
  /** Failed attempts since the stream last stayed open; 0 before the first failure. */
  failures: number;
}

interface EventStreamStoreState {
  streams: Map<string, EventStreamState>;
  remove: (endpointId: string) => void;
  set: (endpointId: string, state: EventStreamState) => void;
}

/** The live-events stream of each lab host, as the connection banner shows it. */
export const useEventStreamStore = create<EventStreamStoreState>((set) => ({
  streams: new Map(),
  set: (endpointId, next) =>
    set((state) => {
      const current = state.streams.get(endpointId);
      if (
        current?.state === next.state &&
        current.retryAt === next.retryAt &&
        current.error === next.error &&
        current.failures === next.failures
      ) {
        return state;
      }
      const streams = new Map(state.streams);
      streams.set(endpointId, next);
      return { streams };
    }),
  remove: (endpointId) =>
    set((state) => {
      if (!state.streams.has(endpointId)) return state;
      const streams = new Map(state.streams);
      streams.delete(endpointId);
      return { streams };
    })
}));
