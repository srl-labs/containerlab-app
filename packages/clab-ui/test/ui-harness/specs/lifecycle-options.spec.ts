import type { Page } from "@playwright/test";

import type { BrowserDevApi } from "../devApi";
import { test, expect } from "../fixtures/topoviewer";

const SPINE_LEAF_FILE = "spine-leaf.clab.yml";
const SEL_DIALOG = '[data-testid="lifecycle-options-dialog"]';

interface LifecycleMessage {
  command: string;
  options?: Record<string, unknown>;
}

async function setDeploymentState(page: Page, state: "deployed" | "undeployed"): Promise<void> {
  await page.evaluate((next) => {
    const dev = (window as { __DEV__?: BrowserDevApi }).__DEV__;
    if (!dev) throw new Error("__DEV__ API not available");
    dev.setDeploymentState?.(next);
  }, state);
}

async function openOptionsDialog(page: Page): Promise<void> {
  await page.getByTestId("navbar-deploy-menu").click();
  await page.getByTestId("navbar-deploy-item-options").click();
  await expect(page.locator(SEL_DIALOG)).toBeVisible();
}

async function lifecycleMessages(page: Page): Promise<LifecycleMessage[]> {
  return page.evaluate(() => {
    const messages = (window as { __CLAB_UI_HARNESS_MESSAGES__?: LifecycleMessage[] })
      .__CLAB_UI_HARNESS_MESSAGES__;
    return (messages ?? []).filter((message) =>
      /^(deploy|redeploy|destroy)Lab/.test(message.command)
    );
  });
}

/** The checkbox inside a labelled option row. */
function checkbox(page: Page, testId: string) {
  return page.getByTestId(testId).locator('input[type="checkbox"]');
}

async function pickNode(page: Page, name: string): Promise<void> {
  await page.getByTestId("lifecycle-options-nodes").click();
  await page.getByRole("option", { name, exact: true }).click();
}

test.describe("Run with options", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SPINE_LEAF_FILE);
    await topoViewerPage.waitForCanvasReady();
  });

  test("deploys some nodes with extra options", async ({ page }) => {
    await setDeploymentState(page, "undeployed");
    await openOptionsDialog(page);

    // A lab that is not running can only be deployed.
    await expect(page.getByTestId("lifecycle-options-kind-deploy")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByTestId("lifecycle-options-kind-redeploy")).toBeDisabled();
    await expect(page.getByTestId("lifecycle-options-kind-destroy")).toBeDisabled();
    await expect(checkbox(page, "lifecycle-options-graceful")).toHaveCount(0);

    await pickNode(page, "spine1");
    await pickNode(page, "leaf1");
    await page.locator("#lifecycle-options-max-workers").fill("2");
    await checkbox(page, "lifecycle-options-skip-post-deploy").check();
    await checkbox(page, "lifecycle-options-cleanup").check();

    await expect(page.getByTestId("lifecycle-options-command")).toHaveText(
      "containerlab deploy -c --node-filter spine1,leaf1 --max-workers 2 --skip-post-deploy"
    );

    await page.getByTestId("lifecycle-options-run").click();
    await expect(page.locator(SEL_DIALOG)).toHaveCount(0);

    expect(await lifecycleMessages(page)).toEqual([
      {
        command: "deployLabCleanup",
        options: { nodeFilter: ["spine1", "leaf1"], maxWorkers: 2, skipPostDeploy: true }
      }
    ]);
  });

  test("destroys some nodes of a running lab without cleanup", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await openOptionsDialog(page);

    // A running lab opens on redeploy; deploy is not offered.
    await expect(page.getByTestId("lifecycle-options-kind-redeploy")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByTestId("lifecycle-options-kind-deploy")).toBeDisabled();
    await expect(page.getByTestId("lifecycle-options-nodes")).toHaveCount(0);

    await page.getByTestId("lifecycle-options-kind-destroy").click();
    await checkbox(page, "lifecycle-options-cleanup").check();
    await pickNode(page, "client1");

    // containerlab refuses cleanup together with a node filter.
    await expect(checkbox(page, "lifecycle-options-cleanup")).toBeDisabled();
    await expect(checkbox(page, "lifecycle-options-cleanup")).not.toBeChecked();

    await checkbox(page, "lifecycle-options-graceful").check();
    await expect(page.getByTestId("lifecycle-options-command")).toHaveText(
      "containerlab destroy --node-filter client1 --graceful"
    );

    await page.getByTestId("lifecycle-options-run").click();
    expect(await lifecycleMessages(page)).toEqual([
      { command: "destroyLab", options: { nodeFilter: ["client1"], graceful: true } }
    ]);
  });

  test("passes a template variables file to the lifecycle action", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await openOptionsDialog(page);

    await page.locator("#lifecycle-options-vars-file").fill("/etc/vars.yml");
    await expect(page.getByTestId("lifecycle-options-run")).toBeDisabled();
    await page.locator("#lifecycle-options-vars-file").fill("vars/prod.yml");
    await expect(page.getByTestId("lifecycle-options-command")).toHaveText(
      "containerlab redeploy --vars vars/prod.yml"
    );

    await page.getByTestId("lifecycle-options-run").click();
    expect(await lifecycleMessages(page)).toEqual([
      { command: "redeployLab", options: { varsFile: "vars/prod.yml" } }
    ]);
  });

  test("rejects an invalid worker count", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await openOptionsDialog(page);

    await page.locator("#lifecycle-options-max-workers").fill("0");
    await expect(page.getByTestId("lifecycle-options-run")).toBeDisabled();
    await page.locator("#lifecycle-options-max-workers").fill("4");
    await expect(page.getByTestId("lifecycle-options-run")).toBeEnabled();

    await page.getByTestId("lifecycle-options-close").click();
    await expect(page.locator(SEL_DIALOG)).toHaveCount(0);
    expect(await lifecycleMessages(page)).toEqual([]);
  });
});

test.describe("Lab settings", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SPINE_LEAF_FILE);
    await topoViewerPage.waitForCanvasReady();
  });

  test("a deploy with options remembers them, and Lab settings shows and clears them", async ({ page }) => {
    await setDeploymentState(page, "undeployed");
    await openOptionsDialog(page);
    await page.locator("#lifecycle-options-timeout").fill("30");
    await expect(page.getByTestId("lifecycle-options-run")).toBeDisabled();
    await page.locator("#lifecycle-options-timeout").fill("30m");
    await page.locator("#lifecycle-options-max-workers").fill("2");
    await pickNode(page, "spine1");
    await expect(checkbox(page, "lifecycle-options-remember")).toBeChecked();
    await expect(page.getByTestId("lifecycle-options-command")).toHaveText(
      "containerlab deploy --timeout 30m --node-filter spine1 --max-workers 2"
    );
    await page.getByTestId("lifecycle-options-run").click();
    expect(await lifecycleMessages(page)).toEqual([
      { command: "deployLab", options: { timeout: "30m", nodeFilter: ["spine1"], maxWorkers: 2 } }
    ]);

    // The node filter belongs to that run; timeout and workers stay with the lab.
    const ok = page.getByTestId("lifecycle-ok-btn");
    await expect(ok).toBeVisible({ timeout: 30_000 });
    await ok.click();
    await expect(page.getByTestId("lifecycle-progress-modal")).toHaveCount(0);
    await page.getByTestId("navbar-deploy-menu").click();
    await page.getByTestId("navbar-deploy-item-lab-settings").click();
    await expect(page.locator(SEL_DIALOG)).toBeVisible();
    await expect(page.locator("#lifecycle-options-timeout")).toHaveValue("30m");
    await expect(page.locator("#lifecycle-options-max-workers")).toHaveValue("2");
    await expect(page.getByTestId("lifecycle-options-nodes")).toHaveCount(0);
    await expect(page.getByTestId("lab-settings-host-defaults")).toContainText("2m (containerlab default)");
    await page.getByTestId("lab-settings-clear").click();
    await expect(page.locator(SEL_DIALOG)).toHaveCount(0);

    await page.getByTestId("navbar-deploy-menu").click();
    await page.getByTestId("navbar-deploy-item-lab-settings").click();
    await expect(page.locator("#lifecycle-options-timeout")).toHaveValue("");
  });
});
