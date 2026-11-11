import { defineHostSuiteConfig } from "@srl-labs/containerlab-test-kit/playwright";

// Opt-in: runs specs/images-live.spec.ts against a server that is already running.
// Set IMAGES_LIVE_URL (see the spec); nothing is started here.
export default defineHostSuiteConfig({
  testDir: "./specs",
  testMatch: "images-live.spec.ts",
  reportDir: "../../playwright-report/images-live",
  outputDir: "../../test-results/images-live",
  ciWorkers: 1,
  localWorkers: 1,
  timeout: 240_000,
  expectTimeout: 30_000,
  use: {
    baseURL: process.env.IMAGES_LIVE_URL,
    ignoreHTTPSErrors: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } } : {})
  }
});
