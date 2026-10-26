// Whether an element is near the visible part of its scroll container, with one
// IntersectionObserver for all elements of a container.
import { createContext, useContext, useEffect, useState, type RefObject } from "react";

/** The scroll container elements are watched in; null watches the viewport. */
export const InViewRootContext = createContext<Element | null>(null);

const ROOT_MARGIN = "200px";

type Listener = (inView: boolean) => void;

interface SharedObserver {
  observer: IntersectionObserver;
  listeners: Map<Element, Listener>;
}

const observers = new Map<Element | null, SharedObserver>();

function sharedObserver(root: Element | null): SharedObserver {
  let shared = observers.get(root);
  if (!shared) {
    const listeners = new Map<Element, Listener>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
    }, { root, rootMargin: ROOT_MARGIN });
    shared = { observer, listeners };
    observers.set(root, shared);
  }
  return shared;
}

function observe(root: Element | null, element: Element, listener: Listener): () => void {
  const shared = sharedObserver(root);
  shared.listeners.set(element, listener);
  shared.observer.observe(element);
  return () => {
    shared.observer.unobserve(element);
    shared.listeners.delete(element);
    if (shared.listeners.size > 0) return;
    shared.observer.disconnect();
    observers.delete(root);
  };
}

/** True while the element is within 200 px of the visible area; always true without IntersectionObserver. */
export function useInView(ref: RefObject<Element | null>): boolean {
  const root = useContext(InViewRootContext);
  const supported = typeof IntersectionObserver !== "undefined";
  const [inView, setInView] = useState(!supported);
  useEffect(() => {
    const element = ref.current;
    if (!supported || !element) return undefined;
    return observe(root, element, setInView);
  }, [ref, root, supported]);
  return inView;
}

/** True once the element came near the visible area; stays true afterwards. */
export function useSeen(inView: boolean): boolean {
  const [seen, setSeen] = useState(inView);
  if (inView && !seen) setSeen(true);
  return seen || inView;
}
