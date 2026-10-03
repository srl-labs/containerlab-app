import { defineHostSuiteConfig } from "@srl-labs/containerlab-test-kit/playwright";

export default defineHostSuiteConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  reportDir: "../playwright-report",
  baseURL: "http://127.0.0.1:5174",
  use: { reducedMotion: "reduce" },
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:5174", reuseExistingServer: !process.env.CI, cwd: ".." }
});
