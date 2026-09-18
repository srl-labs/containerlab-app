import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../../test-results/preview",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.PREVIEW_TEST_URL ?? "http://127.0.0.1:8011/",
    trace: "retain-on-failure"
  },
  webServer: process.env.PREVIEW_TEST_URL ? undefined : {
    command: "node test/docs/server.mjs",
    cwd: "../..",
    env: { DOCS_TEST_PREFIX: "/" },
    url: "http://127.0.0.1:8011/"
  }
});
