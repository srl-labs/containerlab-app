import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

const isCI = Boolean(process.env.CI);

export interface HostSuiteOptions {
  testDir: string;
  /** Folder for the HTML report; CI uploads it when a suite fails. */
  reportDir: string;
  baseURL?: string;
  webServer?: PlaywrightTestConfig["webServer"];
  /** Parallel workers in CI; local runs default to twice as many. */
  ciWorkers?: number;
  localWorkers?: number;
  timeout?: number;
  use?: PlaywrightTestConfig["use"];
  expectTimeout?: number;
  testMatch?: PlaywrightTestConfig["testMatch"];
  outputDir?: string;
}

/** Shared Playwright conventions for every host's browser suite. */
export function defineHostSuiteConfig(options: HostSuiteOptions) {
  const ciWorkers = options.ciWorkers ?? 2;
  return defineConfig({
    testDir: options.testDir,
    testMatch: options.testMatch,
    outputDir: options.outputDir,
    fullyParallel: false,
    forbidOnly: isCI,
    retries: isCI ? 1 : 0,
    workers: isCI ? ciWorkers : (options.localWorkers ?? ciWorkers * 2),
    timeout: options.timeout ?? 60_000,
    expect: { timeout: options.expectTimeout ?? 10_000 },
    reporter: [["list"], ["html", { open: "never", outputFolder: options.reportDir }]],
    use: {
      ...devices["Desktop Chrome"],
      baseURL: options.baseURL,
      permissions: ["clipboard-read", "clipboard-write"],
      trace: "retain-on-failure",
      screenshot: "only-on-failure",
      actionTimeout: 15_000,
      navigationTimeout: 30_000,
      ...options.use
    },
    webServer: options.webServer
  });
}
