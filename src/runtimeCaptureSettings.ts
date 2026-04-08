export type CapturePreferredAction = "wireshark-vnc" | "edgeshark";

export interface CapturePreferences {
  preferredAction: CapturePreferredAction;
}

const CAPTURE_SETTINGS_STORAGE_KEY = "clab-standalone-capture-settings";

const DEFAULT_CAPTURE_PREFERENCES: CapturePreferences = {
  preferredAction: "wireshark-vnc"
};

let sessionHostnameOverride = "";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeCapturePreferences(value: unknown): CapturePreferences {
  if (!isRecord(value)) {
    return { ...DEFAULT_CAPTURE_PREFERENCES };
  }

  const preferredAction =
    value.preferredAction === "edgeshark" || value.preferredAction === "wireshark-vnc"
      ? value.preferredAction
      : DEFAULT_CAPTURE_PREFERENCES.preferredAction;

  return { preferredAction };
}

export function loadCapturePreferences(): CapturePreferences {
  try {
    const raw = localStorage.getItem(CAPTURE_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return normalizeCapturePreferences(undefined);
    }
    return normalizeCapturePreferences(JSON.parse(raw));
  } catch {
    return normalizeCapturePreferences(undefined);
  }
}

export function persistCapturePreferences(next: CapturePreferences): CapturePreferences {
  const normalized = normalizeCapturePreferences(next);
  localStorage.setItem(CAPTURE_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function getSessionHostnameOverride(): string | undefined {
  const normalized = sessionHostnameOverride.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function setSessionHostnameOverride(next: string | undefined | null): string | undefined {
  sessionHostnameOverride = typeof next === "string" ? next.trim() : "";
  return getSessionHostnameOverride();
}

