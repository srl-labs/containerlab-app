import type { Root } from "react-dom/client";

import { mountViewer } from "./mountViewer";

// Standalone viewer bootstrap, intended to be served as a static page and embedded in an <iframe>.
// The host page sends the topology over postMessage; we render it read-only. A handshake is used so
// the host knows when to send: on load we post "clab-viewer:ready", then await "clab-viewer:render".
//
// Message in:  { type: "clab-viewer:render", yaml: string, annotations?: string, theme?: "light"|"dark" }
// Message out: { type: "clab-viewer:ready" }
//
// For direct embedding/tests, set window.__CLAB_VIEWER__ = { yaml, annotations, theme } before load.
// For iframe embedding, any parent origin is allowed by default. Restrict it with either
// ?parentOrigin=https://host.example or window.__CLAB_VIEWER_ALLOWED_ORIGINS__ = ["https://..."].

interface RenderMessage {
  type: "clab-viewer:render";
  yaml: string;
  annotations?: string;
  theme?: "light" | "dark";
}

interface ViewerWindow extends Window {
  __CLAB_VIEWER__?: RenderMessage;
  __CLAB_VIEWER_PARENT_ORIGIN__?: string;
  __CLAB_VIEWER_ALLOWED_ORIGINS__?: string[];
}

function isRenderMessage(data: unknown): data is RenderMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "clab-viewer:render" &&
    typeof (data as { yaml?: unknown }).yaml === "string"
  );
}

function parseOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getConfiguredParentOrigin(viewerWindow: ViewerWindow): string | null {
  const queryParentOrigin = new URLSearchParams(window.location.search).get("parentOrigin");
  return (
    parseOrigin(viewerWindow.__CLAB_VIEWER_PARENT_ORIGIN__) ??
    parseOrigin(queryParentOrigin)
  );
}

function getAllowedOrigins(
  viewerWindow: ViewerWindow,
  parentOrigin: string | null
): ReadonlySet<string> | null {
  const configured = viewerWindow.__CLAB_VIEWER_ALLOWED_ORIGINS__
    ?.map((origin) => parseOrigin(origin))
    .filter((origin): origin is string => origin !== null);
  if (configured && configured.length > 0) return new Set(configured);
  return parentOrigin === null ? null : new Set([parentOrigin]);
}

function isAllowedOrigin(allowedOrigins: ReadonlySet<string> | null, origin: string): boolean {
  return allowedOrigins === null || allowedOrigins.has(origin);
}

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

let root: Root | null = null;
const viewerWindow = window as ViewerWindow;
const parentOrigin = getConfiguredParentOrigin(viewerWindow);
const allowedOrigins = getAllowedOrigins(viewerWindow, parentOrigin);

function render(msg: { yaml: string; annotations?: string; theme?: "light" | "dark" }): void {
  root?.unmount();
  root = mountViewer(container as Element, {
    yaml: msg.yaml,
    annotations: msg.annotations,
    theme: msg.theme
  });
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || !isAllowedOrigin(allowedOrigins, event.origin)) return;
  if (isRenderMessage(event.data)) render(event.data);
});

const injected = viewerWindow.__CLAB_VIEWER__;
if (injected && typeof injected.yaml === "string") {
  render(injected);
} else if (window.parent !== window) {
  window.parent.postMessage({ type: "clab-viewer:ready" }, parentOrigin ?? "*");
}
