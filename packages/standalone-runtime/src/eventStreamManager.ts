import type { EndpointStatus } from "./stores/endpointStore";
import type { EventStreamState } from "./stores/eventStreamStore";

/** The part of `EventSource` the manager uses, so tests can drive it. */
export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

interface Timers {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface EventStreamManagerOptions {
  open: (endpointId: string) => EventSourceLike;
  onMessage: (endpointId: string, data: string) => void;
  onConnectedChange: (endpointId: string, connected: boolean) => void;
  /** Asks the app server whether the lab host's API answers. */
  probe: (endpointId: string) => Promise<EndpointStatus>;
  applyEndpointStatus: (endpointId: string, status: EndpointStatus) => void;
  publish: (endpointId: string, state: EventStreamState | undefined) => void;
  timers?: Timers;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** A stream open this long resets the backoff. */
  stableAfterMs?: number;
}

export interface EventStreamManager {
  /** Opens, keeps or closes one stream per lab host to match the endpoint list. */
  sync: (endpoints: ReadonlyArray<{ id: string; status: EndpointStatus }>) => void;
  /** Skips the remaining backoff of a lab host's stream. */
  retryNow: (endpointId: string) => void;
  dispose: () => void;
}

interface StreamRecord {
  status: EndpointStatus;
  source: EventSourceLike | null;
  retryTimer: unknown;
  stableTimer: unknown;
  probing: boolean;
  failures: number;
  error?: string;
  /** Changes when the stream stops, so a late probe result is ignored. */
  generation: number;
}

const DEFAULT_TIMERS: Timers = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/** 1 s, 2 s, 4 s … up to the cap, for the n-th failure in a row. */
export function reconnectDelay(failures: number, baseMs = 1000, maxMs = 30_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, failures - 1));
}

/** The app server reports a failed lab host stream as an `error` event with `{ error }`. */
function streamErrorMessage(event: Event): string | undefined {
  const data = (event as { data?: unknown }).data;
  if (typeof data !== "string" || data.length === 0) return undefined;
  try {
    const payload = JSON.parse(data) as { error?: unknown };
    return typeof payload.error === "string" && payload.error.trim() ? payload.error.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Live events of every lab host. A failed stream is closed and opened again with
 * exponential backoff; before each new attempt the app server checks the lab host's
 * API, so the API and the stream report their state separately.
 */
export function createEventStreamManager(options: EventStreamManagerOptions): EventStreamManager {
  const timers = options.timers ?? DEFAULT_TIMERS;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const stableAfterMs = options.stableAfterMs ?? 10_000;
  const records = new Map<string, StreamRecord>();

  const publish = (endpointId: string, record: StreamRecord, state: EventStreamState["state"], retryAt?: number) => {
    options.publish(endpointId, {
      state,
      failures: record.failures,
      ...(retryAt === undefined ? {} : { retryAt }),
      ...(record.error ? { error: record.error } : {})
    });
  };

  function clearTimers(record: StreamRecord): void {
    if (record.retryTimer !== undefined) timers.clearTimeout(record.retryTimer);
    if (record.stableTimer !== undefined) timers.clearTimeout(record.stableTimer);
    record.retryTimer = undefined;
    record.stableTimer = undefined;
  }

  function closeSource(endpointId: string, record: StreamRecord): void {
    const source = record.source;
    if (!source) return;
    record.source = null;
    source.onopen = null;
    source.onmessage = null;
    source.onerror = null;
    source.close();
    options.onConnectedChange(endpointId, false);
  }

  function stop(endpointId: string, record: StreamRecord): void {
    record.generation += 1;
    record.probing = false;
    clearTimers(record);
    closeSource(endpointId, record);
  }

  function scheduleRetry(endpointId: string, record: StreamRecord): void {
    const delay = reconnectDelay(record.failures, baseDelayMs, maxDelayMs);
    publish(endpointId, record, "reconnecting", timers.now() + delay);
    record.retryTimer = timers.setTimeout(() => {
      record.retryTimer = undefined;
      void retry(endpointId, record);
    }, delay);
  }

  function connect(endpointId: string, record: StreamRecord): void {
    clearTimers(record);
    closeSource(endpointId, record);
    publish(endpointId, record, "connecting");
    const source = options.open(endpointId);
    record.source = source;
    source.onopen = () => {
      if (record.source !== source) return;
      publish(endpointId, record, "connected");
      options.onConnectedChange(endpointId, true);
      record.stableTimer = timers.setTimeout(() => {
        record.stableTimer = undefined;
        record.failures = 0;
        record.error = undefined;
        publish(endpointId, record, "connected");
      }, stableAfterMs);
    };
    source.onmessage = (event) => {
      if (record.source === source && typeof event.data === "string") options.onMessage(endpointId, event.data);
    };
    source.onerror = (event) => {
      if (record.source !== source) return;
      // Browsers retry some failures on their own and give up on others; retry all of them here.
      record.error = streamErrorMessage(event) ?? record.error;
      clearTimers(record);
      closeSource(endpointId, record);
      record.failures += 1;
      scheduleRetry(endpointId, record);
    };
  }

  async function retry(endpointId: string, record: StreamRecord): Promise<void> {
    clearTimers(record);
    const generation = ++record.generation;
    record.probing = true;
    publish(endpointId, record, "connecting");
    const status = await options.probe(endpointId).catch((): EndpointStatus => "offline");
    if (records.get(endpointId) !== record || record.generation !== generation) return;
    record.probing = false;
    record.status = status;
    options.applyEndpointStatus(endpointId, status);
    if (status === "connected") {
      connect(endpointId, record);
    } else if (status === "offline") {
      record.failures += 1;
      scheduleRetry(endpointId, record);
    } else {
      // A new sign-in is needed; the stream opens once the endpoint is connected again.
      publish(endpointId, record, "paused");
    }
  }

  function start(endpointId: string, status: EndpointStatus): void {
    const record: StreamRecord = {
      status, source: null, retryTimer: undefined, stableTimer: undefined, probing: false, failures: 0, generation: 0
    };
    records.set(endpointId, record);
    if (status === "connected") {
      connect(endpointId, record);
    } else if (status === "offline") {
      record.failures = 1;
      scheduleRetry(endpointId, record);
    } else {
      publish(endpointId, record, "paused");
    }
  }

  function update(endpointId: string, record: StreamRecord, status: EndpointStatus): void {
    const previous = record.status;
    record.status = status;
    if (previous === status || record.probing) return;
    if (status === "connected") {
      // Signed in again, or a check elsewhere reached the host: skip the backoff.
      if (!record.source) connect(endpointId, record);
    } else if (status === "offline") {
      // Another request found the host unreachable: check its API again, with a fresh stream after.
      if (record.retryTimer === undefined) {
        clearTimers(record);
        closeSource(endpointId, record);
        record.failures += 1;
        scheduleRetry(endpointId, record);
      }
    } else {
      stop(endpointId, record);
      publish(endpointId, record, "paused");
    }
  }

  return {
    sync(endpoints) {
      const wanted = new Map(
        endpoints.filter((endpoint) => endpoint.status !== "saved").map((endpoint) => [endpoint.id, endpoint.status])
      );
      for (const [endpointId, record] of records) {
        if (wanted.has(endpointId)) continue;
        stop(endpointId, record);
        records.delete(endpointId);
        options.publish(endpointId, undefined);
      }
      for (const [endpointId, status] of wanted) {
        const record = records.get(endpointId);
        if (record) update(endpointId, record, status);
        else start(endpointId, status);
      }
    },
    retryNow(endpointId) {
      const record = records.get(endpointId);
      if (!record || record.source || record.probing) return;
      void retry(endpointId, record);
    },
    dispose() {
      for (const [endpointId, record] of records) {
        stop(endpointId, record);
        options.publish(endpointId, undefined);
      }
      records.clear();
    }
  };
}
