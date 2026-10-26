import type { Page } from "@playwright/test";

import type { BrowserDevApi } from "../devApi";
import { test, expect } from "../fixtures/topoviewer";

type TopoViewerPage = Parameters<Parameters<typeof test>[2]>[0]["topoViewerPage"];

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

/** Opens the lab with these viewer settings, deployed. */
async function openDeployed(
  page: Page,
  topoViewerPage: TopoViewerPage,
  viewerSettings: Record<string, unknown> = {}
): Promise<void> {
  const annotations = await topoViewerPage.getAnnotationsFromFile(SIMPLE_FILE);
  await topoViewerPage.writeAnnotationsFile(SIMPLE_FILE, {
    ...annotations,
    viewerSettings: { ...annotations.viewerSettings, ...viewerSettings }
  });
  await topoViewerPage.gotoFile(SIMPLE_FILE);
  await topoViewerPage.waitForCanvasReady();
  await topoViewerPage.unlock();
  await topoViewerPage.fit();
  await page.evaluate(() => {
    window.__DEV__?.setDeploymentState?.("deployed");
  });
}

/**
 * Running nodes can carry a small badge with their CPU usage from the host's
 * stats stream, once the lab turns it on in Appearance.
 */
test.describe("Node CPU badge", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
  });

  test("running nodes show their CPU usage, rounded, and lose it when they stop", async ({ page, topoViewerPage }) => {
    await openDeployed(page, topoViewerPage, { showNodeCpu: true });
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
    await openDeployed(page, topoViewerPage, { showNodeCpu: true });
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

  test("the badge is off until Appearance turns it on for the lab", async ({ page, topoViewerPage }) => {
    await openDeployed(page, topoViewerPage);
    const [first] = await topoViewerPage.getNodeIds();
    await topoViewerPage.setZoom(1);
    await emitCpu(page, { [first]: 25 });
    await expect(page.getByTestId("node-cpu-badge")).toHaveCount(0);

    await page.getByTestId("navbar-lab-settings").click();
    const modal = page.getByTestId("lab-settings-modal");
    await modal.getByTestId("lab-settings-tab-appearance").click();
    const toggle = modal.getByRole("switch", { name: "CPU usage on nodes" });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await modal.getByTestId("lab-settings-save-btn").click();
    await expect
      .poll(async () => (await topoViewerPage.getAnnotationsFromFile(SIMPLE_FILE)).viewerSettings)
      .toMatchObject({ showNodeCpu: true });

    // Saving reloads the harness lab as undeployed, maybe after this; deploy it again until it sticks.
    await expect(async () => {
      await page.evaluate(() => {
        window.__DEV__?.setDeploymentState?.("deployed");
      });
      await emitCpu(page, { [first]: 25 });
      await expect(page.getByTestId("node-cpu-badge")).toHaveCount(1, { timeout: 1000 });
    }).toPass();
  });

  test("beside an icon the badge looks like the node name; in a box it takes the box's colors", async ({ page, topoViewerPage }) => {
    await openDeployed(page, topoViewerPage, { showNodeCpu: true });
    const [first] = await topoViewerPage.getNodeIds();
    await topoViewerPage.setZoom(1);
    await emitCpu(page, { [first]: 40 });
    const node = page.locator(`[data-id="${first}"]`);
    const badge = node.getByTestId("node-cpu-badge");
    const paint = () => badge.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor };
    });
    const labelColor = await node.locator(".topology-node-label").evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor };
    });
    expect(await paint()).toEqual(labelColor);

    await openDeployed(page, topoViewerPage, { showNodeCpu: true, nodeStyle: "boxed" });
    await topoViewerPage.setZoom(1);
    await emitCpu(page, { [first]: 40 });
    await expect(badge).toHaveAttribute("data-boxed", "true");
    const boxText = await node.locator(".topology-node-box-label").evaluate((element) => getComputedStyle(element).color);
    expect(await paint()).toEqual({ color: boxText, background: "rgba(0, 0, 0, 0)" });
    // Inside the box's outline.
    const boxRect = await node.locator(".topology-node-box").boundingBox();
    const badgeRect = await badge.boundingBox();
    expect(boxRect && badgeRect).toBeTruthy();
    if (!boxRect || !badgeRect) return;
    expect(badgeRect.x).toBeGreaterThanOrEqual(boxRect.x);
    expect(badgeRect.y).toBeGreaterThanOrEqual(boxRect.y);
    expect(badgeRect.x + badgeRect.width).toBeLessThanOrEqual(boxRect.x + boxRect.width + 0.5);
  });
});
