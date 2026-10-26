import type { Page } from "@playwright/test";

import type { BrowserDevApi } from "../devApi";
import { test, expect } from "../fixtures/topoviewer";

const SIMPLE_FILE = "simple.clab.yml";

function hoverNode(page: Page, nodeId: string) {
  return page.locator(`.react-flow__node[data-id="${nodeId}"] .topology-node-icon`).hover();
}

/** Rests the pointer on the middle of the link's line. */
async function hoverLink(page: Page, edgeId: string) {
  const point = await page.evaluate((id) => {
    const path = document.querySelector<SVGPathElement>(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`);
    const matrix = path?.getScreenCTM();
    if (!path || !matrix) return null;
    const middle = path.getPointAtLength(path.getTotalLength() / 2);
    return { x: middle.x * matrix.a + middle.y * matrix.c + matrix.e, y: middle.x * matrix.b + middle.y * matrix.d + matrix.f };
  }, edgeId);
  if (!point) throw new Error(`Link ${edgeId} has no path`);
  await page.mouse.move(point.x - 6, point.y - 6);
  await page.mouse.move(point.x, point.y);
}

/** Deploy the open topology with the primary navbar action and close the progress dialog. */
async function deploy(page: Page): Promise<void> {
  await page.getByTestId("navbar-deploy").click();
  const ok = page.getByTestId("lifecycle-ok-btn");
  await expect(ok).toBeVisible({ timeout: 20000 });
  await ok.click();
  await expect(page.getByTestId("lifecycle-progress-modal")).toHaveCount(0);
}

/** The simple lab as running, with traffic on srl1:e1-1 and srl2:e1-1. */
async function applyTraffic(page: Page, rxBps: number): Promise<void> {
  const container = (nodeName: string) => ({
    name: `clab-simple-${nodeName}`,
    nodeName,
    labName: "simple",
    state: "running",
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:latest",
    ipv4Address: "",
    ipv6Address: "",
    interfaces: [
      {
        name: "e1-1",
        alias: "",
        mac: "aa:c1:ab:00:00:01",
        mtu: 9500,
        state: "up",
        type: "veth",
        stats: { rxBps, txBps: rxBps / 2, statsIntervalSeconds: 1 }
      }
    ]
  });
  await page.evaluate(async (containers) => {
    const dev = (window as { __DEV__?: BrowserDevApi }).__DEV__;
    if (!dev) throw new Error("__DEV__ API not available");
    dev.setDeploymentState?.("deployed");
    await dev.applyRuntimeContainers(containers as never);
  }, [container("srl1"), container("srl2")]);
}

/**
 * Resting the pointer on a node or link shows a card with its details,
 * unless the app settings turn the cards off.
 */
test.describe("Canvas hover cards", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.fit();
  });

  test("a node's card shows its kind and image, then its state and usage once deployed", async ({ page, topoViewerPage }) => {
    const [nodeId] = await topoViewerPage.getNodeIds();
    await hoverNode(page, nodeId);
    const card = page.getByTestId("node-hover-card");
    await expect(card).toHaveAttribute("data-target-id", nodeId);
    await expect(card.getByTestId("node-hover-card-kind")).not.toBeEmpty();
    await expect(card.getByTestId("node-hover-card-state")).toHaveAttribute("data-state", "undeployed");

    // Leaving the node hides the card.
    await page.mouse.move(2, 2);
    await expect(card).toHaveCount(0);

    await page.evaluate((name) => {
      const dev = (window as { __DEV__?: BrowserDevApi }).__DEV__;
      dev?.setDeploymentState?.("deployed");
      dev?.emitHostMessage({
        type: "node-stats-update",
        data: {
          sample: {
            time: new Date().toISOString(),
            intervalSeconds: 2,
            nodes: [{ name: `container-of-${name}`, nodeName: name, cpuPercent: 42, memoryBytes: 512 * 1024 ** 2 }]
          }
        }
      });
    }, nodeId);
    await hoverNode(page, nodeId);
    await expect(card.getByTestId("node-hover-card-cpu")).toHaveText("42 %");
    await expect(card.getByTestId("node-hover-card-memory")).toHaveText("512 MiB");

    // Pressing on the node, as to drag it, hides the card.
    await page.mouse.down();
    await expect(card).toHaveCount(0);
    await page.mouse.up();
  });

  test("a link's card shows both endpoints, and their state once deployed", async ({ page, topoViewerPage }) => {
    const [edgeId] = await topoViewerPage.getEdgeIds();
    await hoverLink(page, edgeId);
    const card = page.getByTestId("link-hover-card");
    await expect(card).toHaveAttribute("data-target-id", edgeId);
    await expect(card.getByTestId("link-hover-card-interface-a")).not.toBeEmpty();
    await expect(card.getByTestId("link-hover-card-interface-b")).not.toBeEmpty();
    await expect(card.getByTestId("link-hover-card-state")).toHaveAttribute("data-state", "undeployed");
    await page.mouse.move(2, 2);
    await expect(card).toHaveCount(0);

    await deploy(page);
    await hoverLink(page, edgeId);
    await expect(card.getByTestId("link-hover-card-state")).toHaveAttribute("data-state", "up");
    await expect(card.getByTestId("link-hover-card-mtu-a")).toHaveText(/^\d+$/);
    await expect(card.getByTestId("link-hover-card-mac-b")).toHaveText(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
  });

  test("the app settings turn the cards off and on again", async ({ page, topoViewerPage }) => {
    const toggle = (enabled: boolean) => page.evaluate((value) => {
      localStorage.setItem("clab-standalone-hover-cards", String(value));
      window.dispatchEvent(new StorageEvent("storage", { key: "clab-standalone-hover-cards" }));
    }, enabled);
    const [nodeId] = await topoViewerPage.getNodeIds();
    await toggle(false);
    await hoverNode(page, nodeId);
    await page.waitForTimeout(800);
    await expect(page.getByTestId("node-hover-card")).toHaveCount(0);

    await toggle(true);
    await page.mouse.move(2, 2);
    await hoverNode(page, nodeId);
    await expect(page.getByTestId("node-hover-card")).toBeVisible();
  });

  test("a link's card charts the traffic it carried before the pointer came", async ({ page, topoViewerPage }) => {
    for (const rate of [1_000_000, 4_000_000, 2_500_000]) {
      await applyTraffic(page, rate);
      await page.waitForTimeout(150);
    }
    const [edgeId] = await topoViewerPage.getEdgeIds();
    await hoverLink(page, edgeId);
    const card = page.getByTestId("link-hover-card");
    await expect(card.getByTestId("link-hover-card-rx-a")).toHaveText("2.5 Mbps");
    const traffic = card.getByTestId("link-hover-card-traffic");
    await expect(traffic).toContainText("Traffic at srl1:e1-1");
    // The samples from before the hover are already in the chart.
    await expect(traffic.locator("svg").first()).toBeVisible();
    await expect.poll(() => traffic.locator("svg path").count()).toBeGreaterThan(2);
  });
});
