import type { LocalEndpointStatus } from "@srl-labs/containerlab-app-contract";
import { create } from "zustand";

interface AuthState {
  defaultApiUrl: string;
  /** Set when the app server can run labs on its own machine (the desktop app). */
  localEndpoint: LocalEndpointStatus | null;
  error: string | null;
  initialized: boolean;
  loading: boolean;
  clearError: () => void;
  setDefaultApiUrl: (defaultApiUrl: string) => void;
  setLocalEndpoint: (localEndpoint: LocalEndpointStatus | null) => void;
  setError: (error: string | null) => void;
  setInitialized: (initialized: boolean) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  defaultApiUrl: "",
  localEndpoint: null,
  error: null,
  initialized: false,
  loading: true,
  clearError: () => set({ error: null }),
  setDefaultApiUrl: (defaultApiUrl) => set({ defaultApiUrl }),
  setLocalEndpoint: (localEndpoint) => set({ localEndpoint }),
  setError: (error) => set({ error, loading: false }),
  setInitialized: (initialized) => set({ initialized }),
  setLoading: (loading) => set({ loading })
}));
