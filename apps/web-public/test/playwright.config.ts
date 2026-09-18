import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 60_000,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5174", reducedMotion: "reduce", trace: "retain-on-failure" },
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:5174", reuseExistingServer: !process.env.CI, cwd: ".." }
});
