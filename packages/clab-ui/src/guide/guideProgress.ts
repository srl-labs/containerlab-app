/**
 * A reader's place in a lab guide: the step they are on and the blocks they
 * ticked. It stays in this browser, per lab and guide file, and needs nothing
 * from the host.
 *
 * The page keeps each guide's progress here rather than in the Guide tab, so
 * a block that finishes while the tab is away still gets its checkmark.
 */
import { isRecord } from "../core/utilities/typeHelpers";

const STORAGE_KEY = "clab-guide-progress-v1";
/** Guides remembered per browser profile; the least recently saved go first. */
const MAX_GUIDES = 50;

export interface GuideProgress {
  step: number;
  ticked: string[];
}

type ProgressStorage = Pick<Storage, "getItem" | "setItem">;

export function guideProgressKey(labName: string, guideFileName: string): string {
  return `${labName}/${guideFileName}`;
}

function defaultStorage(): ProgressStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function readAll(storage: ProgressStorage): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

export function readGuideProgress(key: string, storage = defaultStorage()): GuideProgress {
  const value = storage ? readAll(storage)[key] : undefined;
  if (!isRecord(value)) return { step: 0, ticked: [] };
  const { step, ticked } = value;
  return {
    step: typeof step === "number" && Number.isInteger(step) && step >= 0 ? step : 0,
    ticked: Array.isArray(ticked) ? ticked.filter((id): id is string => typeof id === "string") : []
  };
}

/** Saves the progress, or forgets it once it is back at the start with nothing ticked. */
export function writeGuideProgress(key: string, progress: GuideProgress, storage = defaultStorage()): void {
  if (!storage) return;
  const all = readAll(storage);
  // Saved again, the guide becomes the most recent.
  delete all[key];
  if (progress.step > 0 || progress.ticked.length > 0) all[key] = progress;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-MAX_GUIDES))));
  } catch {
    /* Storage may be full or unavailable; the guide then starts over next time. */
  }
}

const live = new Map<string, GuideProgress>();
const listeners = new Set<() => void>();

/** The progress of a guide as this page has it: read from the browser once, then kept here. */
export function guideProgress(key: string, storage = defaultStorage()): GuideProgress {
  let progress = live.get(key);
  if (progress === undefined) {
    progress = readGuideProgress(key, storage);
    live.set(key, progress);
  }
  return progress;
}

/** Changes a guide's progress, saves it and tells whoever shows it. */
export function updateGuideProgress(
  key: string,
  update: (current: GuideProgress) => GuideProgress,
  storage = defaultStorage()
): void {
  const current = guideProgress(key, storage);
  const next = update(current);
  if (next === current) return;
  live.set(key, next);
  writeGuideProgress(key, next, storage);
  for (const listener of listeners) listener();
}

/** Calls back when any guide's progress changes; the returned function stops that. */
export function subscribeGuideProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
