import path from "node:path";
import { defineConfig, mergeConfig } from "vite";
import viewerConfig from "../clab-ui/vite.viewer.config";

// Both distributions compile the same renderer. All browser dependencies, including
// React, are bundled so installing the viewer never installs the editor package.
export default defineConfig(mergeConfig(viewerConfig, {
  build: {
    outDir: path.join(import.meta.dirname, "dist"),
    cssCodeSplit: false,
    // Keep the static page's startup preloads. JS consumers may rename chunks
    // when rebundling, so their bundler must own dynamic preload URLs.
    modulePreload: {
      resolveDependencies: (_url: string, dependencies: string[], context: { hostType: "html" | "js" }) =>
        context.hostType === "html" ? dependencies : []
    },
    rolldownOptions: {
      preserveEntrySignatures: "exports-only",
      input: {
        viewer: path.join(import.meta.dirname, "../clab-ui/viewer.html"),
        index: path.join(import.meta.dirname, "src/index.ts")
      },
      output: {
        entryFileNames: (chunk: { name: string }) => chunk.name === "index" ? "index.js" : "assets/[name]-[hash].js",
        assetFileNames: (asset: { names: string[] }) => asset.names.some(name => name.endsWith(".css")) ? "styles.css" : "assets/[name]-[hash][extname]"
      }
    }
  }
}));
