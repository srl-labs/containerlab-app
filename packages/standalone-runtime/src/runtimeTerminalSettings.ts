export interface TerminalPreferences {
  sshUserMapping: Record<string, string>;
  telnetPort: number;
  fontSize: number;
}

export const DEFAULT_TERMINAL_SSH_USER_MAPPING: Record<string, string> = {
  nokia_srlinux: "admin",
  nokia_sros: "admin",
  cisco_xrd: "clab",
  cisco_xr9vk: "clab",
  arista_ceos: "admin",
  juniper_crpd: "root"
};

export const DEFAULT_TERMINAL_TELNET_PORT = 5000;
export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const MIN_TERMINAL_FONT_SIZE = 11;
export const MAX_TERMINAL_FONT_SIZE = 18;
export const TERMINAL_FONT_SIZE_PRESETS = [11, 13, 15, 18] as const;

const TERMINAL_SETTINGS_STORAGE_KEY = "clab-standalone-terminal-settings";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSshUserMapping(value: unknown): Record<string, string> {
  const result: Record<string, string> = { ...DEFAULT_TERMINAL_SSH_USER_MAPPING };
  if (!isRecord(value)) {
    return result;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (typeof key !== "string" || typeof entry !== "string") {
      continue;
    }
    const normalizedKey = key.trim();
    const normalizedValue = entry.trim();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    result[normalizedKey] = normalizedValue;
  }
  return result;
}

function normalizeTelnetPort(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 65535) {
    return DEFAULT_TERMINAL_TELNET_PORT;
  }
  return numeric;
}

export function clampTerminalFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, rounded));
}

function normalizeFontSize(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return clampTerminalFontSize(numeric);
}

export function normalizeTerminalPreferences(value: unknown): TerminalPreferences {
  if (!isRecord(value)) {
    return {
      sshUserMapping: { ...DEFAULT_TERMINAL_SSH_USER_MAPPING },
      telnetPort: DEFAULT_TERMINAL_TELNET_PORT,
      fontSize: DEFAULT_TERMINAL_FONT_SIZE
    };
  }

  return {
    sshUserMapping: normalizeSshUserMapping(value.sshUserMapping),
    telnetPort: normalizeTelnetPort(value.telnetPort),
    fontSize: normalizeFontSize(value.fontSize)
  };
}

export function loadTerminalPreferences(): TerminalPreferences {
  try {
    const raw = localStorage.getItem(TERMINAL_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return normalizeTerminalPreferences(undefined);
    }
    return normalizeTerminalPreferences(JSON.parse(raw));
  } catch {
    return normalizeTerminalPreferences(undefined);
  }
}

export function persistTerminalPreferences(next: TerminalPreferences): TerminalPreferences {
  const normalized = normalizeTerminalPreferences(next);
  localStorage.setItem(TERMINAL_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function resetTerminalPreferences(): TerminalPreferences {
  const defaults = normalizeTerminalPreferences(undefined);
  localStorage.setItem(TERMINAL_SETTINGS_STORAGE_KEY, JSON.stringify(defaults));
  return defaults;
}

export function resolveTerminalSshUsername(
  kind: string | undefined,
  preferences: TerminalPreferences
): string | undefined {
  const normalizedKind = kind?.trim();
  if (!normalizedKind) {
    return undefined;
  }
  return preferences.sshUserMapping[normalizedKind] ?? DEFAULT_TERMINAL_SSH_USER_MAPPING[normalizedKind];
}
