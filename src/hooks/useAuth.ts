import { useEffect, useCallback } from "react";
import { useAuthStore } from "../stores/authStore";

export function useAuth() {
  const { isAuthenticated, username, loading, error, setAuthenticated, setUnauthenticated, setLoading, setError } =
    useAuthStore();

  useEffect(() => {
    // Check if we have a valid session on mount
    setLoading(true);
    fetch("/auth/me", { credentials: "include" })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { authenticated?: boolean };
        if (res.ok && data.authenticated) {
          setAuthenticated("user");
        } else {
          setUnauthenticated();
        }
      })
      .catch(() => {
        setUnauthenticated();
      });
  }, [setAuthenticated, setUnauthenticated, setLoading]);

  const login = useCallback(
    async (loginUsername: string, password: string, apiUrl: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ username: loginUsername, password, apiUrl })
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Login failed" }));
          throw new Error(data.error ?? "Login failed");
        }

        setAuthenticated(loginUsername);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Login failed";
        setError(message);
        throw err;
      }
    },
    [setAuthenticated, setLoading, setError]
  );

  const logout = useCallback(async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    setUnauthenticated();
  }, [setUnauthenticated]);

  return { isAuthenticated, username, loading, error, login, logout };
}
