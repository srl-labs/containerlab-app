import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseBooleanEnv } from "../../packages/app-server/src/env.ts";
import { resolveWebTlsConfig } from "../../packages/app-server/src/tlsConfig.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../..");
const localClabUiRoot = path.join(workspaceRoot, "packages/clab-ui");
const localClabUiSrcRoot = path.join(localClabUiRoot, "src");
const useLocalClabUi = process.env.CLAB_UI_SOURCE === "local";
const runtimeMode = process.env.VITE_CLAB_RUNTIME_MODE ?? "standalone";
const pagesMode = runtimeMode === "pages";
const apiServerPort = process.env.PORT ?? "3001";
const webProtocol = parseBooleanEnv(process.env.WEB_TLS_ENABLE, true) ? "https" : "http";
const apiServerTarget = `${webProtocol}://localhost:${apiServerPort}`;
const publicBasePath = process.env.VITE_PUBLIC_BASE_PATH ?? (pagesMode ? "/containerlab-app/" : "/");

if (useLocalClabUi && !fs.existsSync(path.join(localClabUiSrcRoot, "index.ts"))) {
  throw new Error(
    `CLAB_UI_SOURCE=local but missing ${path.join(localClabUiSrcRoot, "index.ts")}. Expected the clab-ui workspace source alongside the app.`
  );
}

const localClabUiEntrypoints = new Map([
  ["@srl-labs/clab-ui", path.join(localClabUiSrcRoot, "index.ts")],
  ["@srl-labs/clab-ui/host", path.join(localClabUiSrcRoot, "host/index.ts")],
  ["@srl-labs/clab-ui/session", path.join(localClabUiSrcRoot, "session/index.ts")],
  ["@srl-labs/clab-ui/theme", path.join(localClabUiSrcRoot, "theme/index.ts")],
  ["@srl-labs/clab-ui/explorer", path.join(localClabUiSrcRoot, "explorer/index.ts")],
  [
    "@srl-labs/clab-ui/image-manager",
    path.join(localClabUiSrcRoot, "image-manager/index.ts")
  ],
  [
    "@srl-labs/clab-ui/image-manager/catalog",
    path.join(localClabUiSrcRoot, "image-manager/catalog-entry.ts")
  ],
  ["@srl-labs/clab-ui/inspect", path.join(localClabUiSrcRoot, "inspect/index.ts")],
  ["@srl-labs/clab-ui/welcome", path.join(localClabUiSrcRoot, "welcome/index.ts")],
  [
    "@srl-labs/clab-ui/node-impairments",
    path.join(localClabUiSrcRoot, "node-impairments/index.ts")
  ],
  [
    "@srl-labs/clab-ui/wireshark-vnc",
    path.join(localClabUiSrcRoot, "wireshark-vnc/index.ts")
  ],
  ["@srl-labs/clab-ui/monaco/core", path.join(localClabUiSrcRoot, "monaco/core.ts")],
  [
    "@srl-labs/clab-ui/monaco/editor-worker",
    path.join(localClabUiSrcRoot, "monaco/editor-worker.ts")
  ],
  [
    "@srl-labs/clab-ui/monaco/json-worker",
    path.join(localClabUiSrcRoot, "monaco/json-worker.ts")
  ],
  [
    "@srl-labs/clab-ui/monaco/yaml-worker",
    path.join(localClabUiSrcRoot, "monaco/yaml-worker.ts")
  ],
  [
    "@srl-labs/clab-ui/styles/global.css",
    path.join(localClabUiSrcRoot, "styles/global.css")
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
const clabUiLocalWorkerAliases = useLocalClabUi
  ? [
    {
      find: /^@srl-labs\/clab-ui\/monaco\/editor-worker\?worker$/,
      replacement: `${path.join(localClabUiSrcRoot, "monaco/editor-worker.ts")}?worker`
    },
    {
      find: /^@srl-labs\/clab-ui\/monaco\/json-worker\?worker$/,
      replacement: `${path.join(localClabUiSrcRoot, "monaco/json-worker.ts")}?worker`
    },
    {
      find: /^@srl-labs\/clab-ui\/monaco\/yaml-worker\?worker$/,
      replacement: `${path.join(localClabUiSrcRoot, "monaco/yaml-worker.ts")}?worker`
    }
  ]
  : [];

const localClabUiWarmupFiles = useLocalClabUi
  ? [
    "index.ts",
    "host/index.ts",
    "session/index.ts",
    "theme/index.ts",
    "styles/global.css",
    "monaco/core.ts",
    "image-manager/index.ts"
  ].map((relativeFile) => path.relative(__dirname, path.join(localClabUiSrcRoot, relativeFile)))
  : [];

const localClabUiDependencySpecifiers = Array.from(localClabUiEntrypoints.keys()).filter(
  (specifier) => !specifier.endsWith(".css")
);
const monacoCoreAliasTarget = useLocalClabUi
  ? path.join(localClabUiSrcRoot, "monaco/core.ts")
  : "@srl-labs/clab-ui/monaco/core";

const workspacePackageAliases = [
  {
    find: /^@srl-labs\/containerlab-standalone-runtime\/web-main$/,
    replacement: path.resolve(workspaceRoot, "packages/standalone-runtime/src/main.tsx")
  },
  {
    find: /^@srl-labs\/containerlab-standalone-runtime\/terminal-main$/,
    replacement: path.resolve(workspaceRoot, "packages/standalone-runtime/src/terminalMain.tsx")
  },
  {
    find: /^@srl-labs\/containerlab-standalone-runtime\/wireshark-vnc-main$/,
    replacement: path.resolve(workspaceRoot, "packages/standalone-runtime/src/wiresharkVncMain.tsx")
  },
  {
    find: /^@srl-labs\/containerlab-standalone-runtime$/,
    replacement: path.resolve(workspaceRoot, "packages/standalone-runtime/src/index.ts")
  }
];

export default defineConfig(({ command }) => {
  const webTls = command === "serve" ? resolveWebTlsConfig() : undefined;

  return {
    plugins: [
      react({
        include: /\.(?:jsx|tsx)$/
      })
    ],
    define: {
      "import.meta.env.VITE_CLAB_RUNTIME_MODE": JSON.stringify(runtimeMode),
      "import.meta.env.VITE_CLAB_STANDALONE_SERVER_ORIGIN": JSON.stringify(apiServerTarget)
    },
    base: publicBasePath,
    root: __dirname,
    publicDir: path.resolve(__dirname, "resources"),
    resolve: {
      alias: [
        {
          find: /^monaco-editor$/,
          replacement: monacoCoreAliasTarget
        },
        ...workspacePackageAliases,
        ...clabUiLocalWorkerAliases,
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
        "zustand"
      ],
      exclude: useLocalClabUi ? localClabUiDependencySpecifiers : []
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
          "./src/terminalMain.tsx",
          "./src/wiresharkVncMain.tsx",
          "../../packages/standalone-runtime/src/standaloneApp.tsx",
          "../../packages/standalone-runtime/src/mainUiDependencies.ts",
          "../../packages/standalone-runtime/src/mainRuntimeDependencies.ts",
          "../../packages/standalone-runtime/src/mainApiDependencies.ts",
          ...localClabUiWarmupFiles
        ]
      },
      fs: {
        allow: [
          __dirname,
          workspaceRoot,
          localClabUiRoot
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
          terminal: path.resolve(__dirname, "terminal.html"),
          wireshark: path.resolve(__dirname, "wireshark.html")
        }
      }
    }
  };
});
