import { defineHostSuiteConfig } from "@srl-labs/containerlab-test-kit/playwright";

export default defineHostSuiteConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../../test-results/preview",
  reportDir: "../../playwright-report/preview",
  baseURL: process.env.PREVIEW_TEST_URL ?? "http://127.0.0.1:8011/",
  webServer: process.env.PREVIEW_TEST_URL ? undefined : {
    command: "node test/docs/server.mjs",
    cwd: "../..",
    env: { DOCS_TEST_PREFIX: "/" },
    url: "http://127.0.0.1:8011/"
  }
});
