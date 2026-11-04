import type { LabHostScriptDescription } from "../host/labOperations";

/** When script buttons ask before they run. */
export type ScriptButtonConfirm = "firstRun" | "always" | "never";

export const SCRIPT_BUTTON_CONFIRM_OPTIONS: Array<{ value: ScriptButtonConfirm; label: string }> = [
  { value: "firstRun", label: "First run of each script" },
  { value: "always", label: "Every run" },
  { value: "never", label: "Only scripts from others" }
];

const CONFIRM_STORAGE_KEY = "clab-script-button-confirm";
const TRUST_STORAGE_KEY = "clab-script-button-trust";
/** Trust records kept per browser profile; the oldest go first. */
const MAX_TRUSTED = 500;

export function isScriptButtonConfirm(value: unknown): value is ScriptButtonConfirm {
  return value === "firstRun" || value === "always" || value === "never";
}

export function readPersistedScriptButtonConfirm(): ScriptButtonConfirm {
  try {
    const value = localStorage.getItem(CONFIRM_STORAGE_KEY);
    return isScriptButtonConfirm(value) ? value : "firstRun";
  } catch {
    return "firstRun";
  }
}

export function persistScriptButtonConfirm(value: ScriptButtonConfirm): void {
  try {
    localStorage.setItem(CONFIRM_STORAGE_KEY, value);
  } catch {
    /* Storage may be unavailable. */
  }
}

/**
 * The confirmation mode: the host's setting when it injects one (VS Code),
 * else this browser's preference (web and desktop).
 */
export function resolveScriptButtonConfirm(): ScriptButtonConfirm {
  const injected: unknown = Reflect.get(globalThis, "__INITIAL_DATA__");
  if (typeof injected === "object" && injected !== null) {
    const value: unknown = Reflect.get(injected, "scriptButtonConfirm");
    if (isScriptButtonConfirm(value)) return value;
  }
  return readPersistedScriptButtonConfirm();
}

function readTrusted(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(TRUST_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function isScriptTrusted(key: string): boolean {
  return readTrusted().includes(key);
}

export function trustScript(key: string): void {
  const trusted = readTrusted().filter((entry) => entry !== key);
  trusted.push(key);
  try {
    localStorage.setItem(TRUST_STORAGE_KEY, JSON.stringify(trusted.slice(-MAX_TRUSTED)));
  } catch {
    /* Storage may be unavailable; the script then asks again next time. */
  }
}

/**
 * Whether a run must be confirmed first. A script the user may not have written
 * always asks: the only check left is them reading it.
 */
export function needsConfirmation(
  mode: ScriptButtonConfirm,
  script: Pick<LabHostScriptDescription, "foreign" | "trustKey">
): boolean {
  if (script.foreign) return true;
  if (mode === "never") return false;
  if (mode === "always") return true;
  return !isScriptTrusted(script.trustKey);
}
