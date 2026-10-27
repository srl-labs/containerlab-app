import { parseLabHostInfo, type LabHostInfo } from "@containerlab/clab-ui/host";
import { create } from "zustand";

import { fetchLabHostInfo } from "../runtimeApi";

/** How long a lab host's answer stays fresh; hosts get upgraded in place. */
const HOST_INFO_TTL_MS = 60_000;

interface LabHostState {
  /** The runtime and support of each lab host, by endpoint id, once it answered. */
  hosts: ReadonlyMap<string, LabHostInfo>;
  setHost(endpointId: string, info: LabHostInfo): void;
  forget(endpointId: string): void;
}

export const useLabHostStore = create<LabHostState>((set) => ({
  hosts: new Map(),
  setHost: (endpointId, info) =>
    set((state) => {
      const hosts = new Map(state.hosts);
      hosts.set(endpointId, info);
      return { hosts };
    }),
  forget: (endpointId) =>
    set((state) => {
      if (!state.hosts.has(endpointId)) return state;
      const hosts = new Map(state.hosts);
      hosts.delete(endpointId);
      return { hosts };
    })
}));

const pending = new Map<string, Promise<LabHostInfo | undefined>>();
const fetchedAt = new Map<string, number>();

/**
 * The runtime and support of a lab host, asked once a minute at most. Until
 * it answers, nothing that depends on the runtime is hidden: the lab host
 * still refuses what it cannot do.
 */
export function loadLabHostInfo(endpointId: string): Promise<LabHostInfo | undefined> {
  const cached = useLabHostStore.getState().hosts.get(endpointId);
  if (cached && Date.now() - (fetchedAt.get(endpointId) ?? 0) < HOST_INFO_TTL_MS) {
    return Promise.resolve(cached);
  }
  let request = pending.get(endpointId);
  if (!request) {
    request = fetchLabHostInfo(endpointId)
      .then((raw) => {
        const info = parseLabHostInfo(raw);
        if (info) {
          fetchedAt.set(endpointId, Date.now());
          useLabHostStore.getState().setHost(endpointId, info);
        }
        return info;
      })
      .catch(() => cached)
      .finally(() => pending.delete(endpointId));
    pending.set(endpointId, request);
  }
  return request;
}
