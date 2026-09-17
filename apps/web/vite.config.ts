import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseBooleanEnv } from "../../packages/app-server/src/env.ts";
import { resolveWebTlsConfig } from "../../packages/app-server/src/tlsConfig.ts";
import { normalizeBasePath } from "../../packages/app-server/src/basePath.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../..");
const runtimeMode = process.env.VITE_CLAB_RUNTIME_MODE ?? "standalone";
const pagesMode = runtimeMode === "pages";
const apiServerPort = process.env.PORT ?? "3001";
const webProtocol = parseBooleanEnv(process.env.WEB_TLS_ENABLE, true) ? "https" : "http";
const apiServerTarget = `${webProtocol}://localhost:${apiServerPort}`;
const serverBasePath = normalizeBasePath(process.env.WEB_BASE_PATH);

export default defineConfig(({ command }) => {
  const webTls = command === "serve" ? resolveWebTlsConfig() : undefined;
  const standaloneBasePath = command === "serve" ? `${serverBasePath}/` : "./";
  const publicBasePath = process.env.VITE_PUBLIC_BASE_PATH ?? (
    pagesMode ? "/containerlab-app/" : standaloneBasePath
  );

  return {
    plugins: [
      {
        name: "app-document-base",
        apply: "serve",
        transformIndexHtml: () => [{
          tag: "base",
          attrs: { href: publicBasePath },
          injectTo: "head-prepend"
        }]
      },
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
      // Scan the shared UI's lazy chunks before serving pages so discovering a
      // panel does not invalidate optimized dependencies in other open tabs.
      entries: ["*.html", "../../packages/clab-ui/dist/**/*.js"],
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
          "../../packages/standalone-runtime/src/mainApiDependencies.ts"
        ]
      },
      fs: {
        allow: [
          __dirname,
          workspaceRoot
        ]
      },
      proxy: {
        [`${serverBasePath}/auth`]: {
          target: apiServerTarget,
          secure: false
        },
        [`${serverBasePath}/api`]: {
          target: apiServerTarget,
          secure: false,
          ws: true
        },
        [`${serverBasePath}/files`]: {
          target: apiServerTarget,
          secure: false
        }
      }
    },
    build: {
      outDir: path.resolve(__dirname, "dist/client"),
      rolldownOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
          terminal: path.resolve(__dirname, "terminal.html"),
          wireshark: path.resolve(__dirname, "wireshark.html")
        }
      }
    }
  };
});
