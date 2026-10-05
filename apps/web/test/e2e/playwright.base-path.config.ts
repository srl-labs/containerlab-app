import { defineHostSuiteConfig } from "@srl-labs/containerlab-test-kit/playwright";

// Each spec starts its own production and development servers under a base path.
export default defineHostSuiteConfig({
  testDir: "./base-path",
  reportDir: "../../playwright-report/base-path",
  ciWorkers: 1,
  localWorkers: 1,
  timeout: 90_000,
  expectTimeout: 30_000
});
