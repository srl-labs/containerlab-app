import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "../..");
// GitHub Pages serves under /<repo>/; Cloudflare sandbox overrides to "/".
const publicBasePath = process.env.VITE_PUBLIC_BASE_PATH ?? "/containerlab-app/";

export default defineConfig({
  plugins: [
    react({
      include: /\.(?:jsx|tsx)$/
    })
  ],
  define: {
    "import.meta.env.VITE_CLAB_RUNTIME_MODE": JSON.stringify("pages"),
    // No API server in the public app; requests are served by the in-browser shim.
    "import.meta.env.VITE_CLAB_STANDALONE_SERVER_ORIGIN": JSON.stringify("")
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
});
