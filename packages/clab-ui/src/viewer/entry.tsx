import type { Root } from "react-dom/client";
import type { ReactFlowInstance } from "@xyflow/react";

import { applyThemeVars } from "../theme/devTheme";
import { isViewerOptions, resolveViewerOptions, type ViewerOptions } from "./options";
import "./viewer.css";

import { mountViewer } from "./mountViewer";

// Standalone viewer bootstrap, intended to be served as a static page and embedded in an <iframe>.
// The host page sends the topology over postMessage; we render it read-only. A handshake is used so
// the host knows when to send: on load we post "clab-viewer:ready", then await "clab-viewer:render".
//
// Message in:  { type: "clab-viewer:render", yaml: string, annotations?: string, theme?: "light"|"dark", borderless?: boolean }
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
  borderless?: boolean;
  options?: ViewerOptions;
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
    typeof (data as { yaml?: unknown }).yaml === "string" &&
    ((data as { annotations?: unknown }).annotations === undefined || typeof (data as { annotations?: unknown }).annotations === "string") &&
    ((data as { theme?: unknown }).theme === undefined || ["light", "dark"].includes(String((data as { theme?: unknown }).theme))) &&
    ((data as { borderless?: unknown }).borderless === undefined || typeof (data as { borderless?: unknown }).borderless === "boolean") &&
    isViewerOptions((data as { options?: unknown }).options)
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
let flow: ReactFlowInstance | null = null;
let fitPadding = 0.25;
let transparent = false;
const viewerWindow = window as ViewerWindow;
const parentOrigin = getConfiguredParentOrigin(viewerWindow);
const allowedOrigins = getAllowedOrigins(viewerWindow, parentOrigin);

function send(data: Record<string, unknown>): void {
  if (window.parent !== window) window.parent.postMessage(data, parentOrigin ?? "*");
}

function setTheme(theme: "light" | "dark"): void {
  applyThemeVars(theme);
  document.documentElement.dataset.clabTheme = theme;
}

function selectNode(id: string | null): void {
  document.documentElement.dataset.clabSelected = id ?? "";
  document.querySelectorAll(".react-flow__node").forEach((node) => {
    node.classList.toggle("clab-viewer-selected", node.getAttribute("data-id") === id);
  });
  send({ type: "clab-viewer:select", id });
}

function renderError(error: unknown): void {
  send({ type: "clab-viewer:error", message: error instanceof Error ? error.message : "Unable to render topology" });
}

function render(msg: Omit<RenderMessage, "type">): void {
  try {
    const options = resolveViewerOptions(msg.options, msg.borderless);
    fitPadding = options.fitPadding;
    transparent = options.transparent;
    document.documentElement.dataset.clabBorderless = String(msg.borderless === true);
    root?.unmount();
    flow = null;
    root = mountViewer(container as Element, {
      yaml: msg.yaml,
      annotations: msg.annotations,
      theme: msg.theme,
      borderless: msg.borderless,
      viewerOptions: {
        ...options,
        onNodeSelect: selectNode,
        onInit: (instance) => {
          flow = instance;
        }
      },
      onReady: (description) => send({ type: "clab-viewer:loaded", ...description }),
      onError: renderError
    });
    setTheme(msg.theme ?? "dark");
  } catch (error) {
    renderError(error);
  }
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || !isAllowedOrigin(allowedOrigins, event.origin)) return;
  if (isRenderMessage(event.data)) {
    render(event.data);
    return;
  }
  if (typeof event.data !== "object" || event.data === null) return;
  const message = event.data as { type?: string; theme?: string; id?: string; appearance?: ViewerOptions["appearance"] };
  if (message.type === "clab-viewer:theme" && (message.theme === "light" || message.theme === "dark")) {
    setTheme(message.theme);
    if (message.appearance && isViewerOptions({ appearance: message.appearance })) {
      const canvas = container.querySelector<HTMLElement>(".clab-viewer-canvas");
      for (const key of ["background", "foreground", "surface", "border", "accent", "edge", "font"] as const) {
        if (key === "background" && transparent) continue;
        const value = message.appearance[key];
        if (value) canvas?.style.setProperty(`--viewer-${key}`, value);
      }
    }
  } else if (message.type === "clab-viewer:fit") {
    void flow?.fitView({ padding: fitPadding, duration: 0 });
  } else if (message.type === "clab-viewer:focus" && typeof message.id === "string") {
    selectNode(message.id);
    void flow?.fitView({ nodes: [{ id: message.id }], padding: 1, maxZoom: 1.5 });
  }
});

// Split tabs and full screen change the iframe's dimensions without remounting the graph.
let resizeFrame = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => { void flow?.fitView({ padding: fitPadding, duration: 0 }); });
}).observe(container);

const injected = viewerWindow.__CLAB_VIEWER__;
if (injected && typeof injected.yaml === "string") {
  render(injected);
} else if (window.parent !== window) {
  window.parent.postMessage({ type: "clab-viewer:ready" }, parentOrigin ?? "*");
}
