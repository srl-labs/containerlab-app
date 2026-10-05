import { applyAppTheme, resolveAppTheme, type AppTheme } from "../../theme/appThemes";
import { customAppTheme, parseCustomThemes, type CustomTheme } from "../../theme/customThemes";

export type StandaloneTheme = "light" | "dark";
export type StandaloneThemeMode = StandaloneTheme | "system";

const STANDALONE_THEME_STORAGE_KEY = "clab-standalone-theme";
const LIGHT_THEME_STORAGE_KEY = "clab-standalone-light-theme";
const DARK_THEME_STORAGE_KEY = "clab-standalone-dark-theme";
const CUSTOM_THEMES_STORAGE_KEY = "clab-standalone-custom-themes";
const APPEARANCE_STORAGE_KEYS = new Set([
  STANDALONE_THEME_STORAGE_KEY,
  LIGHT_THEME_STORAGE_KEY,
  DARK_THEME_STORAGE_KEY,
  CUSTOM_THEMES_STORAGE_KEY
]);
const LIGHT_SCHEME_QUERY = "(prefers-color-scheme: light)";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Storage may be unavailable. */ }
}

export function parseStandaloneTheme(value: unknown): StandaloneTheme | undefined {
  if (value === "light" || value === "dark") {
    return value;
  }
  return undefined;
}

export function parseStandaloneThemeMode(value: unknown): StandaloneThemeMode | undefined {
  return value === "system" ? value : parseStandaloneTheme(value);
}

function systemTheme(): StandaloneTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia(LIGHT_SCHEME_QUERY).matches ? "light" : "dark";
}

/** The light or dark mode a preference resolves to right now. */
export function effectiveStandaloneTheme(mode: StandaloneThemeMode): StandaloneTheme {
  return mode === "system" ? systemTheme() : mode;
}

export function readPersistedStandaloneTheme(): StandaloneTheme | undefined {
  const mode = parseStandaloneThemeMode(readStorage(STANDALONE_THEME_STORAGE_KEY));
  return mode === undefined ? undefined : effectiveStandaloneTheme(mode);
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

export interface StandaloneAppearance {
  mode: StandaloneThemeMode;
  /** Theme id used while the app is light. */
  lightTheme: string;
  /** Theme id used while the app is dark. */
  darkTheme: string;
  /** Themes the user created or imported. */
  customThemes: CustomTheme[];
}

function readCustomThemes(): CustomTheme[] {
  const value = readStorage(CUSTOM_THEMES_STORAGE_KEY);
  try {
    return parseCustomThemes(value === null ? null : JSON.parse(value));
  } catch {
    return [];
  }
}

/** The theme shown for `mode`, custom themes included. */
export function appearanceTheme(appearance: StandaloneAppearance, mode: StandaloneTheme): AppTheme {
  const id = mode === "light" ? appearance.lightTheme : appearance.darkTheme;
  const custom = appearance.customThemes.find((theme) => theme.id === id);
  return custom ? customAppTheme(custom) : resolveAppTheme(mode, id);
}

export function readStandaloneAppearance(): StandaloneAppearance {
  const customThemes = readCustomThemes();
  const themeId = (mode: StandaloneTheme, key: string) => {
    const id = readStorage(key) ?? undefined;
    const custom = customThemes.find((theme) => theme.id === id && theme.mode === mode);
    return custom?.id ?? resolveAppTheme(mode, id).id;
  };
  return {
    mode:
      parseStandaloneThemeMode(readStorage(STANDALONE_THEME_STORAGE_KEY)) ??
      resolveStandaloneTheme(),
    lightTheme: themeId("light", LIGHT_THEME_STORAGE_KEY),
    darkTheme: themeId("dark", DARK_THEME_STORAGE_KEY),
    customThemes
  };
}

export function persistStandaloneAppearance(appearance: StandaloneAppearance): void {
  writeStorage(STANDALONE_THEME_STORAGE_KEY, appearance.mode);
  writeStorage(LIGHT_THEME_STORAGE_KEY, appearance.lightTheme);
  writeStorage(DARK_THEME_STORAGE_KEY, appearance.darkTheme);
  writeStorage(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(appearance.customThemes));
}

/**
 * Paints the appearance on the document and returns the mode it painted. `theme` pins
 * light or dark regardless of the preference, as capture windows do from their URL.
 */
export function applyStandaloneAppearance(
  appearance: StandaloneAppearance = readStandaloneAppearance(),
  theme?: StandaloneTheme
): StandaloneTheme {
  const mode = theme ?? effectiveStandaloneTheme(appearance.mode);
  applyAppTheme(appearanceTheme(appearance, mode));
  return mode;
}

/** Calls `onChange` when another window saves the appearance or the system scheme flips. */
export function watchStandaloneAppearance(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || APPEARANCE_STORAGE_KEYS.has(event.key)) onChange();
  };
  const systemScheme = window.matchMedia(LIGHT_SCHEME_QUERY);
  window.addEventListener("storage", onStorage);
  systemScheme.addEventListener("change", onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    systemScheme.removeEventListener("change", onChange);
  };
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
