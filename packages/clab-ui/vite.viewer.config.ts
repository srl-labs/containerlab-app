import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Builds the standalone, self-contained topology viewer (viewer.html + src/viewer/entry.tsx) into
// dist-viewer/. Unlike the library build (build.mjs, which externalizes deps), this bundles React,
// MUI, @xyflow/react, etc. so the output can be served as static files and embedded in an <iframe>
// by any host app regardless of its own React version. Relative base so it can live under a subpath.
export default defineConfig({
  root: __dirname,
  base: "./",
  build: {
    outDir: "dist-viewer",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "viewer.html")
    }
  }
});
