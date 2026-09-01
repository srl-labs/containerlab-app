/**
 * Lazy access to the markdown renderer. markdown-it + highlight.js are heavy,
 * so canvas components load them on demand and keep a sync handle for
 * subsequent renders.
 */
import type { renderMarkdown as renderMarkdownType } from "./markdownRenderer";

export type RenderMarkdown = typeof renderMarkdownType;

let loadedRenderer: RenderMarkdown | null = null;
let rendererPromise: Promise<RenderMarkdown> | null = null;

export function loadMarkdownRenderer(): Promise<RenderMarkdown> {
  rendererPromise ??= import("./markdownRenderer").then((module) => {
    loadedRenderer = module.renderMarkdown;
    return module.renderMarkdown;
  });
  return rendererPromise;
}

/** Returns the renderer synchronously if a previous load completed. */
export function getLoadedMarkdownRenderer(): RenderMarkdown | null {
  return loadedRenderer;
}
