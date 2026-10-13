// Frame ink for the built-in icons. Icons are images, so they cannot follow
// theme CSS variables; the ink is resolved here and passed to the generator.
import { createContext, useContext, useSyncExternalStore } from "react";

import { parseLuminance } from "../utils/color";

import { ICON_INK } from "./SvgGenerator";

/** The background icons on the canvas sit on, when a view knows it (e.g. the viewer's paper). */
export const IconBackgroundContext = createContext<string | null>(null);

function readThemeBackground(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const style = getComputedStyle(document.documentElement);
    for (const name of ["--clab-ui-editor-background", "--vscode-editor-background"]) {
      const value = style.getPropertyValue(name).trim();
      if (value.length > 0) return value;
    }
  } catch {
    // No computed styles outside a browser.
  }
  return null;
}

function isLightDocument(): boolean {
  if (typeof document === "undefined") return false;
  const { body, documentElement } = document;
  return (
    documentElement.classList.contains("light") ||
    body.classList.contains("vscode-light") ||
    body.classList.contains("vscode-high-contrast-light")
  );
}

/**
 * Ink for icons drawn on `background`, or on the current theme's editor
 * background when none is given.
 */
export function getIconInk(background?: string | null): string {
  const color = background !== undefined && background !== null && background.length > 0
    ? background
    : readThemeBackground();
  const luminance = color === null ? null : parseLuminance(color);
  if (luminance === null) return isLightDocument() ? ICON_INK.light : ICON_INK.dark;
  return luminance > 0.5 ? ICON_INK.light : ICON_INK.dark;
}

// One observer for every icon: theme swaps change class/style on <html> or
// <body>, and the Containerlab color scheme override adds its own stylesheet.
const listeners = new Set<() => void>();
let themeInk: string | null = null;
let disconnect: (() => void) | null = null;

function notify(): void {
  const next = getIconInk();
  if (next === themeInk) return;
  themeInk = next;
  for (const listener of listeners) listener();
}

function observeTheme(): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => undefined;
  }
  const attributes = new MutationObserver(notify);
  const options = { attributes: true, attributeFilter: ["class", "style"] };
  attributes.observe(document.documentElement, options);
  attributes.observe(document.body, options);
  const isAppearanceStyle = (node: Node) =>
    node instanceof HTMLStyleElement && node.dataset.containerlabAppearance !== undefined;
  const stylesheets = new MutationObserver((records) => {
    const changed = records.some((record) =>
      [...record.addedNodes, ...record.removedNodes].some(isAppearanceStyle)
    );
    if (changed) notify();
  });
  stylesheets.observe(document.head, { childList: true });
  return () => {
    attributes.disconnect();
    stylesheets.disconnect();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  disconnect ??= observeTheme();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    disconnect?.();
    disconnect = null;
    themeInk = null;
  };
}

function getThemeInk(): string {
  themeInk ??= getIconInk();
  return themeInk;
}

function getServerInk(): string {
  return ICON_INK.dark;
}

/**
 * Frame ink for icons on `background`, or on the theme background (kept
 * current across theme changes) when it is unset.
 */
export function useIconInk(background?: string | null): string {
  const ink = useSyncExternalStore(subscribe, getThemeInk, getServerInk);
  return background !== undefined && background !== null && background.length > 0
    ? getIconInk(background)
    : ink;
}

/**
 * Frame ink for icons on the canvas: the view's background, the lab's canvas
 * color, or the theme, in that order.
 */
export function useCanvasIconInk(canvasColor?: string | null): string {
  const viewBackground = useContext(IconBackgroundContext);
  return useIconInk(viewBackground ?? canvasColor);
}
