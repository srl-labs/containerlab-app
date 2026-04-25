import { useCallback, useEffect, useMemo } from "react";

import {
  parseEndpointProfiles,
  serializeEndpointProfiles,
  type EndpointImportResult
} from "../endpointTransfer";
import { useAuthStore } from "../stores/authStore";
import {
  DEFAULT_ENDPOINT_SESSION_DURATION,
  useEndpointStore,
  type EndpointConfig,
  type EndpointSessionDuration,
  type EndpointStatus
} from "../stores/endpointStore";
import { useLabStore } from "../stores/labStore";

interface AuthMeResponse {
  authenticated?: boolean;
  endpoints?: EndpointConfig[];
}

interface ConfigResponse {
  defaultClabApiUrl?: string;
}

function withStatus(endpoint: Omit<EndpointConfig, "connected"> & { connected?: boolean }): EndpointConfig {
  return {
    ...endpoint,
    sessionDuration: endpoint.sessionDuration ?? DEFAULT_ENDPOINT_SESSION_DURATION,
    connected: endpoint.connected ?? endpoint.status === "connected"
  };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = await readJson<{ error?: unknown; message?: unknown }>(response);
  if (typeof payload.error === "string" && payload.error.trim().length > 0) {
    return payload.error;
  }
  if (typeof payload.message === "string" && payload.message.trim().length > 0) {
    return payload.message;
  }
  return fallback;
}

function syncRemovedEndpointState(
  previous: Map<string, EndpointConfig>,
  nextEndpoints: EndpointConfig[]
): void {
  const nextIds = new Set(nextEndpoints.map((endpoint) => endpoint.id));
  for (const endpointId of previous.keys()) {
    if (!nextIds.has(endpointId)) {
      useLabStore.getState().clearEndpoint(endpointId);
    }
  }
}

function markEndpointStatus(
  endpoint: EndpointConfig,
  status: EndpointStatus
): EndpointConfig {
  return {
    ...endpoint,
    status,
    connected: status === "connected"
  };
}

function mergeStoredAndServerEndpoints(
  previous: Map<string, EndpointConfig>,
  nextEndpoints: EndpointConfig[]
): EndpointConfig[] {
  const merged = new Map<string, EndpointConfig>();

  for (const endpoint of previous.values()) {
    merged.set(endpoint.id, markEndpointStatus(endpoint, "saved"));
  }

  for (const endpoint of nextEndpoints) {
    const previousEndpoint = previous.get(endpoint.id);
    merged.set(endpoint.id, {
      ...endpoint,
      sessionDuration: previousEndpoint?.status === "saved"
        ? previousEndpoint.sessionDuration
        : endpoint.sessionDuration
    });
  }

  return Array.from(merged.values());
}

export function useEndpointAuth() {
  const endpoints = useEndpointStore((state) => state.endpoints);
  const addEndpointToStore = useEndpointStore((state) => state.addEndpoint);
  const clearEndpoints = useEndpointStore((state) => state.clear);
  const forgetEndpointFromStore = useEndpointStore((state) => state.forgetEndpoint);
  const hydratePersisted = useEndpointStore((state) => state.hydratePersisted);
  const importProfiles = useEndpointStore((state) => state.importProfiles);
  const markAllSaved = useEndpointStore((state) => state.markAllSaved);
  const removeEndpointFromStore = useEndpointStore((state) => state.removeEndpoint);
  const setEndpoints = useEndpointStore((state) => state.setEndpoints);
  const setSessionDuration = useEndpointStore((state) => state.setSessionDuration);

  const defaultApiUrl = useAuthStore((state) => state.defaultApiUrl);
  const error = useAuthStore((state) => state.error);
  const loading = useAuthStore((state) => state.loading);
  const clearError = useAuthStore((state) => state.clearError);
  const setDefaultApiUrl = useAuthStore((state) => state.setDefaultApiUrl);
  const setError = useAuthStore((state) => state.setError);
  const setLoading = useAuthStore((state) => state.setLoading);

  const endpointList = useMemo(() => Array.from(endpoints.values()), [endpoints]);

  const refreshConfig = useCallback(async () => {
    const response = await fetch("/api/config", { credentials: "include" });
    if (!response.ok) {
      return;
    }
    const payload = await readJson<ConfigResponse>(response);
    if (typeof payload.defaultClabApiUrl === "string") {
      setDefaultApiUrl(payload.defaultClabApiUrl);
    }
  }, [setDefaultApiUrl]);

  const refreshEndpoints = useCallback(async () => {
    const previousEndpoints = new Map(useEndpointStore.getState().endpoints);
    const response = await fetch("/auth/endpoints", { credentials: "include" });
    if (!response.ok) {
      throw new Error(await readError(response, "Failed to load endpoints"));
    }
    const payload = await readJson<{ endpoints?: EndpointConfig[] }>(response);
    const nextEndpoints = Array.isArray(payload.endpoints)
      ? payload.endpoints.map((endpoint) => withStatus(endpoint))
      : [];
    syncRemovedEndpointState(previousEndpoints, nextEndpoints);
    setEndpoints(mergeStoredAndServerEndpoints(previousEndpoints, nextEndpoints));
  }, [setEndpoints]);

  useEffect(() => {
    hydratePersisted();
    setLoading(true);

    void (async () => {
      try {
        await refreshConfig().catch(() => {});
        const previousEndpoints = new Map(useEndpointStore.getState().endpoints);
        const response = await fetch("/auth/me", { credentials: "include" });
        if (!response.ok) {
          throw new Error(await readError(response, "Authentication check failed"));
        }
        const payload = await readJson<AuthMeResponse>(response);
        const nextEndpoints = Array.isArray(payload.endpoints)
          ? payload.endpoints.map((endpoint) => withStatus(endpoint))
          : [];
        syncRemovedEndpointState(previousEndpoints, nextEndpoints);
        if (nextEndpoints.length > 0) {
          setEndpoints(mergeStoredAndServerEndpoints(previousEndpoints, nextEndpoints));
        } else if (previousEndpoints.size > 0) {
          markAllSaved();
        } else {
          setEndpoints([]);
        }
        clearError();
        setLoading(false);
      } catch {
        // Session expired or backend unreachable — keep persisted endpoints
        // as disconnected so the user can reconnect with just a password.
        markAllSaved();
        clearError();
      } finally {
        setLoading(false);
      }
    })();
  }, [
    clearEndpoints,
    clearError,
    hydratePersisted,
    markAllSaved,
    refreshConfig,
    setEndpoints,
    setError,
    setLoading
  ]);

  const addEndpoint = useCallback(
    async (input: {
      label?: string;
      password: string;
      sessionDuration: EndpointSessionDuration;
      url: string;
      username: string;
    }): Promise<EndpointConfig> => {
      clearError();
      const response = await fetch("/auth/endpoints/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input)
      });
      if (!response.ok) {
        const message = await readError(response, "Failed to add endpoint");
        setError(message);
        throw new Error(message);
      }
      const endpoint = withStatus(await readJson<EndpointConfig>(response));
      addEndpointToStore(endpoint);
      return endpoint;
    },
    [addEndpointToStore, clearError, setError]
  );

  const removeEndpoint = useCallback(
    async (endpointId: string): Promise<void> => {
      clearError();
      const existing = useEndpointStore.getState().endpoints.get(endpointId);
      if (!existing) {
        return;
      }
      if (existing.status === "saved") {
        forgetEndpointFromStore(endpointId);
        useLabStore.getState().clearEndpoint(endpointId);
        return;
      }

      const response = await fetch(`/auth/endpoints/${encodeURIComponent(endpointId)}`, {
        method: "DELETE",
        credentials: "include"
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 404) {
          forgetEndpointFromStore(endpointId);
          useLabStore.getState().clearEndpoint(endpointId);
          return;
        }
        const message = await readError(response, "Failed to remove endpoint");
        setError(message);
        throw new Error(message);
      }
      removeEndpointFromStore(endpointId);
      useLabStore.getState().clearEndpoint(endpointId);
    },
    [clearError, forgetEndpointFromStore, removeEndpointFromStore, setError]
  );

  const reconnectEndpoint = useCallback(
    async (input: {
      endpointId: string;
      password: string;
      username: string;
    }): Promise<EndpointConfig> => {
      clearError();
      const existing = useEndpointStore.getState().endpoints.get(input.endpointId);
      if (!existing) {
        throw new Error("Endpoint profile not found");
      }
      const response = await fetch(
        `/auth/endpoints/${encodeURIComponent(input.endpointId)}/reconnect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            label: existing.label,
            sessionDuration: existing.sessionDuration,
            url: existing.url,
            username: input.username,
            password: input.password
          })
        }
      );
      if (!response.ok) {
        const message = await readError(response, "Failed to reconnect endpoint");
        setError(message);
        throw new Error(message);
      }
      const endpoint = withStatus(await readJson<EndpointConfig>(response));
      addEndpointToStore(endpoint);
      return endpoint;
    },
    [addEndpointToStore, clearError, setError]
  );

  const updateEndpointSessionDuration = useCallback(
    (endpointId: string, sessionDuration: EndpointSessionDuration): void => {
      const existing = useEndpointStore.getState().endpoints.get(endpointId);
      if (!existing) {
        return;
      }

      setSessionDuration(endpointId, sessionDuration);
      if (existing.status === "saved") {
        return;
      }

      void fetch(`/auth/endpoints/${encodeURIComponent(endpointId)}/preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionDuration })
      }).then(async (response) => {
        if (response.ok || response.status === 401 || response.status === 404) {
          return;
        }
        const message = await readError(response, "Failed to update endpoint sign-in preference");
        setError(message);
      }).catch(() => {
        // Keep the locally persisted preference even if the in-memory session is unavailable.
      });
    },
    [setError, setSessionDuration]
  );

  const updateEndpoint = useCallback(
    async (input: {
      endpointId: string;
      label: string;
      sessionDuration: EndpointSessionDuration;
      url: string;
      username: string;
    }): Promise<EndpointConfig> => {
      clearError();
      const existing = useEndpointStore.getState().endpoints.get(input.endpointId);
      if (!existing) {
        throw new Error("Endpoint profile not found");
      }

      const payload = {
        label: input.label.trim(),
        sessionDuration: input.sessionDuration,
        url: input.url.trim(),
        username: input.username.trim()
      };

      if (existing.status === "saved") {
        const endpoint = withStatus({
          ...existing,
          ...payload,
          status: "saved",
          connected: false
        });
        addEndpointToStore(endpoint);
        return endpoint;
      }

      const response = await fetch(`/auth/endpoints/${encodeURIComponent(input.endpointId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const message = await readError(response, "Failed to update endpoint");
        setError(message);
        throw new Error(message);
      }

      const endpoint = withStatus(await readJson<EndpointConfig>(response));
      addEndpointToStore(endpoint);
      return endpoint;
    },
    [addEndpointToStore, clearError, setError]
  );

  const exportEndpoints = useCallback((): string => {
    return serializeEndpointProfiles(useEndpointStore.getState().endpoints.values());
  }, []);

  const importEndpoints = useCallback(
    (content: string): EndpointImportResult => {
      clearError();
      const result = importProfiles(parseEndpointProfiles(content));
      return result;
    },
    [clearError, importProfiles]
  );

  const logout = useCallback(async () => {
    clearError();
    await fetch("/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    markAllSaved();
    useLabStore.getState().clear();
  }, [clearError, markAllSaved]);

  const forgetAllEndpoints = useCallback(() => {
    clearError();
    void fetch("/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    clearEndpoints();
    useLabStore.getState().clear();
  }, [clearEndpoints, clearError]);

  return {
    addEndpoint,
    defaultApiUrl,
    endpointList,
    endpoints,
    error,
    exportEndpoints,
    forgetAllEndpoints,
    hasConnectedEndpoint: endpointList.some((ep) => ep.status === "connected"),
    hasEndpointSession: endpointList.some((ep) => ep.status !== "saved"),
    importEndpoints,
    isAuthenticated: endpointList.some((ep) => ep.status !== "saved"),
    loading,
    logout,
    reconnectEndpoint,
    refreshConfig,
    refreshEndpoints,
    removeEndpoint,
    updateEndpoint,
    setEndpointSessionDuration: updateEndpointSessionDuration,
    setDefaultApiUrl
  };
}

export const useAuth = useEndpointAuth;
