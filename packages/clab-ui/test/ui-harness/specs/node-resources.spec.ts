import type { Page } from "@playwright/test";

import type { BrowserDevApi } from "../devApi";
import { test, expect } from "../fixtures/topoviewer";

const MIB = 1024 ** 2;

async function clickNode(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-id="${nodeId}"]`);
  await expect(node).toBeVisible();
  const box = await node.boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function emitStats(page: Page, data: Record<string, unknown>): Promise<void> {
  await page.evaluate((payload) => {
    (window as { __DEV__?: BrowserDevApi }).__DEV__?.emitHostMessage({ type: "node-stats-update", data: payload });
  }, data);
}

/**
 * Node CPU and memory usage: hosts stream samples of the deployed lab, and
 * the node info panel shows the latest values with their recent history.
 */
test.describe("Node resources", () => {
  test.beforeEach(async ({ page, topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile("simple.clab.yml");
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
    await page.evaluate(() => {
      window.__DEV__?.setDeploymentState?.("deployed");
    });
  });

  test("the info panel shows a node's latest CPU and memory usage", async ({ page, topoViewerPage }) => {
    const [nodeId] = await topoViewerPage.getNodeIds();
    for (const cpuPercent of [4, 12.5]) {
      await emitStats(page, {
        sample: {
          time: new Date().toISOString(),
          intervalSeconds: 2,
          nodes: [
            {
              name: `container-of-${nodeId}`,
              nodeName: nodeId,
              cpuPercent,
              cpuCount: 4,
              memoryBytes: 512 * MIB,
              memoryLimitBytes: 8192 * MIB,
              pids: 12
            }
          ]
        }
      });
    }
    await clickNode(page, nodeId);

    await expect(page.getByTestId("node-resources")).toBeVisible();
    await expect(page.getByTestId("node-resources-cpu-value")).toHaveText("13 %");
    await expect(page.getByTestId("node-resources-memory-value")).toHaveText("512 MiB");
    await expect(page.getByTestId("node-resources-memory")).toContainText("of 8.0 GiB (6.3 %)");
    await expect(page.getByTestId("node-resources-cpu")).toContainText("12 processes");
  });

  test("a node without samples is pending, and an older lab host says why there are none", async ({
    page,
    topoViewerPage
  }) => {
    const [nodeId] = await topoViewerPage.getNodeIds();
    await emitStats(page, { sample: { time: new Date().toISOString(), intervalSeconds: 2, nodes: [] } });
    await clickNode(page, nodeId);
    await expect(page.getByTestId("node-resources-pending")).toBeVisible();

    await emitStats(page, { unavailable: "Update clab-api-server to see node usage." });
    await expect(page.getByTestId("node-resources-unavailable")).toHaveText(
      "Update clab-api-server to see node usage."
    );

    await emitStats(page, { clear: true });
    await expect(page.getByTestId("node-resources-unavailable")).toBeHidden();
  });
});
