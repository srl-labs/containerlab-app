import type { Page } from "@playwright/test";

import type { BrowserDevApi } from "../devApi";
import { test, expect } from "../fixtures/topoviewer";

const SIMPLE_FILE = "simple.clab.yml";

async function emitStats(page: Page, data: Record<string, unknown>): Promise<void> {
  await page.evaluate((payload) => {
    (window as { __DEV__?: BrowserDevApi }).__DEV__?.emitHostMessage({ type: "node-stats-update", data: payload });
  }, data);
}

async function emitCpu(page: Page, cpuByNode: Record<string, number | undefined>): Promise<void> {
  await emitStats(page, {
    sample: {
      time: new Date().toISOString(),
      intervalSeconds: 2,
      nodes: Object.entries(cpuByNode).map(([nodeName, cpuPercent]) => ({
        name: `container-of-${nodeName}`,
        nodeName,
        ...(cpuPercent === undefined ? {} : { cpuPercent }),
        memoryBytes: 256 * 1024 ** 2
      }))
    }
  });
}

/**
 * Running nodes carry a small badge with their CPU usage from the host's
 * stats stream, unless the lab turns it off in Appearance.
 */
test.describe("Node CPU badge", () => {
  test.beforeEach(async ({ page, topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
    await page.evaluate(() => {
      window.__DEV__?.setDeploymentState?.("deployed");
    });
  });

  test("running nodes show their CPU usage, rounded, and lose it when they stop", async ({ page, topoViewerPage }) => {
    const [first, second] = await topoViewerPage.getNodeIds();
    await topoViewerPage.setZoom(1);
    // A node's first sample has no CPU yet.
    await emitCpu(page, { [first]: undefined, [second]: undefined });
    await expect(page.getByTestId("node-cpu-badge")).toHaveCount(0);

    await emitCpu(page, { [first]: 12.4, [second]: 91 });
    const firstBadge = page.locator(`[data-id="${first}"] [data-testid="node-cpu-badge"]`);
    const secondBadge = page.locator(`[data-id="${second}"] [data-testid="node-cpu-badge"]`);
    await expect(firstBadge).toHaveText("12%");
    await expect(secondBadge).toHaveText("91%");

    // A node missing from the next sample stopped.
    await emitCpu(page, { [first]: 3 });
    await expect(firstBadge).toHaveText("3%");
    await expect(secondBadge).toHaveCount(0);

    await emitStats(page, { clear: true });
    await expect(page.getByTestId("node-cpu-badge")).toHaveCount(0);
  });

  test("the badge hides when zoomed far out and on undeployed labs", async ({ page, topoViewerPage }) => {
    const [first] = await topoViewerPage.getNodeIds();
    await topoViewerPage.setZoom(1);
    await emitCpu(page, { [first]: 40 });
    const badge = page.locator(`[data-id="${first}"] [data-testid="node-cpu-badge"]`);
    await expect(badge).toBeVisible();

    await topoViewerPage.setZoom(0.4);
    await expect(badge).toHaveCount(0);
    await topoViewerPage.setZoom(1);
    await expect(badge).toBeVisible();

    await page.evaluate(() => {
      window.__DEV__?.setDeploymentState?.("undeployed");
    });
    await expect(badge).toHaveCount(0);
  });

  test("Appearance turns the badge off for the lab", async ({ page, topoViewerPage }) => {
    const [first] = await topoViewerPage.getNodeIds();
    await topoViewerPage.setZoom(1);
    await emitCpu(page, { [first]: 25 });
    await expect(page.getByTestId("node-cpu-badge")).toHaveCount(1);

    await page.getByTestId("navbar-lab-settings").click();
    const modal = page.getByTestId("lab-settings-modal");
    await modal.getByTestId("lab-settings-tab-appearance").click();
    const toggle = modal.getByRole("switch", { name: "CPU usage on nodes" });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await modal.getByTestId("lab-settings-save-btn").click();

    await expect(page.getByTestId("node-cpu-badge")).toHaveCount(0);
    await expect
      .poll(async () => (await topoViewerPage.getAnnotationsFromFile(SIMPLE_FILE)).viewerSettings)
      .toMatchObject({ showNodeCpu: false });
  });
});
