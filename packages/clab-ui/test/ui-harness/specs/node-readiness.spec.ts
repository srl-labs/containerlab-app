import type { Page } from "@playwright/test";

import type { BrowserDevApi } from "../devApi";
import type { FakeNodeRuntime } from "../fakeLab";
import { test, expect } from "../fixtures/topoviewer";

const SIMPLE_FILE = "simple.clab.yml";
const STAGES_FILE = "stages.clab.yml";

function topologyNode(page: Page, nodeId: string) {
  return page.locator(`[data-id="${nodeId}"] .topology-node`);
}

function nodeIcon(page: Page, nodeId: string) {
  return page.locator(`[data-id="${nodeId}"] .topology-node-icon`);
}

function nodeBadge(page: Page, nodeId: string) {
  return page.locator(`[data-id="${nodeId}"] .topology-node-runtime-badge`);
}

async function iconAnimation(page: Page, nodeId: string): Promise<{ name: string; delay: string }> {
  return nodeIcon(page, nodeId).evaluate((element) => {
    const style = getComputedStyle(element);
    return { name: style.animationName, delay: style.animationDelay };
  });
}

async function setNodeRuntime(
  page: Page,
  nodeName: string,
  runtime: FakeNodeRuntime | null
): Promise<void> {
  await page.evaluate(
    async ([name, value]) => {
      const dev = (window as { __DEV__?: BrowserDevApi }).__DEV__;
      if (!dev) throw new Error("__DEV__ API not available");
      await dev.setNodeRuntime(name, value);
    },
    [nodeName, runtime] as const
  );
}

/** Deploy the open topology with the primary navbar action and close the progress dialog. */
async function deploy(page: Page): Promise<void> {
  await page.getByTestId("navbar-deploy").click();
  const ok = page.getByTestId("lifecycle-ok-btn");
  await expect(ok).toBeVisible({ timeout: 20000 });
  await ok.click();
  await expect(page.getByTestId("lifecycle-progress-modal")).toHaveCount(0);
}

async function clickNode(page: Page, nodeId: string): Promise<void> {
  const box = await page.locator(`[data-id="${nodeId}"]`).boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe("Node readiness", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
  });

  test("nodes pulse while a deploy brings them up, each in its own phase", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.gotoFile(STAGES_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.fit();

    await page.getByTestId("navbar-deploy").click();

    // leaf1 waits for spine1, which waits for ca: it is not created until the last wave.
    await expect(topologyNode(page, "leaf1")).toHaveAttribute("data-readiness", "starting");
    await expect(nodeIcon(page, "leaf1")).toHaveClass(/node-booting/);
    await expect(nodeBadge(page, "leaf1")).toHaveClass(/state-booting/);
    const [leaf1, spine1] = [
      await iconAnimation(page, "leaf1"),
      await iconAnimation(page, "spine1")
    ];
    expect(leaf1.name).toBe("clab-node-booting");
    expect(spine1.name).toBe("clab-node-booting");
    expect(leaf1.delay).not.toBe(spine1.delay);

    // The first wave is up: client1 has no healthcheck, ca's has not passed yet.
    await expect(topologyNode(page, "client1")).toHaveAttribute("data-readiness", "ready");
    await expect(topologyNode(page, "ca")).toHaveAttribute("data-readiness", "starting");

    const ok = page.getByTestId("lifecycle-ok-btn");
    await expect(ok).toBeVisible({ timeout: 20000 });
    await ok.click();
    for (const nodeId of ["ca", "spine1", "leaf1", "leaf2", "client1"]) {
      await expect(topologyNode(page, nodeId)).toHaveAttribute("data-readiness", "ready");
    }
    await expect(nodeIcon(page, "leaf1")).not.toHaveClass(/node-booting/);
    await expect(nodeBadge(page, "leaf1")).toHaveClass(/state-running/);
  });

  test("a deploy limited to some nodes pulses only those", async ({ page, topoViewerPage }) => {
    await topoViewerPage.gotoFile(STAGES_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.fit();

    await page.getByTestId("navbar-deploy-menu").click();
    await page.getByTestId("navbar-deploy-item-options").click();
    await page.getByTestId("lifecycle-options-nodes").click();
    await page.getByRole("option", { name: "ca", exact: true }).click();
    await page.getByTestId("lifecycle-options-run").click();

    await expect(topologyNode(page, "ca")).toHaveAttribute("data-readiness", "starting");
    for (const nodeId of ["spine1", "leaf1", "client1"]) {
      await expect(topologyNode(page, nodeId)).not.toHaveAttribute("data-readiness", /.+/);
      await expect(nodeIcon(page, nodeId)).not.toHaveClass(/node-booting/);
    }
  });

  test("the docker health decides between booting, ready and unhealthy", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await deploy(page);
    await expect(topologyNode(page, "srl1")).toHaveAttribute("data-readiness", "ready");

    await setNodeRuntime(page, "srl1", { status: "Up 2 seconds (health: starting)" });
    await expect(topologyNode(page, "srl1")).toHaveAttribute("data-readiness", "starting");
    await expect(nodeIcon(page, "srl1")).toHaveClass(/node-booting/);
    await expect(nodeBadge(page, "srl1")).toHaveClass(/state-booting/);
    await expect(topologyNode(page, "srl2")).toHaveAttribute("data-readiness", "ready");

    // Unhealthy is a warning that keeps still, not another kind of booting.
    await setNodeRuntime(page, "srl1", { status: "Up 3 minutes (unhealthy)" });
    await expect(topologyNode(page, "srl1")).toHaveAttribute("data-readiness", "unhealthy");
    await expect(nodeIcon(page, "srl1")).toHaveClass(/node-unhealthy/);
    await expect(nodeIcon(page, "srl1")).not.toHaveClass(/node-booting/);
    await expect(nodeBadge(page, "srl1")).toHaveClass(/state-unhealthy/);
    expect((await iconAnimation(page, "srl1")).name).toBe("none");

    await setNodeRuntime(page, "srl1", { status: "Up 3 minutes (healthy)" });
    await expect(topologyNode(page, "srl1")).toHaveAttribute("data-readiness", "ready");
    await expect(nodeBadge(page, "srl1")).toHaveClass(/state-running/);
  });

  test("the info panel shows pending values while a node boots", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.fit();
    await deploy(page);

    await setNodeRuntime(page, "srl1", { state: "created", status: "Created" });
    await expect(topologyNode(page, "srl1")).toHaveAttribute("data-readiness", "starting");
    await clickNode(page, "srl1");
    await expect(page.getByLabel("State", { exact: true })).toHaveValue("Starting");
    await expect(page.getByLabel("IPv4", { exact: true })).toHaveValue("Pending");
    await expect(page.getByLabel("IPv6", { exact: true })).toHaveValue("Pending");

    await setNodeRuntime(page, "srl1", null);
    await expect(page.getByLabel("State", { exact: true })).toHaveValue("running");
    await expect(page.getByLabel("IPv4", { exact: true })).toHaveValue("172.20.20.2");
  });

  test("a restarted node with a healthcheck boots until the check passes", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.gotoFile(STAGES_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.fit();
    await deploy(page);
    await expect(topologyNode(page, "ca")).toHaveAttribute("data-readiness", "ready", {
      timeout: 10000
    });

    const box = await page.locator('[data-id="ca"]').boundingBox();
    if (!box) throw new Error("Node ca has no bounding box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
    await page.getByTestId("context-menu-item-restart-node").click();

    await expect(topologyNode(page, "ca")).toHaveAttribute("data-readiness", "starting");
    await expect(nodeIcon(page, "ca")).toHaveClass(/node-booting/);
    await expect(topologyNode(page, "ca")).toHaveAttribute("data-readiness", "ready", {
      timeout: 10000
    });
  });

  test("booting nodes keep still when motion is reduced", async ({ page, topoViewerPage }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await deploy(page);

    await setNodeRuntime(page, "srl2", { status: "Up 1 second (health: starting)" });
    await expect(topologyNode(page, "srl2")).toHaveAttribute("data-readiness", "starting");
    await expect(nodeBadge(page, "srl2")).toHaveClass(/state-booting/);
    expect((await iconAnimation(page, "srl2")).name).toBe("none");
  });
});
