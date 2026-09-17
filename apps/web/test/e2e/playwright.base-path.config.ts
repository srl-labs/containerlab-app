import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./base-path",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: { browserName: "chromium", actionTimeout: 15_000, navigationTimeout: 30_000, trace: "retain-on-failure" }
});
