import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localClabUiRoot = path.resolve(__dirname, "../clab-ui");
const localClabUiDistRoot = path.join(localClabUiRoot, "dist");
const useLocalClabUi = process.env.CLAB_UI_SOURCE === "local";

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

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  publicDir: path.resolve(__dirname, "resources"),
  resolve: {
    alias: clabUiLocalAliases,
    dedupe: [
      "react",
      "react-dom",
      "@emotion/cache",
      "@emotion/react",
      "@emotion/styled",
      "@mui/icons-material",
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
      "@mui/icons-material",
      "@mui/material",
      "@mui/private-theming",
      "@mui/styled-engine",
      "@mui/system",
      "@mui/utils"
    ]
  },
  css: {
    postcss: path.resolve(__dirname, "postcss.config.cjs")
  },
  server: {
    port: 5173,
    open: false,
    fs: {
      allow: [
        __dirname,
        path.resolve(__dirname, "../clab-ui")
      ]
    },
    proxy: {
      "/auth": {
        target: "http://localhost:3000"
      },
      "/api": {
        target: "http://localhost:3000",
        ws: true
      },
      "/files": {
        target: "http://localhost:3000"
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
});
