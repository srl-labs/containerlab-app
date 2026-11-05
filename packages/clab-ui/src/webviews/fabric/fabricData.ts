/** Reading from the engine: one answer at a time, its event stream, and refreshing when things change. */
import { useCallback, useEffect, useRef, useState } from "react";

import type { FabricClient, FclingApiRequest, FclingEvent } from "../../fabric/engine";

export type FabricConnection = "connecting" | "live" | "reconnecting" | "paused";

/** An event of the stream, or word that changes may have been missed. */
type FabricLiveEvent = FclingEvent | { type: "resync" };

type FabricLiveListener = (event: FabricLiveEvent) => void;

export type FabricLiveSubscribe = (listener: FabricLiveListener) => () => void;

const MAX_BACKOFF_MS = 15_000;
/** A glance at another tab keeps the stream; a browser only gives one server so many connections. */
const HIDDEN_GRACE_MS = 30_000;
/** A changing fabric still refreshes now and then, though its changes never settle. */
const MAX_SETTLE_WAIT_MS = 6_000;
const DEFAULT_SETTLE_MS = 1_500;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface FabricAnswerState<T> {
  answer?: T;
  error?: string;
  loading: boolean;
}

interface KeyedAnswer<T> extends FabricAnswerState<T> {
  key: string;
}

/**
 * The answer to a request, asked again when the request or `revision` changes.
 * A refresh keeps the last answer on screen; another request starts empty.
 * Without a request, nothing is asked.
 */
export function useFabricAnswer<T>(
  client: FabricClient,
  request: FclingApiRequest | undefined,
  revision: number | string = 0
): FabricAnswerState<T> {
  const key = request ? JSON.stringify(request) : "";
  const [state, setState] = useState<KeyedAnswer<T>>({ key: "", loading: false });
  useEffect(() => {
    if (!key) return undefined;
    let current = true;
    setState((previous) => (previous.key === key ? { ...previous, loading: true } : { key, loading: true }));
    client
      .api<T>(JSON.parse(key) as FclingApiRequest)
      .then((answer) => {
        if (current) setState({ key, answer, loading: false });
      })
      .catch((error: unknown) => {
        // A refresh that fails keeps what is on screen, and says so.
        if (current) setState((previous) => ({ key, answer: previous.key === key ? previous.answer : undefined, error: errorMessage(error), loading: false }));
      });
    return () => {
      current = false;
    };
  }, [client, key, revision]);
  return state.key === key ? state : { loading: key !== "" };
}

/**
 * Follows the engine's events while not paused, and when the page is seen. The
 * stream is opened again with growing pauses, from the last change seen, so
 * nothing is missed. `onClosed` hears of every stream that ends.
 */
export function useFabricLive(
  client: FabricClient,
  paused: boolean,
  onClosed: () => void
): { connection: FabricConnection; subscribe: FabricLiveSubscribe } {
  const [connection, setConnection] = useState<FabricConnection>(paused ? "paused" : "connecting");
  const listeners = useRef(new Set<FabricLiveListener>());
  const lastSeq = useRef<number | undefined>(undefined);
  const closed = useRef(onClosed);
  useEffect(() => {
    closed.current = onClosed;
  });
  const subscribe = useCallback<FabricLiveSubscribe>((listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  useEffect(() => {
    if (paused) {
      setConnection("paused");
      return undefined;
    }
    let stopped = false;
    let attempts = 0;
    let wasOpen = false;
    let close: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    const deliver = (event: FabricLiveEvent) => {
      for (const listener of listeners.current) listener(event);
    };
    const open = () => {
      close = client.openEvents(
        {
          onOpen() {
            attempts = 0;
            setConnection("live");
            // What was asked while it was gone may have failed, and a quiet fabric sends nothing to ask again.
            if (wasOpen) deliver({ type: "resync" });
            wasOpen = true;
          },
          onEvent(event) {
            if (typeof event.seq === "number") lastSeq.current = event.seq;
            deliver(event);
          },
          onClose() {
            close = undefined;
            if (stopped) return;
            setConnection("reconnecting");
            closed.current();
            attempts += 1;
            retry = setTimeout(open, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempts - 1)));
          }
        },
        lastSeq.current === undefined ? {} : { after: lastSeq.current }
      );
    };
    const onVisibility = () => {
      clearTimeout(hiddenTimer);
      if (document.hidden) {
        hiddenTimer = setTimeout(() => {
          clearTimeout(retry);
          close?.();
          close = undefined;
          setConnection("paused");
        }, HIDDEN_GRACE_MS);
      } else if (!close) {
        clearTimeout(retry);
        wasOpen = true;
        setConnection("reconnecting");
        open();
      }
    };
    setConnection("connecting");
    open();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(hiddenTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      close?.();
    };
  }, [client, paused]);
  return { connection, subscribe };
}

/**
 * A number that goes up about a second and a half after matching events settle:
 * a view asks again when it changes, and a burst of changes is one refresh.
 */
export function useLiveRevision(
  subscribe: FabricLiveSubscribe,
  matches: (event: FclingEvent) => boolean,
  settleMs = DEFAULT_SETTLE_MS
): number {
  const [revision, setRevision] = useState(0);
  const match = useRef(matches);
  useEffect(() => {
    match.current = matches;
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first: number | undefined;
    const unsubscribe = subscribe((event) => {
      if (event.type !== "resync" && !match.current(event)) return;
      const now = Date.now();
      first ??= now;
      clearTimeout(timer);
      timer = setTimeout(() => {
        first = undefined;
        setRevision((value) => value + 1);
      }, Math.min(settleMs, Math.max(0, first + MAX_SETTLE_WAIT_MS - now)));
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [subscribe, settleMs]);
  return revision;
}

/** The value, once it stopped changing for a moment: what a search box asks the server for. */
export function useSettledValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** Whether an event says the fabric itself changed: rates and counters alone do not. */
export function isFabricChange(event: FclingEvent): boolean {
  return event.type === "change" ? event.op !== "update" : event.type === "node" || event.type === "acks";
}
