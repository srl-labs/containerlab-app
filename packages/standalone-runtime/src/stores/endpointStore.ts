import { create } from "zustand";
import type { EndpointStatus } from "@srl-labs/containerlab-app-contract";

import {
  DEFAULT_ENDPOINT_SESSION_DURATION,
  endpointProfileKey,
  isValidEndpointSessionDuration,
  normalizeEndpointProfile,
  normalizeEndpointSessionDuration,
  type EndpointImportResult,
  type EndpointProfile,
  type EndpointSessionDuration
} from "../endpointTransfer";
import { PAGES_SANDBOX_ENDPOINT_ID } from "../runtimeMode";

const STORAGE_KEY = "clab-standalone-endpoints";

export {
  DEFAULT_ENDPOINT_SESSION_DURATION,
  isValidEndpointSessionDuration,
  normalizeEndpointSessionDuration,
  type EndpointImportResult,
  type EndpointProfile,
  type EndpointSessionDuration
} from "../endpointTransfer";
export type { EndpointStatus } from "@srl-labs/containerlab-app-contract";

export function endpointSessionDurationLabel(duration: EndpointSessionDuration): string {
  return normalizeEndpointSessionDuration(duration);
}

export interface EndpointConfig {
  id: string;
  url: string;
  label: string;
  username: string;
  sessionDuration: EndpointSessionDuration;
  status: EndpointStatus;
  connected: boolean;
}

interface PersistedEndpointConfig {
  id: string;
  url: string;
  label: string;
  username: string;
  sessionDuration?: EndpointSessionDuration;
}

interface EndpointStoreState {
  endpoints: Map<string, EndpointConfig>;
  addEndpoint: (config: EndpointConfig) => void;
  clear: () => void;
  forgetEndpoint: (id: string) => void;
  hydratePersisted: () => void;
  importProfiles: (profiles: EndpointProfile[]) => EndpointImportResult;
  removeEndpoint: (id: string) => void;
  markAllSaved: () => void;
  setEndpoints: (endpoints: EndpointConfig[]) => void;
  setSessionDuration: (endpointId: string, sessionDuration: EndpointSessionDuration) => void;
  setStatus: (endpointId: string, status: EndpointStatus) => void;
}

function isConnectedStatus(status: EndpointStatus): boolean {
  return status === "connected";
}

function buildBrowserEndpointId(): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2);
  return `endpoint-${randomId.replace(/-/g, "").slice(0, 12)}`;
}

function persistEndpoints(endpoints: Map<string, EndpointConfig>): void {
  try {
    const serialized: PersistedEndpointConfig[] = Array.from(endpoints.values())
      .filter((endpoint) => endpoint.id !== PAGES_SANDBOX_ENDPOINT_ID)
      .map((endpoint) => ({
        id: endpoint.id,
        url: endpoint.url,
        label: endpoint.label,
        username: endpoint.username,
        sessionDuration: endpoint.sessionDuration
      }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch {
    // Ignore persistence failures.
  }
}

function loadPersistedEndpoints(): EndpointConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as PersistedEndpointConfig[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry): entry is PersistedEndpointConfig =>
          typeof entry?.id === "string" &&
          entry.id !== PAGES_SANDBOX_ENDPOINT_ID &&
          typeof entry?.url === "string" &&
          typeof entry?.label === "string" &&
          typeof entry?.username === "string"
      )
      .map((entry) => ({
        ...entry,
        sessionDuration: normalizeEndpointSessionDuration(entry.sessionDuration),
        status: "saved" as const,
        connected: false
      }));
  } catch {
    return [];
  }
}

function endpointProfileChanged(endpoint: EndpointConfig, profile: EndpointProfile): boolean {
  return (
    endpoint.url !== profile.url ||
    endpoint.label !== profile.label ||
    endpoint.username !== profile.username ||
    endpoint.sessionDuration !== profile.sessionDuration
  );
}

function createImportedEndpoint(profile: EndpointProfile): EndpointConfig {
  return {
    id: buildBrowserEndpointId(),
    url: profile.url,
    label: profile.label,
    username: profile.username,
    sessionDuration: profile.sessionDuration,
    status: "saved",
    connected: false
  };
}

function uniqueImportProfiles(profiles: EndpointProfile[]): {
  duplicates: number;
  profiles: EndpointProfile[];
} {
  const byKey = new Map<string, EndpointProfile>();
  let duplicates = 0;
  for (const profile of profiles) {
    const key = endpointProfileKey(profile);
    if (byKey.has(key)) {
      duplicates += 1;
    }
    byKey.set(key, profile);
  }
  return {
    duplicates,
    profiles: Array.from(byKey.values())
  };
}

function importEndpointProfiles(
  currentEndpoints: Map<string, EndpointConfig>,
  profiles: EndpointProfile[]
): { endpoints: Map<string, EndpointConfig>; result: EndpointImportResult } {
  const normalizedProfiles = profiles.map((profile, index) => normalizeEndpointProfile(profile, index));
  const deduped = uniqueImportProfiles(normalizedProfiles);
  const endpoints = new Map(currentEndpoints);
  const existingByProfileKey = new Map<string, EndpointConfig>();
  for (const endpoint of endpoints.values()) {
    const key = endpointProfileKey(endpoint);
    if (!existingByProfileKey.has(key)) {
      existingByProfileKey.set(key, endpoint);
    }
  }

  const result: EndpointImportResult = {
    added: 0,
    duplicates: deduped.duplicates,
    total: normalizedProfiles.length,
    unchanged: 0,
    updated: 0
  };

  for (const profile of deduped.profiles) {
    const key = endpointProfileKey(profile);
    const existing = existingByProfileKey.get(key);
    if (!existing) {
      const endpoint = createImportedEndpoint(profile);
      endpoints.set(endpoint.id, endpoint);
      existingByProfileKey.set(key, endpoint);
      result.added += 1;
      continue;
    }

    if (!endpointProfileChanged(existing, profile)) {
      result.unchanged += 1;
      continue;
    }

    endpoints.set(existing.id, {
      ...existing,
      url: profile.url,
      label: profile.label,
      username: profile.username,
      sessionDuration: profile.sessionDuration
    });
    result.updated += 1;
  }

  return { endpoints, result };
}

export const useEndpointStore = create<EndpointStoreState>((set) => ({
  endpoints: new Map(),

  setEndpoints: (endpoints) =>
    set(() => {
      const next = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
      persistEndpoints(next);
      return { endpoints: next };
    }),

  setStatus: (endpointId, status) =>
    set((state) => {
      const current = state.endpoints.get(endpointId);
      const connected = isConnectedStatus(status);
      if (!current || (current.status === status && current.connected === connected)) {
        return state;
      }
      const endpoints = new Map(state.endpoints);
      endpoints.set(endpointId, { ...current, status, connected });
      persistEndpoints(endpoints);
      return { endpoints };
    }),

  setSessionDuration: (endpointId, sessionDuration) =>
    set((state) => {
      const current = state.endpoints.get(endpointId);
      const normalized = normalizeEndpointSessionDuration(sessionDuration);
      if (!current || current.sessionDuration === normalized) {
        return state;
      }
      const endpoints = new Map(state.endpoints);
      endpoints.set(endpointId, { ...current, sessionDuration: normalized });
      persistEndpoints(endpoints);
      return { endpoints };
    }),

  addEndpoint: (config) =>
    set((state) => {
      const endpoints = new Map(state.endpoints);
      endpoints.set(config.id, config);
      persistEndpoints(endpoints);
      return { endpoints };
    }),

  removeEndpoint: (id) =>
    set((state) => {
      const endpoints = new Map(state.endpoints);
      endpoints.delete(id);
      persistEndpoints(endpoints);
      return { endpoints };
    }),

  forgetEndpoint: (id) =>
    set((state) => {
      const endpoints = new Map(state.endpoints);
      endpoints.delete(id);
      persistEndpoints(endpoints);
      return { endpoints };
    }),

  hydratePersisted: () =>
    set((state) => {
      if (state.endpoints.size > 0) {
        return state;
      }
      const persisted = loadPersistedEndpoints();
      const endpoints = new Map(persisted.map((endpoint) => [endpoint.id, endpoint]));
      return {
        endpoints
      };
    }),

  importProfiles: (profiles) => {
    const merged = importEndpointProfiles(useEndpointStore.getState().endpoints, profiles);
    set(() => {
      persistEndpoints(merged.endpoints);
      return { endpoints: merged.endpoints };
    });
    return merged.result;
  },

  markAllSaved: () =>
    set((state) => {
      const endpoints = new Map(
        Array.from(state.endpoints.values(), (endpoint) => [
          endpoint.id,
          {
            ...endpoint,
            status: "saved" as const,
            connected: false
          }
        ])
      );
      persistEndpoints(endpoints);
      return { endpoints };
    }),

  clear: () =>
    set(() => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore persistence failures.
      }
      return { endpoints: new Map() };
    })
}));
