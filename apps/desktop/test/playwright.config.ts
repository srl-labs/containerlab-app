import { defineHostSuiteConfig } from "@srl-labs/containerlab-test-kit/playwright";

// Each file launches the Electron app; set DESKTOP_EXECUTABLE to test a packaged build.
export default defineHostSuiteConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  reportDir: "../playwright-report",
  ciWorkers: 1,
  localWorkers: 1
});
