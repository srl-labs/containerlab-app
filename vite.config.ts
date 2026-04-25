import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseBooleanEnv } from "./server/env";
import { resolveWebTlsConfig } from "./server/tlsConfig";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localClabUiRoot = path.resolve(__dirname, "../clab-ui");
const localClabUiDistRoot = path.join(localClabUiRoot, "dist");
const useLocalClabUi = process.env.CLAB_UI_SOURCE === "local";
const apiServerPort = process.env.PORT ?? "3000";
const webProtocol = parseBooleanEnv(process.env.WEB_TLS_ENABLE, true) ? "https" : "http";
const apiServerTarget = `${webProtocol}://localhost:${apiServerPort}`;

if (useLocalClabUi && !fs.existsSync(path.join(localClabUiDistRoot, "index.js"))) {
  throw new Error(
    `CLAB_UI_SOURCE=local but missing ${path.join(localClabUiDistRoot, "index.js")}. Build clab-ui first (cd ../clab-ui && npm run build).`
  );
}

const localClabUiEntrypoints = new Map([
  ["@srl-labs/clab-ui", path.join(localClabUiDistRoot, "index.js")],
  ["@srl-labs/clab-ui/host", path.join(localClabUiDistRoot, "host/index.js")],
  ["@srl-labs/clab-ui/session", path.join(localClabUiDistRoot, "session/index.js")],
  ["@srl-labs/clab-ui/theme", path.join(localClabUiDistRoot, "theme/index.js")],
  ["@srl-labs/clab-ui/explorer", path.join(localClabUiDistRoot, "explorer/index.js")],
  ["@srl-labs/clab-ui/inspect", path.join(localClabUiDistRoot, "inspect/index.js")],
  ["@srl-labs/clab-ui/welcome", path.join(localClabUiDistRoot, "welcome/index.js")],
  [
    "@srl-labs/clab-ui/node-impairments",
    path.join(localClabUiDistRoot, "node-impairments/index.js")
  ],
  [
    "@srl-labs/clab-ui/wireshark-vnc",
    path.join(localClabUiDistRoot, "wireshark-vnc/index.js")
  ],
  [
    "@srl-labs/clab-ui/styles/global.css",
    path.join(localClabUiDistRoot, "styles/global.css")
  ]
]);

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const clabUiLocalAliases = useLocalClabUi
  ? Array.from(localClabUiEntrypoints.entries()).map(([find, replacement]) => ({
      find: new RegExp(`^${escapeRegex(find)}$`),
      replacement
    }))
  : [];

const localClabUiWarmupFiles = useLocalClabUi
  ? [
      "../clab-ui/dist/index.js",
      "../clab-ui/dist/host/index.js",
      "../clab-ui/dist/session/index.js",
      "../clab-ui/dist/theme/index.js",
      "../clab-ui/dist/styles/global.css",
      "../clab-ui/dist/chunks/*.js"
    ]
  : [];

const localClabUiOptimizedDependencies = useLocalClabUi
  ? Array.from(localClabUiEntrypoints.keys()).filter(
      (specifier) => !specifier.endsWith(".css")
    )
  : [];

export default defineConfig(({ command }) => {
  const webTls = command === "serve" ? resolveWebTlsConfig() : undefined;

  return {
    plugins: [
      react({
        include: /\.(?:jsx|tsx)$/
      })
    ],
    root: __dirname,
    publicDir: path.resolve(__dirname, "resources"),
    resolve: {
      alias: [
        {
          find: /^monaco-editor$/,
          replacement: path.resolve(__dirname, "src/monacoCore.ts")
        },
        ...clabUiLocalAliases
      ],
      dedupe: [
        "react",
        "react-dom",
        "@emotion/cache",
        "@emotion/react",
        "@emotion/styled",
        "@mui/material",
        "@mui/private-theming",
        "@mui/styled-engine",
        "@mui/system",
        "@mui/utils"
      ]
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "@emotion/cache",
        "@emotion/react",
        "@emotion/styled",
        "@mui/material",
        "@mui/private-theming",
        "@mui/styled-engine",
        "@mui/system",
        "@mui/utils",
        "@xterm/addon-fit",
        "@xterm/xterm",
        "@xyflow/react",
        "three",
        "zustand",
        ...localClabUiOptimizedDependencies
      ]
    },
    css: {
      postcss: path.resolve(__dirname, "postcss.config.cjs")
    },
    server: {
      port: 5173,
      open: false,
      https: webTls?.https,
      warmup: {
        clientFiles: [
          "./src/main.tsx",
          "./src/standaloneApp.tsx",
          "./src/mainUiDependencies.ts",
          "./src/mainRuntimeDependencies.ts",
          "./src/mainApiDependencies.ts",
          ...localClabUiWarmupFiles
        ]
      },
      fs: {
        allow: [
          __dirname,
          path.resolve(__dirname, "../clab-ui")
        ]
      },
      proxy: {
        "/auth": {
          target: apiServerTarget,
          secure: false
        },
        "/api": {
          target: apiServerTarget,
          secure: false,
          ws: true
        },
        "/files": {
          target: apiServerTarget,
          secure: false
        }
      }
    },
    build: {
      outDir: path.resolve(__dirname, "dist/client"),
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
          wireshark: path.resolve(__dirname, "wireshark.html")
        }
      }
    }
  };
});
