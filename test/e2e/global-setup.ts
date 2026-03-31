export default async function globalSetup(): Promise<void> {
  // The E2E suite runs against the standalone-backed local dev flow.
  // Keep the hook for parity with Playwright config without mutating tracked files.
}
