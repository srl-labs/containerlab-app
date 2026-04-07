import { create } from "zustand";

interface AuthState {
  defaultApiUrl: string;
  error: string | null;
  loading: boolean;
  clearError: () => void;
  setDefaultApiUrl: (defaultApiUrl: string) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  defaultApiUrl: "",
  error: null,
  loading: true,
  clearError: () => set({ error: null }),
  setDefaultApiUrl: (defaultApiUrl) => set({ defaultApiUrl }),
  setError: (error) => set({ error, loading: false }),
  setLoading: (loading) => set({ loading })
}));
