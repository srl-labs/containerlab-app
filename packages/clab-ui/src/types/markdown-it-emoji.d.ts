// The published @types/markdown-it-emoji still targets markdown-it 14's
// external declarations. Use markdown-it 15's bundled types for this plugin.
declare module "markdown-it-emoji" {
  import type MarkdownIt from "markdown-it";

  export function full(md: MarkdownIt): void;
}
