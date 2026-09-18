import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../..");
const clabUiSrc = path.resolve(workspaceRoot, "packages/clab-ui/src");
const publicBasePath = process.env.VITE_PUBLIC_BASE_PATH ?? "/";
const clabUiSubpathAliases = [
  ["workspace/yaml", "workspace/yaml.ts"],
  ["workspace/bootstrap", "workspace/bootstrap.ts"],
  ["workspace/editor", "workspace/editor.ts"],
  ["workspace/settings", "workspace/settings.ts"],
  ["workspace/login", "workspace/login.ts"],
  ["workspace/dialogs", "workspace/dialogs.ts"],
  ["workspace/terminal", "workspace/terminal.ts"],
  ["workspace/empty-state", "workspace/empty-state.ts"],
  ["workspace/state", "workspace/state/index.ts"],
  ["workspace/types", "workspace/types.ts"],
  ["workspace", "workspace/index.ts"],

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
      find: new RegExp(`^@containerlab/clab-ui/${subpath.replaceAll(".", "\\.")}(?=\\?|$)`),
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
    entries: [
      "index.html",
      "../../packages/clab-ui/src/**/*.tsx",
      "../../packages/clab-ui/src/**/*.ts",
      "!**/*.test.*"
    ],
    include: [
      "react",
      "react-dom",
      "@emotion/react",
      "@emotion/styled",
      "@mui/material",
      "react-dom/client"
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
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "../../packages/standalone-runtime/src/standaloneApp.tsx",
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
