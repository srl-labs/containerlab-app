import { create } from "zustand";

interface AuthState {
  defaultApiUrl: string;
  error: string | null;
  initialized: boolean;
  loading: boolean;
  clearError: () => void;
  setDefaultApiUrl: (defaultApiUrl: string) => void;
  setError: (error: string | null) => void;
  setInitialized: (initialized: boolean) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  defaultApiUrl: "",
  error: null,
  initialized: false,
  loading: true,
  clearError: () => set({ error: null }),
  setDefaultApiUrl: (defaultApiUrl) => set({ defaultApiUrl }),
  setError: (error) => set({ error, loading: false }),
  setInitialized: (initialized) => set({ initialized }),
  setLoading: (loading) => set({ loading })
}));
