import { test as base, expect } from "@playwright/test";

const EXPECTED_HTTP_ERROR = /^Failed to load resource: the server responded with a status of (401|403|404)(?: |$|\()/;

export interface BrowserErrorOptions {
  /** Console errors a test expects; anything else fails the test. */
  allowedBrowserErrors: RegExp[];
}

/** Fails a test on uncaught page errors or unexpected console errors. */
export const test = base.extend<BrowserErrorOptions>({
  allowedBrowserErrors: [[], { option: true }],
  page: async ({ page, allowedBrowserErrors }, provide, testInfo) => {
    const errors: string[] = [];
    const allowed = (text: string) =>
      EXPECTED_HTTP_ERROR.test(text) || allowedBrowserErrors.some((pattern) => pattern.test(text));
    page.on("console", (message) => {
      if (message.type() === "error" && !allowed(message.text())) errors.push(`[console] ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`[pageerror] ${error.stack ?? error.message}`));

    await provide(page);

    if (errors.length > 0) {
      const body = errors.join("\n");
      await testInfo.attach("browser-errors", { body, contentType: "text/plain" });
      throw new Error(`Browser errors detected:\n${body}`);
    }
  }
});

export { expect };
