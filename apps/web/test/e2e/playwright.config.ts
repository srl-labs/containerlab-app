import { defineHostSuiteConfig } from "@srl-labs/containerlab-test-kit/playwright";

// Runs against the Vite dev server and the local app server started by `pnpm run dev`.
export default defineHostSuiteConfig({
  testDir: "./specs",
  reportDir: "../../playwright-report",
  baseURL: "https://localhost:5173",
  use: { ignoreHTTPSErrors: true },
  webServer: {
    command: "pnpm run dev",
    ignoreHTTPSErrors: true,
    url: "https://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    cwd: "../.."
  }
});
