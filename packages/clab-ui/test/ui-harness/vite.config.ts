import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  server: {
    host: "127.0.0.1",
    port: 5184,
    strictPort: true
  },
  resolve: {
    alias: {
      "@srl-labs/clab-ui": path.resolve(__dirname, "../../src/index.ts"),
      "@srl-labs/clab-ui/host": path.resolve(__dirname, "../../src/host/index.ts"),
      "@srl-labs/clab-ui/session": path.resolve(__dirname, "../../src/session/index.ts"),
      "@srl-labs/clab-ui/theme": path.resolve(__dirname, "../../src/theme/index.ts"),
      "@srl-labs/clab-ui/styles/global.css": path.resolve(__dirname, "../../src/styles/global.css")
    }
  }
});
