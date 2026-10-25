/** When script buttons ask before they run. */
export type ScriptButtonConfirm = "firstRun" | "always" | "never";

export const SCRIPT_BUTTON_CONFIRM_OPTIONS: Array<{ value: ScriptButtonConfirm; label: string }> = [
  { value: "firstRun", label: "First run of each script" },
  { value: "always", label: "Every run" },
  { value: "never", label: "Never" }
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

/** FNV-1a, enough to tell scripts apart without storing them. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
}

/**
 * Identifies a script within a lab. A changed inline script needs confirming
 * again; a script file is trusted by path because its content lives on the host.
 */
export function scriptTrustKey(labKey: string, source: string): string {
  return hash(`${labKey}\n${source}`);
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

/** Whether a run must be confirmed first. */
export function needsConfirmation(mode: ScriptButtonConfirm, trustKey: string): boolean {
  if (mode === "never") return false;
  if (mode === "always") return true;
  return !isScriptTrusted(trustKey);
}
