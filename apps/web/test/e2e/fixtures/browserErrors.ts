import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const browserErrors: string[] = [];

    const isExpectedHttpResourceError = (text: string): boolean =>
      /^Failed to load resource: the server responded with a status of (401|403|404)(?: |$|\()/.test(
        text
      );

    page.on("console", (msg) => {
      if (msg.type() === "error" && !isExpectedHttpResourceError(msg.text())) {
        browserErrors.push(`[CONSOLE] ${msg.text()}`);
      }
    });

    page.on("pageerror", (error) => {
      browserErrors.push(`[PAGEERROR] ${error.stack ?? error.message}`);
    });

    await use(page);

    if (browserErrors.length > 0) {
      const body = browserErrors.join("\n");
      await testInfo.attach("browser-errors", {
        body,
        contentType: "text/plain"
      });
      throw new Error(`Browser errors detected:\n${body}`);
    }
  }
});

export { expect };
