import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../..");
const clabUiSrc = path.resolve(workspaceRoot, "packages/clab-ui/src");
// GitHub Pages serves under /<repo>/; Cloudflare sandbox overrides to "/".
const publicBasePath = process.env.VITE_PUBLIC_BASE_PATH ?? "/containerlab-app/";

const clabUiSubpathAliases = [
  ["styles/global.css", "styles/global.css"],
  ["monaco/editor-worker", "monaco/editor-worker.ts"],
  ["monaco/json-worker", "monaco/json-worker.ts"],
  ["monaco/yaml-worker", "monaco/yaml-worker.ts"],
  ["monaco/core", "monaco/core.ts"],
  ["image-manager", "image-manager/index.ts"],
  ["explorer", "explorer/index.ts"],
  ["session", "session/index.ts"],
  ["theme", "theme/index.ts"],
  ["host", "host/index.ts"],
  ["yaml", "yaml/index.ts"]
] as const;

function clabUiDevAliases(): Array<{ find: string | RegExp; replacement: string }> {
  return [
    ...clabUiSubpathAliases.map(([subpath, file]) => ({
      find: `@containerlab/clab-ui/${subpath}`,
      replacement: path.join(clabUiSrc, file)
    })),
    {
      find: /^@containerlab\/clab-ui$/,
      replacement: path.join(clabUiSrc, "index.ts")
    }
  ];
}

export default defineConfig(({ command }) => ({
  plugins: [
    react({
      include: /\.(?:jsx|tsx)$/
    })
  ],
  base: publicBasePath,
  root: __dirname,
  publicDir: path.resolve(__dirname, "resources"),
  resolve: {
    alias: [
      ...(command === "serve" ? clabUiDevAliases() : []),
      {
        find: /^monaco-editor$/,
        replacement: "@containerlab/clab-ui/monaco/core"
      }
    ],
    dedupe: [
      "react",
      "react-dom",
      "@emotion/react",
      "@emotion/styled",
      "@mui/material",
    ]
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "@emotion/react",
      "@emotion/styled",
      "@mui/material",
      "@xterm/addon-fit",
      "@xterm/xterm",
      "three",
      "zustand"
    ],
    exclude: ["@containerlab/clab-ui"]
  },
  css: {
    postcss: path.resolve(__dirname, "postcss.config.cjs")
  },
  server: {
    port: 5174,
    open: false,
    fs: {
      allow: [
        __dirname,
        workspaceRoot
      ]
    }
  },
  build: {
    outDir: path.resolve(__dirname, "dist/client"),
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html")
      }
    }
  }
}));
