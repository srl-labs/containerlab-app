import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../..");
const clabUiSrc = path.resolve(workspaceRoot, "packages/clab-ui/src");
const publicBasePath = process.env.VITE_PUBLIC_BASE_PATH ?? "/";
const require = createRequire(path.join(__dirname, "package.json"));
const threeRoot = path.resolve(require.resolve("three"), "../..");
const threeAliases = [
  {
    find: /^three$/,
    replacement: path.join(threeRoot, "build/three.module.js")
  },
  {
    find: /^three\/addons\//,
    replacement: `${path.join(threeRoot, "examples/jsm")}/`
  }
];

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
      ...threeAliases,
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
    entries: [
      "index.html",
      "../../packages/clab-ui/src/explorer/containerlabExplorerView.webview.tsx"
    ],
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
    host: true,
    open: false,
    watch: {
      usePolling: true,
      interval: 300,
    },
    hmr: {
      overlay: true,
    },
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/standaloneApp.tsx",
        "../../packages/clab-ui/src/explorer/containerlabExplorerView.webview.tsx"
      ]
    },
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
