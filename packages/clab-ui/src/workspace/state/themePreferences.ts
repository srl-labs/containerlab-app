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

export function persistStandaloneTheme(theme: StandaloneTheme): void {
  try { localStorage.setItem(STANDALONE_THEME_STORAGE_KEY, theme); } catch { /* Storage may be unavailable. */ }
}

export type TabOrientation = "horizontal" | "vertical";

const TAB_ORIENTATION_STORAGE_KEY = "clab-standalone-tab-orientation";

export function parseTabOrientation(value: unknown): TabOrientation | undefined {
  if (value === "horizontal" || value === "vertical") return value;
  return undefined;
}

export function readPersistedTabOrientation(): TabOrientation | undefined {
  try {
    return parseTabOrientation(localStorage.getItem(TAB_ORIENTATION_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

export function persistTabOrientation(orientation: TabOrientation): void {
  try { localStorage.setItem(TAB_ORIENTATION_STORAGE_KEY, orientation); } catch { /* Storage may be unavailable. */ }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}

function persistFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch { /* Storage may be unavailable. */ }
}

const AUTO_OPEN_PALETTE_STORAGE_KEY = "clab-standalone-auto-open-palette";

export function readPersistedAutoOpenPalette(): boolean {
  return readFlag(AUTO_OPEN_PALETTE_STORAGE_KEY);
}

export function persistAutoOpenPalette(enabled: boolean): void {
  persistFlag(AUTO_OPEN_PALETTE_STORAGE_KEY, enabled);
}

const DEFAULT_LAB_LOCKED_STORAGE_KEY = "clab-standalone-default-lab-locked";

export function readPersistedDefaultLabLocked(): boolean {
  return readFlag(DEFAULT_LAB_LOCKED_STORAGE_KEY);
}

export function persistDefaultLabLocked(locked: boolean): void {
  persistFlag(DEFAULT_LAB_LOCKED_STORAGE_KEY, locked);
}

const AUTO_OPEN_PALETTE_ON_SELECT_STORAGE_KEY = "clab-standalone-auto-open-palette-on-select";

export function readPersistedAutoOpenPaletteOnSelect(): boolean {
  return readFlag(AUTO_OPEN_PALETTE_ON_SELECT_STORAGE_KEY);
}

export function persistAutoOpenPaletteOnSelect(enabled: boolean): void {
  persistFlag(AUTO_OPEN_PALETTE_ON_SELECT_STORAGE_KEY, enabled);
}
