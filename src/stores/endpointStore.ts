import { create } from "zustand";

const STORAGE_KEY = "clab-standalone-endpoints";

export type EndpointStatus = "connected" | "session_expired" | "offline" | "saved";
export type EndpointSessionDuration = string;

const ENDPOINT_SESSION_DURATION_PATTERN =
  /^(?:(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))|(?:\d+(?:\.\d+)?(?:d|w)))+$/i;

export const DEFAULT_ENDPOINT_SESSION_DURATION: EndpointSessionDuration = "24h";

export function normalizeEndpointSessionDuration(value: unknown): EndpointSessionDuration {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : DEFAULT_ENDPOINT_SESSION_DURATION;
}

export function endpointSessionDurationLabel(duration: EndpointSessionDuration): string {
  return normalizeEndpointSessionDuration(duration);
}

export function isValidEndpointSessionDuration(value: string): boolean {
  return ENDPOINT_SESSION_DURATION_PATTERN.test(value.trim());
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
  removeEndpoint: (id: string) => void;
  markAllSaved: () => void;
  setEndpoints: (endpoints: EndpointConfig[]) => void;
  setSessionDuration: (endpointId: string, sessionDuration: EndpointSessionDuration) => void;
  setStatus: (endpointId: string, status: EndpointStatus) => void;
}

function isConnectedStatus(status: EndpointStatus): boolean {
  return status === "connected";
}

function persistEndpoints(endpoints: Map<string, EndpointConfig>): void {
  try {
    const serialized: PersistedEndpointConfig[] = Array.from(endpoints.values(), (endpoint) => ({
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
