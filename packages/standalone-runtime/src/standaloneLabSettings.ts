/**
 * The lab settings of each topology on each lab host: the deploy options its
 * plain deploys, redeploys, destroys and applies use. Kept in this browser's
 * (or the desktop app's) local storage, by endpoint and topology path.
 */
import {
  labSettingsOptions,
  normalizeLabSettings,
  type LabLifecycleOptionKind,
  type LabLifecycleOptions,
  type LabSettings
} from "@containerlab/clab-ui/host";
import type { TopologyRef } from "@containerlab/clab-ui/session";

import { extractEndpointIdFromTopologyId, normalizePathValue } from "./standaloneHostShared";
import type { StorageLike } from "./standaloneFavorites";

const STANDALONE_LAB_SETTINGS_STORAGE_KEY = "clab-standalone-lab-settings";

export interface LabSettingsTarget {
  /** The lab host, when the topology id does not name it. */
  endpointId?: string;
  topologyRef?: Pick<TopologyRef, "topologyId" | "yamlPath">;
}

function resolveStorage(storage?: StorageLike): StorageLike | undefined {
  if (storage !== undefined) return storage;
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

/** One lab on one lab host; null when the target names neither. */
export function labSettingsKey(target: LabSettingsTarget): string | null {
  const endpointId = extractEndpointIdFromTopologyId(target.topologyRef?.topologyId) ?? target.endpointId;
  const yamlPath = normalizePathValue(target.topologyRef?.yamlPath ?? "");
  return endpointId && yamlPath ? `${endpointId}:${yamlPath}` : null;
}

function readAll(storage: StorageLike): Record<string, unknown> {
  try {
    const parsed = JSON.parse(storage.getItem(STANDALONE_LAB_SETTINGS_STORAGE_KEY) ?? "{}") as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function readLabSettings(target: LabSettingsTarget, storage?: StorageLike): LabSettings | undefined {
  const resolved = resolveStorage(storage);
  const key = labSettingsKey(target);
  if (!resolved || !key) return undefined;
  return normalizeLabSettings(readAll(resolved)[key]);
}

/** Remember the lab's settings; undefined forgets them. */
export function writeLabSettings(
  target: LabSettingsTarget,
  settings: LabSettings | undefined,
  storage?: StorageLike
): void {
  const resolved = resolveStorage(storage);
  const key = labSettingsKey(target);
  if (!resolved) throw new Error("This browser keeps no lab settings: its local storage is off.");
  if (!key) throw new Error("The lab has no lab host or topology file to keep settings for.");
  const all = readAll(resolved);
  const normalized = normalizeLabSettings(settings);
  if (normalized) {
    all[key] = normalized;
  } else {
    delete all[key];
  }
  resolved.setItem(STANDALONE_LAB_SETTINGS_STORAGE_KEY, JSON.stringify(all));
}

/**
 * The options a run of `action` uses: its own when it has any (Run with
 * options starts from the lab's settings), the lab's settings otherwise. The
 * app server narrows them to what the lab host's runtime takes.
 */
export function lifecycleOptionsWithLabSettings(
  action: LabLifecycleOptionKind | "apply",
  options: LabLifecycleOptions | undefined,
  target: LabSettingsTarget,
  storage?: StorageLike
): LabLifecycleOptions | undefined {
  return options ?? labSettingsOptions(action, readLabSettings(target, storage));
}
