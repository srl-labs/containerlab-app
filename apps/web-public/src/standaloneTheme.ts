export type StandaloneTheme = "light" | "dark";

const STANDALONE_THEME_STORAGE_KEY = "clab-standalone-theme";

export function parseStandaloneTheme(value: unknown): StandaloneTheme | undefined {
  if (value === "light" || value === "dark") {
    return value;
  }
  return undefined;
}

export function readPersistedStandaloneTheme(): StandaloneTheme | undefined {
  try {
    return parseStandaloneTheme(localStorage.getItem(STANDALONE_THEME_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

export function resolveStandaloneTheme(defaultTheme: StandaloneTheme = "dark"): StandaloneTheme {
  const persistedTheme = readPersistedStandaloneTheme();
  if (persistedTheme) {
    return persistedTheme;
  }
  if (typeof document !== "undefined") {
    return document.documentElement.classList.contains("light") ? "light" : "dark";
  }
  return defaultTheme;
}
