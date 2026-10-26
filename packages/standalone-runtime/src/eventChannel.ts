import type { EventSourceLike } from "./eventStreamManager";
import { standaloneServerUrl } from "./standaloneServerOrigin";

/**
 * Every live event stream of the tab over one WebSocket (the app server's
 * `/api/events/socket`, see its `eventChannel.ts`).
 *
 * An EventSource holds one of the browser's six HTTP/1.1 connections per host
 * while it is open. The tab follows the events and the workspace files of each
 * lab host and the open topology, so with a few lab hosts, or a second tab,
 * the streams took every connection and the next request waited. WebSockets
 * do not count against that limit, on plain HTTP as well as HTTPS.
 */

type EventChannelStream = "events" | "files" | "topology";

export interface EventChannelTarget {
  stream: EventChannelStream;
  endpointId: string;
  sessionId?: string;
}

/** The part of `WebSocket` the channel uses, so tests can drive it. */
export interface WebSocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface Timers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface EventChannelOptions {
  connect: () => WebSocketLike;
  /** An EventSource on the stream's SSE route, for when WebSockets do not get through. */
  fallback: (target: EventChannelTarget) => EventSourceLike;
  timers?: Timers;
  /** Wait before a stream that ended or lost its socket opens again, like an EventSource. */
  retryMs?: number;
  /** An unused socket stays open this long, so a stream that reopens right away reuses it. */
  idleCloseMs?: number;
  /** The server pings every 25 s; a socket silent this long is dead. */
  silenceMs?: number;
}

export interface EventChannel {
  /**
   * A stream that behaves like an EventSource: it opens again after it ends or
   * the socket drops, until closed, and stays closed when the server refuses it.
   */
  open: (target: EventChannelTarget) => EventSourceLike;
  dispose: () => void;
}

interface ServerMessage {
  id?: unknown;
  type?: unknown;
  data?: unknown;
  error?: unknown;
  status?: unknown;
}

/** Opening the socket failed this often, never having worked: use the SSE routes instead. */
const FALLBACK_AFTER_FAILURES = 2;

const DEFAULT_TIMERS: Timers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
};

function parseServerMessage(raw: unknown): (ServerMessage & { id: string }) | null {
  let value: unknown;
  try {
    value = JSON.parse(String(raw));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const message: ServerMessage = value;
  return typeof message.id === "string" ? { ...message, id: message.id } : null;
}

function errorEvent(message?: string): Event {
  const event = new Event("error");
  // Like the SSE routes' `error` event, which the stream manager reads.
  return message === undefined ? event : Object.assign(event, { data: JSON.stringify({ error: message }) });
}

export function createEventChannel(options: EventChannelOptions): EventChannel {
  const timers = options.timers ?? DEFAULT_TIMERS;
  const retryMs = options.retryMs ?? 3000;
  const idleCloseMs = options.idleCloseMs ?? 5000;
  const silenceMs = options.silenceMs ?? 60_000;

  let socket: WebSocketLike | null = null;
  let socketOpen = false;
  let everOpened = false;
  let failuresBeforeOpen = 0;
  let useFallback = false;
  /** The session cookie changed since the socket opened (a stream was refused as signed out). */
  let socketStale = false;
  let idleTimer: unknown;
  let silenceTimer: unknown;
  let nextId = 0;
  const subscriptions = new Map<string, ChannelSource>();
  const sources = new Set<ChannelSource>();

  const send = (message: unknown): void => {
    if (socket && socketOpen) socket.send(JSON.stringify(message));
  };

  function clearTimer(handle: unknown): undefined {
    if (handle !== undefined) timers.clearTimeout(handle);
    return undefined;
  }

  function armSilenceTimer(onSilent: () => void): void {
    silenceTimer = clearTimer(silenceTimer);
    silenceTimer = timers.setTimeout(() => {
      silenceTimer = undefined;
      onSilent();
    }, silenceMs);
  }

  /** Closes the socket; its streams open again on their own. */
  function dropSocket(): void {
    const current = socket;
    if (!current) return;
    socket = null;
    socketOpen = false;
    current.onopen = null;
    current.onmessage = null;
    current.onclose = null;
    current.onerror = null;
    current.close();
    silenceTimer = clearTimer(silenceTimer);
    idleTimer = clearTimer(idleTimer);
    const dropped = [...subscriptions.values()];
    subscriptions.clear();
    for (const source of dropped) source.dropped();
  }

  function openSocket(): void {
    const current = options.connect();
    socket = current;
    socketStale = false;
    const lost = () => {
      if (socket !== current) return;
      if (!everOpened && !socketOpen && ++failuresBeforeOpen >= FALLBACK_AFTER_FAILURES) useFallback = true;
      dropSocket();
    };
    current.onopen = () => {
      if (socket !== current) return;
      socketOpen = true;
      everOpened = true;
      failuresBeforeOpen = 0;
      armSilenceTimer(lost);
      for (const [id, source] of subscriptions) send({ type: "open", id, ...source.target });
    };
    current.onmessage = (event) => {
      if (socket !== current) return;
      armSilenceTimer(lost);
      receive(event.data);
    };
    current.onclose = lost;
    current.onerror = lost;
    // Also bounds a handshake that never completes.
    armSilenceTimer(lost);
  }

  function receive(raw: unknown): void {
    const message = parseServerMessage(raw);
    if (!message) return;
    const source = subscriptions.get(message.id);
    if (!source) return;
    switch (message.type) {
      case "open":
        source.onopen?.(new Event("open"));
        break;
      case "event":
        if (typeof message.data === "string") source.onmessage?.(new MessageEvent("message", { data: message.data }));
        break;
      case "error":
        source.onerror?.(errorEvent(typeof message.error === "string" ? message.error : undefined));
        break;
      case "end":
        subscriptions.delete(message.id);
        release();
        source.dropped();
        break;
      case "refused":
        subscriptions.delete(message.id);
        if (message.status === 401) socketStale = true;
        release();
        source.refused();
        break;
    }
  }

  function subscribe(source: ChannelSource): string {
    idleTimer = clearTimer(idleTimer);
    if (socketStale && socket) dropSocket();
    const id = String(++nextId);
    subscriptions.set(id, source);
    if (!socket) openSocket();
    else send({ type: "open", id, ...source.target });
    return id;
  }

  /** Closes the socket a while after its last stream. */
  function release(): void {
    if (subscriptions.size > 0 || idleTimer !== undefined) return;
    idleTimer = timers.setTimeout(() => {
      idleTimer = undefined;
      if (subscriptions.size === 0) dropSocket();
    }, idleCloseMs);
  }

  function unsubscribe(id: string): void {
    if (!subscriptions.delete(id)) return;
    send({ type: "close", id });
    release();
  }

  class ChannelSource implements EventSourceLike {
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    private id: string | null = null;
    private sse: EventSourceLike | null = null;
    private retryTimer: unknown;
    private closed = false;

    constructor(readonly target: EventChannelTarget) {}

    connect(): void {
      this.retryTimer = undefined;
      if (this.closed) return;
      if (!useFallback) {
        this.id = subscribe(this);
        return;
      }
      // An EventSource reconnects on its own.
      const sse = options.fallback(this.target);
      this.sse = sse;
      sse.onopen = (event) => this.onopen?.(event);
      sse.onmessage = (event) => this.onmessage?.(event);
      sse.onerror = (event) => this.onerror?.(event);
    }

    /** The stream ended or lost its socket. */
    dropped(): void {
      this.id = null;
      if (this.closed) return;
      // Closing the stream from the error handler cancels the retry.
      this.retryTimer = timers.setTimeout(() => this.connect(), retryMs);
      this.onerror?.(errorEvent());
    }

    refused(): void {
      this.id = null;
      if (this.closed) return;
      this.closed = true;
      sources.delete(this);
      this.onerror?.(errorEvent());
    }

    close(): void {
      if (this.closed) return;
      this.closed = true;
      sources.delete(this);
      this.retryTimer = clearTimer(this.retryTimer);
      if (this.id !== null) unsubscribe(this.id);
      this.id = null;
      this.sse?.close();
      this.sse = null;
    }
  }

  return {
    open(target) {
      const source = new ChannelSource(target);
      sources.add(source);
      source.connect();
      return source;
    },
    dispose() {
      for (const source of sources) source.close();
      dropSocket();
    }
  };
}

const SSE_ROUTES: Record<EventChannelStream, string> = {
  events: "/api/events",
  files: "/api/runtime/file-explorer/events",
  topology: "/api/topology/events"
};

let shared: EventChannel | null = null;

/** The tab's event channel to the app server. */
export function eventChannel(): EventChannel {
  shared ??= createEventChannel({
    connect() {
      // The app server may live below a base path, like every other route.
      const url = new URL(standaloneServerUrl("/api/events/socket"));
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return new WebSocket(url);
    },
    fallback(target) {
      const url = new URL(standaloneServerUrl(SSE_ROUTES[target.stream]));
      url.searchParams.set("endpointId", target.endpointId);
      if (target.sessionId !== undefined) url.searchParams.set("sessionId", target.sessionId);
      return new EventSource(url, { withCredentials: true });
    }
  });
  return shared;
}
