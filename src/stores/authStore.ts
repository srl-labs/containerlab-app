import { create } from "zustand";

interface AuthState {
  isAuthenticated: boolean;
  username: string | null;
  loading: boolean;
  error: string | null;
  setAuthenticated: (username: string) => void;
  setUnauthenticated: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  username: null,
  loading: true,
  error: null,
  setAuthenticated: (username) =>
    set({ isAuthenticated: true, username, loading: false, error: null }),
  setUnauthenticated: () =>
    set({ isAuthenticated: false, username: null, loading: false, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false })
}));
