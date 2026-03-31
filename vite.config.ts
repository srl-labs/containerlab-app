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
    dedupe: ["react", "react-dom"]
  },
  optimizeDeps: {
    include: ["react", "react-dom"]
  },
  css: {
    postcss: path.resolve(__dirname, "postcss.config.cjs")
  },
  server: {
    port: 5173,
    open: false,
    proxy: {
      "/auth": "http://localhost:3000",
      "/api": "http://localhost:3000",
      "/files": "http://localhost:3000"
    }
  },
  build: {
    outDir: path.resolve(__dirname, "dist/client")
  }
});
