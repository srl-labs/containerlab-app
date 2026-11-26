import type { Page } from "@playwright/test";
import { expect, test } from "@srl-labs/containerlab-test-kit/playwright";

import { buildDetachedTerminalUrl } from "../../../../../packages/standalone-runtime/src/runtimeDetachedTerminal";

async function terminalRows(page: Page): Promise<number> {
  return page.locator(".xterm-rows > div").count();
}

test("a terminal in its own window fills the window height and follows it", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  // An output terminal needs no terminal session, so the page renders without a lab host.
  const output = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n");
  await page.goto(
    buildDetachedTerminalUrl(
      { nodeName: "srl1", title: "srl1 output", protocol: "output", initialOutput: output },
      `${baseURL}/`
    )
  );

  const pane = page.getByTestId("runtime-terminal-pane");
  await expect(pane).toBeVisible();
  await expect.poll(async () => (await pane.boundingBox())?.height).toBe(900);
  // xterm.js starts each terminal at 24 rows; the fit grows it to the window height.
  await expect.poll(() => terminalRows(page)).toBeGreaterThan(24);
  const tallRows = await terminalRows(page);

  await page.setViewportSize({ width: 900, height: 500 });
  await expect.poll(async () => (await pane.boundingBox())?.height).toBe(500);
  await expect.poll(() => terminalRows(page)).toBeLessThan(tallRows);
});
