import { test as base, expect, type Page, type TestInfo } from "@playwright/test";

const EXPECTED_HTTP_ERROR = /^Failed to load resource: the server responded with a status of (401|403|404)(?: |$|\()/;

export interface BrowserErrorOptions {
  /** Console errors a test expects; anything else fails the test. */
  allowedBrowserErrors: RegExp[];
}

/** Records uncaught page errors and console errors that a test does not expect. */
export function watchBrowserErrors(page: Page, allowed: readonly RegExp[] = []): string[] {
  const errors: string[] = [];
  const isAllowed = (text: string) =>
    EXPECTED_HTTP_ERROR.test(text) || allowed.some((pattern) => pattern.test(text));
  page.on("console", (message) => {
    if (message.type() === "error" && !isAllowed(message.text())) errors.push(`[console] ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`[pageerror] ${error.stack ?? error.message}`));
  return errors;
}

export async function expectNoBrowserErrors(errors: readonly string[], testInfo: TestInfo): Promise<void> {
  if (errors.length === 0) return;
  const body = errors.join("\n");
  await testInfo.attach("browser-errors", { body, contentType: "text/plain" });
  throw new Error(`Browser errors detected:\n${body}`);
}

/** Fails a test on uncaught page errors or unexpected console errors. */
export const test = base.extend<BrowserErrorOptions>({
  allowedBrowserErrors: [[], { option: true }],
  page: async ({ page, allowedBrowserErrors }, provide, testInfo) => {
    const errors = watchBrowserErrors(page, allowedBrowserErrors);
    await provide(page);
    await expectNoBrowserErrors(errors, testInfo);
  }
});

export { expect };
