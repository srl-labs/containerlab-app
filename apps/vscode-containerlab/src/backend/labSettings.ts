/**
 * The lab settings of each topology on each lab host: the deploy options its
 * plain deploys, redeploys, destroys and applies use. Kept in VS Code's
 * global state, by connection and topology path.
 */
import type * as vscode from "vscode";
import {
  labSettingsOptions,
  normalizeLabSettings,
  type LabLifecycleOptionKind,
  type LabLifecycleOptionRuntime,
  type LabLifecycleOptions,
  type LabSettings
} from "@containerlab/clab-ui/host";

const LAB_SETTINGS_KEY = "containerlab.labSettings";

let state: vscode.Memento | undefined;

export function initLabSettings(memento: vscode.Memento): void {
  state = memento;
}

function settingsKey(connectionId: string, labPath: string): string {
  return `${connectionId}:${labPath}`;
}

export function labSettingsFor(connectionId: string, labPath: string): LabSettings | undefined {
  const all = state?.get<Record<string, unknown>>(LAB_SETTINGS_KEY, {}) ?? {};
  return normalizeLabSettings(all[settingsKey(connectionId, labPath)]);
}

/** Remember the lab's settings on a lab host; undefined forgets them. */
export async function rememberLabSettings(
  connectionId: string,
  labPath: string,
  settings: LabSettings | undefined
): Promise<void> {
  if (!state) throw new Error("Lab settings are not available yet.");
  const all = { ...state.get<Record<string, unknown>>(LAB_SETTINGS_KEY, {}) };
  const key = settingsKey(connectionId, labPath);
  const normalized = normalizeLabSettings(settings);
  if (normalized) {
    all[key] = normalized;
  } else {
    delete all[key];
  }
  await state.update(LAB_SETTINGS_KEY, all);
}

/**
 * The options a run of `action` uses: its own when it has any (Run with
 * options starts from the lab's settings), the lab's settings otherwise,
 * narrowed to what the lab host's runtime takes.
 */
export function lifecycleOptionsWithLabSettings(
  action: LabLifecycleOptionKind | "apply",
  options: LabLifecycleOptions | undefined,
  target: { connectionId: string; labPath: string; runtime: LabLifecycleOptionRuntime }
): LabLifecycleOptions | undefined {
  return (
    options ??
    labSettingsOptions(action, labSettingsFor(target.connectionId, target.labPath), target.runtime)
  );
}
