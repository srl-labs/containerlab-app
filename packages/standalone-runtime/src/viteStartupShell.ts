import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/** Static assets served by every standalone host (web, desktop and the sandbox). */
export const standalonePublicDir = fileURLToPath(new URL("../public", import.meta.url));

export const STARTUP_LOGO = "clab-animated-no-logo.svg";

const SHELL_STYLE = `
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
body {
  background-color: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}
#root { width: 100%; height: 100%; }
.startup-fallback {
  align-items: center; background: var(--vscode-editor-background, #1f1f1f); display: flex; inset: 0;
  justify-content: center; position: fixed;
}
.startup-fallback img { display: block; height: 136px; width: 136px; }
#root:has(> *) ~ .startup-fallback { display: none; }
`;

/**
 * Adds the shared document styles and startup screen to a standalone host's main page,
 * so every host shows the same chrome before the shared UI mounts.
 */
export function standaloneStartupShell(): Plugin {
  let base = "/";
  return {
    name: "containerlab-standalone-startup-shell",
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml(_html, context) {
      if (!context.filename.endsWith("index.html")) return;
      return [
        { tag: "style", children: SHELL_STYLE, injectTo: "head" },
        {
          tag: "div",
          attrs: { class: "startup-fallback" },
          children: `<img src="${base}${STARTUP_LOGO}" alt="Containerlab" width="136" height="136" />`,
          injectTo: "body"
        }
      ];
    }
  };
}
