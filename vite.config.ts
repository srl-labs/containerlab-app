import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  publicDir: path.resolve(__dirname, "resources"),
  resolve: {
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
    outDir: path.resolve(__dirname, "dist/client")
  }
});
