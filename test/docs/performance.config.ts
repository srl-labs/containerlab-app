import { defineConfig } from "@playwright/test";
import docs from "./playwright.config";

// Keep timings away from concurrently running functional tests.
export default defineConfig(docs, {
  testMatch: "performance.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0
});
