/**
 * webviewMessageBus - Single window.message listener with fan-out subscriptions.
 *
 * The webview previously registered multiple `window.addEventListener('message', ...)` listeners
 * across hooks and services. This module centralizes the listener and allows scoped subscriptions.
 */
import type { ClabUiHost } from "../host";

/**
 * Base webview message structure from the extension.
 * All messages have a type field, and may have additional data.
 */
interface WebviewMessageBase {
  type: string;
  [key: string]: unknown;
}

/**
 * Typed MessageEvent with known data structure
 */
export type TypedMessageEvent = MessageEvent<WebviewMessageBase | undefined>;

export type WebviewMessagePredicate = (event: TypedMessageEvent) => boolean;
export type WebviewMessageHandler = (event: TypedMessageEvent) => void;

interface Subscriber {
  handler: WebviewMessageHandler;
  predicate?: WebviewMessagePredicate;
}

interface HostSubscriptionState {
  subscribers: Set<Subscriber>;
  unsubscribeFromHost: (() => void) | null;
}

const hostStates = new WeakMap<ClabUiHost, HostSubscriptionState>();

function getHostState(host: ClabUiHost): HostSubscriptionState {
  let state = hostStates.get(host);
  if (!state) {
    state = {
      subscribers: new Set(),
      unsubscribeFromHost: null
    };
    hostStates.set(host, state);
  }
  return state;
}

function ensureStarted(host: ClabUiHost): HostSubscriptionState {
  const state = getHostState(host);
  if (state.unsubscribeFromHost) {
    return state;
  }

  state.unsubscribeFromHost = host.subscribe((event) => {
    const typedEvent = event as TypedMessageEvent;
    for (const sub of Array.from(state.subscribers)) {
      if (!sub.predicate || sub.predicate(typedEvent)) {
        sub.handler(typedEvent);
      }
    }
  });

  return state;
}

function maybeStop(host: ClabUiHost): void {
  const state = hostStates.get(host);
  if (!state || state.subscribers.size > 0) {
    return;
  }
  state.unsubscribeFromHost?.();
  hostStates.delete(host);
}

export function subscribeToWebviewMessages(
  handler: WebviewMessageHandler,
  predicate: WebviewMessagePredicate | undefined,
  host: ClabUiHost
): () => void {
  const state = ensureStarted(host);
  const sub: Subscriber = { handler, predicate };
  state.subscribers.add(sub);
  return () => {
    state.subscribers.delete(sub);
    maybeStop(host);
  };
}
