/**
 * CPU and memory usage of the running labs the labs overview shows. A lab is
 * streamed only while one of its cards is visible and the page is shown, with
 * a few streams at a time; each stream is one WebSocket, which, unlike HTTP
 * requests, does not take one of the browser's few connections per host.
 */
import {
  nextLabUsage,
  type LabOverviewCard,
  type LabUsage,
  type LabUsageUpdate,
  type WatchLabUsage
} from "@containerlab/clab-ui/workspace/state";

import type { LabStatsSample } from "@srl-labs/containerlab-lab-backend";

const INTERVAL_SECONDS = 3;
/** Streams open at once; more visible cards wait for one to end. */
export const MAX_LAB_USAGE_STREAMS = 16;
/** A card scrolled just out of view keeps its stream this long. */
const LINGER_MS = 2000;
/** Older usage does not continue a sparkline when a stream starts again. */
const STALE_MS = 30_000;
const RETRY_DELAYS_MS = [3000, 10_000, 30_000];

export interface LabUsageFeedDeps {
  streamLabStats: (input: {
    endpointId: string;
    labName: string;
    intervalSeconds: number;
    signal: AbortSignal;
  }) => AsyncIterable<LabStatsSample>;
  /** Whether the lab host reports node usage at all. */
  supportsNodeStats: (endpointId: string) => Promise<boolean>;
  /** Whether the page is hidden, and a subscription to changes of it. */
  isHidden?: () => boolean;
  onVisibilityChange?: (listener: () => void) => () => void;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface LabUsageFeed {
  watch: WatchLabUsage;
  /** Stops every stream, e.g. when the overview closes. */
  dispose(): void;
}

type Listener = (update: LabUsageUpdate) => void;

interface Entry {
  endpointId: string;
  labName: string;
  listeners: Set<Listener>;
  last: LabUsageUpdate;
  usage?: LabUsage;
  controller?: AbortController;
  linger?: unknown;
}

function errorStatus(error: unknown): number | undefined {
  const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
  return typeof status === "number" ? status : undefined;
}

function documentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function onDocumentVisibility(listener: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

export function createLabUsageFeed(deps: LabUsageFeedDeps): LabUsageFeed {
  const isHidden = deps.isHidden ?? documentHidden;
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const entries = new Map<string, Entry>();
  const support = new Map<string, Promise<boolean>>();
  const unsupported = new Set<string>();
  let disposed = false;

  function emit(entry: Entry, update: LabUsageUpdate): void {
    entry.last = update;
    for (const listener of entry.listeners) listener(update);
  }

  function supports(endpointId: string): Promise<boolean> {
    let pending = support.get(endpointId);
    if (!pending) {
      // An unknown answer is not a no: the stream itself says when a host cannot.
      pending = deps.supportsNodeStats(endpointId).catch(() => true);
      support.set(endpointId, pending);
    }
    return pending;
  }

  function markUnsupported(endpointId: string, reason?: string): void {
    unsupported.add(endpointId);
    for (const entry of entries.values()) {
      if (entry.endpointId !== endpointId) continue;
      stop(entry);
      emit(entry, { status: "unavailable", ...(reason === undefined ? {} : { reason }) });
    }
  }

  function stop(entry: Entry): void {
    entry.controller?.abort();
    entry.controller = undefined;
  }

  function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimer(done, ms);
      function done() {
        clearTimer(timer);
        signal.removeEventListener("abort", done);
        resolve();
      }
      signal.addEventListener("abort", done, { once: true });
    });
  }

  async function run(entry: Entry, signal: AbortSignal): Promise<void> {
    if (!(await supports(entry.endpointId))) {
      if (!signal.aborted) markUnsupported(entry.endpointId);
      return;
    }
    for (let attempt = 0; !signal.aborted; attempt += 1) {
      try {
        const samples = deps.streamLabStats({
          endpointId: entry.endpointId,
          labName: entry.labName,
          intervalSeconds: INTERVAL_SECONDS,
          signal
        });
        for await (const sample of samples) {
          if (signal.aborted) return;
          attempt = 0;
          entry.usage = nextLabUsage(entry.usage, sample);
          emit(entry, { status: "live", usage: entry.usage });
        }
      } catch (error) {
        if (signal.aborted) return;
        if (errorStatus(error) === 501) {
          markUnsupported(entry.endpointId, error instanceof Error ? error.message : undefined);
          return;
        }
      }
      if (signal.aborted) return;
      await wait(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)], signal);
    }
  }

  function start(entry: Entry): void {
    if (entry.usage && now() - entry.usage.time > STALE_MS) {
      entry.usage = undefined;
      emit(entry, { status: "pending" });
    }
    const controller = new AbortController();
    entry.controller = controller;
    void run(entry, controller.signal).finally(() => {
      if (entry.controller !== controller) return;
      entry.controller = undefined;
      schedule();
    });
  }

  /** Streams the watched labs, oldest watch first, up to the limit; nothing while the page is hidden. */
  function schedule(): void {
    if (disposed) return;
    if (isHidden()) {
      for (const entry of entries.values()) stop(entry);
      return;
    }
    let open = [...entries.values()].filter((entry) => entry.controller).length;
    for (const entry of entries.values()) {
      if (open >= MAX_LAB_USAGE_STREAMS) return;
      if (entry.controller || entry.listeners.size === 0 || unsupported.has(entry.endpointId)) continue;
      start(entry);
      open += 1;
    }
  }

  const stopVisibility = (deps.onVisibilityChange ?? onDocumentVisibility)(schedule);

  function release(key: string, entry: Entry, listener: Listener): void {
    entry.listeners.delete(listener);
    if (entry.listeners.size > 0 || entry.linger !== undefined) return;
    entry.linger = setTimer(() => {
      entry.linger = undefined;
      if (entry.listeners.size > 0) return;
      stop(entry);
      // The last usage stays, so the card shows it at once when it comes back.
      if (!entry.usage) entries.delete(key);
      schedule();
    }, LINGER_MS);
  }

  return {
    watch(card: LabOverviewCard, listener: Listener) {
      if (disposed || card.labName === undefined || card.labName === "") return () => undefined;
      const key = `${card.endpointId}\n${card.labName}`;
      let entry = entries.get(key);
      if (!entry) {
        entry = { endpointId: card.endpointId, labName: card.labName, listeners: new Set(), last: { status: "pending" } };
        entries.set(key, entry);
      }
      if (entry.linger !== undefined) {
        clearTimer(entry.linger);
        entry.linger = undefined;
      }
      entry.listeners.add(listener);
      listener(unsupported.has(entry.endpointId) ? { status: "unavailable" } : entry.last);
      schedule();
      const watched = entry;
      return () => release(key, watched, listener);
    },
    dispose() {
      disposed = true;
      stopVisibility();
      for (const entry of entries.values()) {
        if (entry.linger !== undefined) clearTimer(entry.linger);
        stop(entry);
      }
      entries.clear();
    }
  };
}
