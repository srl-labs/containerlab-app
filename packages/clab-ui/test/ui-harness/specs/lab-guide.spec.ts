import type { Page } from "@playwright/test";

import type { BrowserDevApi } from "../devApi";
import { test, expect } from "../fixtures/topoviewer";

const GUIDE_LAB = "srl-pair.clab.yml";

interface HarnessMessage {
  command: string;
  operation?: string;
  request?: Record<string, unknown>;
  nodeName?: string;
  text?: string;
}

async function setDeploymentState(page: Page, state: "deployed" | "undeployed"): Promise<void> {
  await page.evaluate((next) => {
    const dev = (window as { __DEV__?: BrowserDevApi }).__DEV__;
    if (!dev) throw new Error("__DEV__ API not available");
    dev.setDeploymentState?.(next);
  }, state);
}

async function messages(page: Page, command: string): Promise<HarnessMessage[]> {
  return page.evaluate((name) => {
    const recorded = (window as { __CLAB_UI_HARNESS_MESSAGES__?: HarnessMessage[] })
      .__CLAB_UI_HARNESS_MESSAGES__;
    return (recorded ?? []).filter((message) => message.command === name);
  }, command);
}

async function openPanel(page: Page): Promise<void> {
  // The panel stays open across a reload.
  if (!(await page.getByTestId("guide-tab").isVisible())) {
    await page.getByTestId("panel-toggle-btn").click();
  }
  await expect(page.getByTestId("guide-tab")).toBeVisible();
}

test.describe("Lab guide", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(GUIDE_LAB);
    await topoViewerPage.waitForCanvasReady();
  });

  test("a lab with a guide shows it in the side panel", async ({ page }) => {
    await openPanel(page);
    await expect(page.getByTestId("panel-tab-guide")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("guide-title")).toHaveText("Two SR Linux routers, one link");
    await expect
      .poll(() => page.getByTestId("guide-step").evaluateAll((steps) => steps.map((step) => step.getAttribute("aria-label"))))
      .toEqual(["1. Meet the routers", "2. Configure the link", "3. Ping across"]);
    await expect(page.getByTestId("guide-step-count")).toHaveText("Step 1 of 3");
    await expect(page.getByTestId("guide-step-title")).toHaveText("Meet the routers");
    await expect(page.getByTestId("guide-progress")).toHaveText("0 of 5 blocks done");
  });

  test("blocks wait for a deployed lab", async ({ page }) => {
    await setDeploymentState(page, "undeployed");
    await openPanel(page);
    await expect(page.getByTestId("guide-deploy-banner")).toBeVisible();
    const firstRun = page.getByTestId("guide-block-run").first();
    await expect(firstRun).toBeDisabled();
    await expect(page.getByTestId("guide-block-run-reason").first()).toHaveAttribute(
      "data-reason",
      "Deploy the lab first."
    );

    await page.getByTestId("guide-deploy").click();
    expect(await messages(page, "deployLab")).toHaveLength(1);
  });

  test("runs an exec block on its nodes after a confirmation, once", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await openPanel(page);
    await expect(page.getByTestId("guide-deploy-banner")).toHaveCount(0);

    const block = page.getByTestId("guide-block").first();
    await block.getByTestId("guide-block-run").click();
    await expect(block.getByTestId("guide-block-confirm")).toContainText("srl1, srl2");
    await block.getByTestId("guide-block-confirm-run").click();

    await expect(block.getByTestId("lab-exec-stdout-srl1")).toHaveText('srl1: sr_cli "show version" ok');
    await expect(block.getByTestId("lab-exec-stdout-srl2")).toHaveText('srl2: sr_cli "show version" ok');
    // What an exit code means differs between node OSes, so the guide leaves it out.
    await expect(block.getByTestId("lab-exec-code-srl1")).toHaveCount(0);
    await expect(block).toHaveAttribute("data-ticked", "true");
    await expect(page.getByTestId("guide-progress")).toHaveText("1 of 5 blocks done");
    const [exec] = await messages(page, "labOperation");
    expect(exec.request).toEqual({ command: 'sr_cli "show version"', nodeNames: ["srl1", "srl2"] });

    // The first run trusted the block, so it runs again without asking.
    await block.getByTestId("guide-block-run").click();
    await expect(block.getByTestId("guide-block-confirm")).toHaveCount(0);
    await expect.poll(async () => (await messages(page, "labOperation")).length).toBe(2);
  });

  test("asks the first time even when only others' scripts ask", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("clab-script-button-confirm", "never"));
    await setDeploymentState(page, "deployed");
    await openPanel(page);
    const block = page.getByTestId("guide-block").first();
    await block.getByTestId("guide-block-run").click();
    await expect(block.getByTestId("guide-block-confirm")).toBeVisible();
  });

  test("asks before every run when set to", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("clab-script-button-confirm", "always"));
    await setDeploymentState(page, "deployed");
    await openPanel(page);
    const block = page.getByTestId("guide-block").first();
    await block.getByTestId("guide-block-run").click();
    // Every run asks, so there is nothing to agree to for good.
    await expect(block.getByTestId("guide-block-trust-guide")).toHaveCount(0);
    await block.getByTestId("guide-block-confirm-run").click();
    await expect(block.getByTestId("lab-exec-stdout-srl1")).toBeVisible();
    await block.getByTestId("guide-block-run").click();
    await expect(block.getByTestId("guide-block-confirm")).toBeVisible();
  });

  test("an exec block's output folds away", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await openPanel(page);
    const block = page.getByTestId("guide-block").first();
    await block.getByTestId("guide-block-run").click();
    await block.getByTestId("guide-block-confirm-run").click();

    const toggle = block.getByTestId("guide-block-output-toggle");
    await expect(toggle).toHaveText("Output of srl1, srl2");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(block.getByTestId("guide-block-output")).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(block.getByTestId("lab-exec-stdout-srl1")).toBeVisible();
  });

  test("agreeing for the whole guide runs its other blocks without asking", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await openPanel(page);
    const first = page.getByTestId("guide-block").first();
    await first.getByTestId("guide-block-run").click();
    await first.getByTestId("guide-block-trust-guide").click();
    await first.getByTestId("guide-block-confirm-run").click();
    await expect(first.getByTestId("lab-exec-stdout-srl1")).toBeVisible();

    await page.getByTestId("guide-next").click();
    const terminal = page.locator('[data-testid="guide-block"][data-kind="terminal"]').first();
    await terminal.getByTestId("guide-block-run").click();
    await expect(terminal.getByTestId("guide-block-sent")).toHaveText("Sent to the terminal of srl1.");
    await expect(terminal.getByTestId("guide-block-confirm")).toHaveCount(0);
  });

  test("a guide taller than the panel scrolls, without clipping its blocks", async ({ page }) => {
    await page.setViewportSize({ width: 1300, height: 600 });
    await setDeploymentState(page, "deployed");
    await openPanel(page);
    const block = page.getByTestId("guide-block").first();
    await block.getByTestId("guide-block-run").click();
    await block.getByTestId("guide-block-confirm-run").click();
    await expect(block.getByTestId("lab-exec-stdout-srl2")).toBeVisible();

    // Each block is as tall as its content.
    const clipped = await block.evaluate((element) => element.scrollHeight > element.clientHeight);
    expect(clipped).toBe(false);

    const body = page.getByTestId("guide-body");
    const bounds = await body.boundingBox();
    if (!bounds) throw new Error("guide body not laid out");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, 2000);
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByTestId("guide-block").last()).toBeInViewport();
  });

  test("cancelling a confirmation runs nothing", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await openPanel(page);
    const block = page.getByTestId("guide-block").first();
    await block.getByTestId("guide-block-run").click();
    await block.getByTestId("guide-block-cancel").click();
    await expect(block.getByTestId("guide-block-confirm")).toHaveCount(0);
    await expect(block).toHaveAttribute("data-ticked", "false");
    expect(await messages(page, "labOperation")).toHaveLength(0);
  });

  test("terminal blocks type into the node's terminal", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await openPanel(page);
    await page.getByTestId("guide-next").click();
    await expect(page.getByTestId("guide-step-title")).toHaveText("Configure the link");

    const block = page.locator('[data-testid="guide-block"][data-kind="terminal"]').first();
    await block.getByTestId("guide-block-run").click();
    await block.getByTestId("guide-block-confirm-run").click();
    await expect(block.getByTestId("guide-block-sent")).toHaveText("Sent to the terminal of srl1.");
    await expect(block).toHaveAttribute("data-ticked", "true");

    const [sent] = await messages(page, "clab-node-terminal-input");
    expect(sent.nodeName).toBe("srl1");
    expect(sent.text?.split("\n")).toEqual([
      "enter candidate",
      "set / interface ethernet-1/1 admin-state enable",
      "set / interface ethernet-1/1 subinterface 0 ipv4 admin-state enable",
      "set / interface ethernet-1/1 subinterface 0 ipv4 address 192.168.0.1/30",
      "set / network-instance default interface ethernet-1/1.0",
      "commit now"
    ]);
  });

  test("checkmarks tick by hand, finish steps and survive a reload", async ({ page, topoViewerPage }) => {
    await openPanel(page);
    const blocks = page.getByTestId("guide-block");
    await blocks.nth(0).getByTestId("guide-block-tick").click();
    await expect(page.getByTestId("guide-step").first()).toHaveAttribute("data-done", "false");
    await blocks.nth(1).getByTestId("guide-block-tick").click();
    await expect(page.getByTestId("guide-step").first()).toHaveAttribute("data-done", "true");

    // Unticking takes the step back.
    await blocks.nth(1).getByTestId("guide-block-tick").click();
    await expect(page.getByTestId("guide-step").first()).toHaveAttribute("data-done", "false");
    await blocks.nth(1).getByTestId("guide-block-tick").click();
    await page.getByTestId("guide-next").click();

    await page.reload();
    await topoViewerPage.gotoFile(GUIDE_LAB);
    await topoViewerPage.waitForCanvasReady();
    await openPanel(page);
    await expect(page.getByTestId("guide-step-title")).toHaveText("Configure the link");
    await expect(page.getByTestId("guide-progress")).toHaveText("2 of 5 blocks done");
    await expect(page.getByTestId("guide-step").first()).toHaveAttribute("data-done", "true");
  });

  test("node links center the canvas and keep the guide open", async ({ page, topoViewerPage }) => {
    await openPanel(page);
    await page.getByTestId("guide-markdown").getByRole("link", { name: "srl2" }).first().click();
    await expect.poll(() => topoViewerPage.getSelectedNodeIds()).toEqual([]);
    await expect(page.getByTestId("panel-tab-guide")).toHaveAttribute("aria-selected", "true");
  });

  test("a link to a file beside the guide keeps the page on the lab", async ({ page }) => {
    await openPanel(page);
    // A listener on the document hears the click after the guide's own.
    const followed = page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          document.addEventListener("click", (event) => resolve(!event.defaultPrevented), { once: true });
        })
    );
    await page.getByTestId("guide-markdown").getByRole("link", { name: "srl-pair.clab.yml" }).click();
    expect(await followed).toBe(false);
    await expect(page.getByTestId("guide-tab")).toBeVisible();
  });

  test("a topology without a guide offers to create one, once unlocked", async ({ page, topoViewerPage }) => {
    await topoViewerPage.gotoFile("simple.clab.yml");
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.lock();
    await page.getByTestId("panel-toggle-btn").click();
    // Without a guide the panel opens where it always did.
    await expect(page.getByTestId("panel-tab-nodes")).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("panel-tab-guide").click();
    await expect(page.getByTestId("guide-empty")).toContainText("simple.clab.md");

    // Locked, the lab takes no new files.
    await expect(page.getByTestId("guide-create-locked")).toBeVisible();
    await page.getByTestId("guide-create").click();
    await expect(page.getByTestId("guide-empty")).toBeVisible();
    expect(await messages(page, "openLabFile")).toHaveLength(0);

    await topoViewerPage.unlock();
    await expect(page.getByTestId("guide-create-locked")).toHaveCount(0);
    await page.getByTestId("guide-create").click();
    await expect(page.getByTestId("guide-title")).toHaveText("simple");
    await expect
      .poll(() => page.getByTestId("guide-step").evaluateAll((steps) => steps.map((step) => step.getAttribute("aria-label"))))
      .toEqual(["1. Look around", "2. Work on a node"]);
    await expect(page.locator('[data-testid="guide-block"][data-kind="exec"]')).toContainText("srl1");
    const opened = await messages(page, "openLabFile");
    expect(opened.map((message) => (message as { path?: string }).path)).toEqual(["simple.clab.md"]);
  });
});
