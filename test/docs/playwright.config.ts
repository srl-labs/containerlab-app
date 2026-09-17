import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../../test-results/docs",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  timeout: 45000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:8011/containerlab-app/docs/",
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 10000,
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "node test/docs/server.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:8011/containerlab-app/docs/",
    reuseExistingServer: !process.env.CI
  }
});
