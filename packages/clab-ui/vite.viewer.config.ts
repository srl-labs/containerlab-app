import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Builds the standalone, self-contained topology viewer (viewer.html + src/viewer/entry.tsx) into
// dist-viewer/. Unlike the library build (build.mjs, which externalizes deps), this bundles React
// and the read-only canvas so the output can be served as static files and embedded in an <iframe>
// by any host app regardless of its own React version. Relative base so it can live under a subpath.
export default defineConfig({
  root: __dirname,
  base: "./",
  publicDir: path.resolve(__dirname, "viewer-assets"),
  plugins: [{
    name: "viewer-startup-budget",
    generateBundle: { order: "post", handler(_, bundle) {
      const initial = new Set<string>();
      const visit = (name: string) => {
        if (initial.has(name)) return;
        const chunk = bundle[name];
        if (chunk?.type !== "chunk") return;
        initial.add(name);
        chunk.imports.forEach(visit);
      };
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === "chunk" && chunk.isEntry) visit(chunk.fileName);
      }
      const files = [...initial].map(name => {
        const chunk = bundle[name];
        if (chunk.type !== "chunk") throw new Error(`Missing viewer chunk: ${name}`);
        const forbidden = Object.keys(chunk.modules).find(id => /(?:monaco-editor|maplibre-gl|elkjs|@mui\/|@emotion\/|\/src\/App(?:Content)?\.tsx|\/core\/host\/)/.test(id));
        if (forbidden) this.error(`Editor dependency entered the viewer startup bundle: ${forbidden}`);
        return { name, bytes: Buffer.byteLength(chunk.code), gzip: gzipSync(chunk.code).byteLength };
      });
      for (const asset of Object.values(bundle)) {
        if (asset.type === "asset" && /^assets\/viewer-.*\.css$/.test(asset.fileName)) {
          files.push({ name: asset.fileName, bytes: Buffer.byteLength(asset.source), gzip: gzipSync(asset.source).byteLength });
        }
      }
      const gzipBytes = files.reduce((sum, file) => sum + file.gzip, 0);
      const cssBytes = files.filter(file => file.name.endsWith(".css")).reduce((sum, file) => sum + file.bytes, 0);
      if (gzipBytes > 250_000 || cssBytes > 25_000) {
        this.error(`Viewer startup budget exceeded: ${gzipBytes} gzip bytes (limit 250000), ${cssBytes} CSS bytes (limit 25000).`);
      }
      this.emitFile({ type: "asset", fileName: "startup-budget.json", source: JSON.stringify({ gzipBytes, cssBytes, files }, null, 2) });
    } }
  }],
  build: {
    outDir: "dist-viewer",
    emptyOutDir: true,
    rolldownOptions: {
      input: path.resolve(__dirname, "viewer.html"),
      onwarn(warning, warn) {
        // This viewer runs entirely in the browser; dependency RSC client
        // boundaries have no effect here. Keep all other warnings visible.
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          warning.id?.replaceAll("\\", "/").includes("/node_modules/") &&
          warning.message.includes('"use client"')
        ) {
          return;
        }
        warn(warning);
      }
    }
  }
});
