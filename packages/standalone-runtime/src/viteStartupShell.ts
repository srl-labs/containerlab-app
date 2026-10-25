import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
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
  font-family: var(--clab-ui-font-family, system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif);
}
#root { width: 100%; height: 100%; }
.startup-fallback {
  align-items: center; background: var(--vscode-editor-background, #1f1f1f); display: flex; inset: 0;
  justify-content: center; position: fixed;
}
.startup-fallback img { display: block; height: 136px; width: 136px; }
#root:has(> *) ~ .startup-fallback { display: none; }
`;

function packageVersion(root: string): string {
  try {
    const value: unknown = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    return typeof value === "object" && value !== null && "version" in value && typeof value.version === "string"
      ? value.version : "";
  } catch {
    return "";
  }
}

/**
 * Short hash of the checked-out commit, or empty outside a git checkout.
 * Reads the git directory directly because only packages/lab-backend runs processes.
 */
function gitCommit(root: string): string {
  try {
    let dir = root;
    while (!existsSync(path.join(dir, ".git"))) {
      const parent = path.dirname(dir);
      if (parent === dir) return "";
      dir = parent;
    }
    // Worktrees and submodules have a .git file that points at the real git directory.
    let gitDir = path.join(dir, ".git");
    if (statSync(gitDir).isFile()) {
      gitDir = path.resolve(dir, readFileSync(gitDir, "utf8").replace(/^gitdir:\s*/, "").trim());
    }
    const commonDirFile = path.join(gitDir, "commondir");
    const commonDir = existsSync(commonDirFile) ? path.resolve(gitDir, readFileSync(commonDirFile, "utf8").trim()) : gitDir;
    const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head.slice(0, 7);
    const ref = head.slice("ref: ".length);
    const looseRef = path.join(commonDir, ref);
    const sha = existsSync(looseRef)
      ? readFileSync(looseRef, "utf8").trim()
      : readFileSync(path.join(commonDir, "packed-refs"), "utf8").split("\n")
        .find((line) => line.endsWith(` ${ref}`))?.split(" ")[0] ?? "";
    return sha.slice(0, 7);
  } catch {
    return "";
  }
}

/**
 * Adds the shared document styles and startup screen to a standalone host's main page,
 * so every host shows the same chrome before the shared UI mounts.
 * Also exposes the host's version and commit as `import.meta.env.VITE_CLAB_APP_VERSION`
 * and `import.meta.env.VITE_CLAB_APP_COMMIT` for the About settings page.
 */
export function standaloneStartupShell(): Plugin {
  let base = "/";
  return {
    name: "containerlab-standalone-startup-shell",
    config(config) {
      const root = path.resolve(config.root ?? process.cwd());
      return {
        define: {
          "import.meta.env.VITE_CLAB_APP_VERSION": JSON.stringify(packageVersion(root)),
          "import.meta.env.VITE_CLAB_APP_COMMIT": JSON.stringify(gitCommit(root))
        }
      };
    },
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
