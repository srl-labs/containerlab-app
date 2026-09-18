import { readFileSync } from "node:fs";
import path from "node:path";
import type { KnipConfig, WorkspaceProjectConfig } from "knip";

const root = import.meta.dirname;
const uiDirectory = "packages/clab-ui";
const uiPackage = JSON.parse(
  readFileSync(path.join(root, uiDirectory, "package.json"), "utf8")
) as { name: string; exports: Record<string, string | { types: string }> };

// The library bundles JavaScript, but emits declarations with the source layout.
// Derive source aliases and public entry points from that published API so new
// subpaths are covered without maintaining a second list of library exports.
const uiSources = Object.entries(uiPackage.exports).flatMap<[string, string]>(([subpath, target]) =>
  typeof target === "string"
    ? []
    : [
        [
          uiPackage.name + (subpath === "." ? "" : subpath.slice(1)),
          path.posix.join(
            uiDirectory,
            target.types.replace("./dist/", "src/").replace(/\.d\.ts$/, ".ts")
          )
        ]
      ]
);

const workspaces: Record<string, WorkspaceProjectConfig> = {
  ".": {
    entry: [
      // Loaded as a module by docs-overrides/main.html.
      "docs/assets/javascripts/customization.mjs",
      "scripts/run-stress-api-bff.mjs",
      "scripts/stress-api-bff.mjs",
      "scripts/impairment-proxy.mjs",
      "scripts/wait-web-server.mjs",
      "scripts/fixtures/clab-ui-consumer.ts"
    ],
    // Python documentation tooling is installed through uv.lock.
    ignoreBinaries: ["uv"]
  },
  "apps/desktop": {
    entry: ["scripts/after-pack.cjs"],
    // Provided by WSL for the native Windows development launcher.
    ignoreBinaries: ["wslpath"]
  },
  "apps/web": {
    entry: ["src/terminalMain.tsx", "src/wiresharkVncMain.tsx"]
  },
  "apps/web-public": {},
  "apps/vscode-containerlab": {
    entry: ["src/webviews/*/entry.tsx", "test/**/*.test.ts"],
    ignoreDependencies: [
      // Loaded by Mocha using the reporter name in .mocharc.json / the test script.
      "mochawesome",
      // esbuild.config.js resolves the worker from clab-ui's own dependencies.
      "maplibre-gl",
      // buildCss in esbuild.config.js constructs a `pnpm exec postcss` shell command.
      "postcss-cli"
    ]
  },
  "packages/app-contract": {},
  "packages/clab-viewer": {
    entry: ["src/index.ts"]
  },
  "packages/app-server": {
    entry: ["src/**/*.test.ts"],
    // The TLS certificate generator invokes the operating system's OpenSSL.
    ignoreBinaries: ["openssl"]
  },
  "packages/standalone-runtime": {
    entry: ["src/**/*.test.ts"]
  },
  [uiDirectory]: {
    entry: [
      ...uiSources.map(([, source]) => path.posix.relative(uiDirectory, source)),
      "src/viewer/entry.tsx",
      "viewer-assets/component.mjs",
      "src/**/*.test.{ts,tsx}",
      "docs/javascripts/mermaid-config.js"
    ]
  }
};

for (const [directory, workspace] of Object.entries(workspaces)) {
  workspace.paths = Object.fromEntries(
    uiSources.map(([specifier, source]) => [specifier, [path.posix.relative(directory, source)]])
  );
}

export default { workspaces } satisfies KnipConfig;
