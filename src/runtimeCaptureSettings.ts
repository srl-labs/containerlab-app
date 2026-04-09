export type CapturePreferredAction = "wireshark-vnc" | "edgeshark";

export interface CapturePreferences {
  preferredAction: CapturePreferredAction;
}

const CAPTURE_SETTINGS_STORAGE_KEY = "clab-standalone-capture-settings";

interface CaptureSettingsStorage {
  defaultPreferences: CapturePreferences;
  preferencesByEndpoint: Record<string, CapturePreferences>;
}

const DEFAULT_CAPTURE_PREFERENCES: CapturePreferences = {
  preferredAction: "wireshark-vnc"
};

let defaultSessionHostnameOverride = "";
const sessionHostnameOverrideByEndpoint = new Map<string, string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeEndpointId(endpointId: string | undefined): string | undefined {
  const normalized = endpointId?.trim();
  return normalized ? normalized : undefined;
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

function normalizeCaptureSettingsStorage(value: unknown): CaptureSettingsStorage {
  if (
    isRecord(value) &&
    ("defaultPreferences" in value || "preferencesByEndpoint" in value)
  ) {
    const defaultPreferences = normalizeCapturePreferences(value.defaultPreferences);
    const preferencesByEndpoint: Record<string, CapturePreferences> = {};
    if (isRecord(value.preferencesByEndpoint)) {
      for (const [endpointId, rawPreferences] of Object.entries(value.preferencesByEndpoint)) {
        const normalizedEndpointId = normalizeEndpointId(endpointId);
        if (!normalizedEndpointId) {
          continue;
        }
        preferencesByEndpoint[normalizedEndpointId] = normalizeCapturePreferences(rawPreferences);
      }
    }
    return { defaultPreferences, preferencesByEndpoint };
  }

  return {
    // Backward compatibility with legacy storage shape (flat CapturePreferences).
    defaultPreferences: normalizeCapturePreferences(value),
    preferencesByEndpoint: {}
  };
}

function loadCaptureSettingsStorage(): CaptureSettingsStorage {
  try {
    const raw = localStorage.getItem(CAPTURE_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return normalizeCaptureSettingsStorage(undefined);
    }
    return normalizeCaptureSettingsStorage(JSON.parse(raw));
  } catch {
    return normalizeCaptureSettingsStorage(undefined);
  }
}

function persistCaptureSettingsStorage(next: CaptureSettingsStorage): void {
  localStorage.setItem(CAPTURE_SETTINGS_STORAGE_KEY, JSON.stringify(next));
}

export function loadCapturePreferences(endpointId?: string): CapturePreferences {
  const settings = loadCaptureSettingsStorage();
  const normalizedEndpointId = normalizeEndpointId(endpointId);
  if (!normalizedEndpointId) {
    return settings.defaultPreferences;
  }
  return settings.preferencesByEndpoint[normalizedEndpointId] ?? settings.defaultPreferences;
}

export function persistCapturePreferences(
  next: CapturePreferences,
  endpointId?: string
): CapturePreferences {
  const normalized = normalizeCapturePreferences(next);
  const settings = loadCaptureSettingsStorage();
  const normalizedEndpointId = normalizeEndpointId(endpointId);
  if (!normalizedEndpointId) {
    settings.defaultPreferences = normalized;
  } else {
    settings.preferencesByEndpoint[normalizedEndpointId] = normalized;
  }
  persistCaptureSettingsStorage(settings);
  return normalized;
}

function normalizeSessionHostnameOverride(next: string | undefined | null): string {
  return typeof next === "string" ? next.trim() : "";
}

export function getSessionHostnameOverride(endpointId?: string): string | undefined {
  const normalizedEndpointId = normalizeEndpointId(endpointId);
  const scoped = normalizedEndpointId ? sessionHostnameOverrideByEndpoint.get(normalizedEndpointId) : undefined;
  const normalized = (scoped ?? defaultSessionHostnameOverride).trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function setSessionHostnameOverride(
  next: string | undefined | null,
  endpointId?: string
): string | undefined {
  const normalized = normalizeSessionHostnameOverride(next);
  const normalizedEndpointId = normalizeEndpointId(endpointId);
  if (!normalizedEndpointId) {
    defaultSessionHostnameOverride = normalized;
    return getSessionHostnameOverride();
  }
  if (normalized.length === 0) {
    sessionHostnameOverrideByEndpoint.delete(normalizedEndpointId);
  } else {
    sessionHostnameOverrideByEndpoint.set(normalizedEndpointId, normalized);
  }
  return getSessionHostnameOverride(normalizedEndpointId);
}
