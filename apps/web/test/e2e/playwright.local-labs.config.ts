import { defineHostSuiteConfig } from "@srl-labs/containerlab-test-kit/playwright";

// Runs against a web app started with WEB_LOCAL_LABS=true, such as the
// container image on a lab host. Set WEB_LOCAL_E2E_URL to its address.
export default defineHostSuiteConfig({
  testDir: "./local-labs",
  reportDir: "../../playwright-report/local-labs",
  ciWorkers: 1,
  localWorkers: 1,
  timeout: 300_000,
  expectTimeout: 30_000,
  use: { baseURL: process.env.WEB_LOCAL_E2E_URL, ignoreHTTPSErrors: true }
});
