import type { Page } from "@playwright/test";

import type { BrowserDevApi } from "../devApi";
import { test, expect } from "../fixtures/topoviewer";

const SPINE_LEAF_FILE = "spine-leaf.clab.yml";
const SEL_DIALOG = '[data-testid="apply-plan-dialog"]';

const PLAN_WITH_CHANGES = {
  dryRun: true,
  deployedLab: false,
  addedNodes: ["client3"],
  deletedNodes: ["client2"],
  recreatedNodes: ["spine1"],
  startedNodes: [],
  restartedNodes: [],
  addedLinks: ["client3:eth1 -- leaf1:e1-2"],
  deletedEndpoints: ["leaf2:e1-1"],
  nodeChangeReasons: { spine1: "config drift: image" }
};

async function setDeploymentState(page: Page, state: "deployed" | "undeployed"): Promise<void> {
  await page.evaluate((next) => {
    const dev = (window as { __DEV__?: BrowserDevApi }).__DEV__;
    if (!dev) throw new Error("__DEV__ API not available");
    dev.setDeploymentState?.(next);
  }, state);
}

async function stubApplyPlan(page: Page, plan: unknown): Promise<void> {
  await page.evaluate((value) => {
    (window as { __CLAB_UI_HARNESS_APPLY_PLAN__?: unknown }).__CLAB_UI_HARNESS_APPLY_PLAN__ = value;
  }, plan);
}

async function applyMessages(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const messages = (window as { __CLAB_UI_HARNESS_MESSAGES__?: Array<{ command: string }> })
      .__CLAB_UI_HARNESS_MESSAGES__;
    return (messages ?? [])
      .map((message) => message.command)
      .filter((command) => command === "applyLab" || command === "planApplyLab");
  });
}

test.describe("Apply plan", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SPINE_LEAF_FILE);
    await topoViewerPage.waitForCanvasReady();
  });

  test("shows what apply changes in a running lab before applying", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await stubApplyPlan(page, PLAN_WITH_CHANGES);

    await page.getByTestId("navbar-deploy").click();
    const dialog = page.locator(SEL_DIALOG);
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("apply-plan-summary")).toHaveText(
      "Applying makes 5 changes to the running lab."
    );

    await expect(page.getByTestId("apply-plan-section-addedNodes")).toContainText("client3");
    await expect(page.getByTestId("apply-plan-section-recreatedNodes")).toContainText(
      "config drift: image"
    );
    await expect(page.getByTestId("apply-plan-section-deletedNodes")).toContainText("client2");
    await expect(page.getByTestId("apply-plan-section-addedLinks")).toContainText(
      "client3:eth1  ↔  leaf1:e1-2"
    );
    await expect(page.getByTestId("apply-plan-section-deletedEndpoints")).toContainText(
      "leaf2:e1-1"
    );
    await expect(page.getByTestId("apply-plan-state-warning")).toBeVisible();
    // Nothing runs until the plan is confirmed.
    expect(await applyMessages(page)).toEqual(["planApplyLab"]);

    await page.getByTestId("apply-plan-apply").click();
    await expect(dialog).toHaveCount(0);
    expect(await applyMessages(page)).toEqual(["planApplyLab", "applyLab"]);
  });

  test("cancelling the plan leaves the lab alone", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await stubApplyPlan(page, { ...PLAN_WITH_CHANGES, recreatedNodes: [], deletedNodes: [] });

    await page.getByTestId("navbar-deploy-menu").click();
    await page.getByTestId("navbar-deploy-item-apply").click();
    await expect(page.locator(SEL_DIALOG)).toBeVisible();
    await expect(page.getByTestId("apply-plan-section-addedNodes")).toBeVisible();
    await expect(page.getByTestId("apply-plan-state-warning")).toHaveCount(0);

    await page.getByTestId("apply-plan-cancel").click();
    await expect(page.locator(SEL_DIALOG)).toHaveCount(0);
    expect(await applyMessages(page)).toEqual(["planApplyLab"]);
  });

  test("says when the running lab already matches the topology", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await stubApplyPlan(page, { addedNodes: [] });

    await page.getByTestId("navbar-deploy").click();
    await expect(page.getByTestId("apply-plan-in-sync")).toBeVisible();
    await expect(page.getByTestId("apply-plan-apply")).toHaveCount(0);

    await page.getByTestId("apply-plan-cancel").click();
    expect(await applyMessages(page)).toEqual(["planApplyLab"]);
  });

  test("can still apply when the dry run fails", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await stubApplyPlan(page, { error: "containerlab 0.77 does not support --dry-run" });

    await page.getByTestId("navbar-deploy").click();
    await expect(page.getByTestId("apply-plan-error")).toContainText("does not support --dry-run");

    await page.getByTestId("apply-plan-apply").click();
    await expect(page.locator(SEL_DIALOG)).toHaveCount(0);
    expect(await applyMessages(page)).toEqual(["planApplyLab", "applyLab"]);
  });

  test("deploys a lab that is not running without a plan", async ({ page }) => {
    await setDeploymentState(page, "undeployed");

    await page.getByTestId("navbar-deploy").click();
    await expect(page.locator(SEL_DIALOG)).toHaveCount(0);
    expect(await applyMessages(page)).toEqual(["applyLab"]);
  });

  test("plans edits against the fake running lab and applies them", async ({ page }) => {
    const yamlFile = await page.evaluate(() =>
      (window as { __DEV__?: BrowserDevApi }).__DEV__!.getCurrentFile()
    );
    const deploy = page.getByTestId("navbar-deploy");
    const okButton = page.getByTestId("lifecycle-ok-btn");

    // Not running yet: apply deploys the lab, which is then in sync.
    await deploy.click();
    await expect(page.getByTestId("lifecycle-progress-modal")).toContainText(
      "Creating container name=spine1"
    );
    await okButton.click();
    await expect(deploy).toBeDisabled();

    // Change spine1's image, drop client2 and add client3 on leaf1.
    const yaml = await page.evaluate(
      (file) => (window as { __DEV__?: BrowserDevApi }).__DEV__!.getYamlFromFile(file),
      yamlFile
    );
    const edited = yaml
      .replace(
        /(spine1:\n(?:\s+.*\n)*?\s+image: )\S+/,
        "$1ghcr.io/nokia/srlinux:25.10"
      )
      .replace(/\s+client2:\n(?:\s{6}.*\n)+/, "\n")
      .replace(/.*client2:eth1.*\n/, "")
      .replace(
        "  links:\n",
        "    client3:\n      kind: linux\n      image: alpine:3.22\n\n  links:\n" +
          '    - endpoints: ["leaf1:e1-2", "client3:eth1"]\n'
      );
    await page.evaluate(
      ([file, content]) =>
        (window as { __DEV__?: BrowserDevApi }).__DEV__!.writeYamlFile(file, content),
      [yamlFile, edited] as const
    );
    await expect(page.getByTestId("navbar-apply-dirty-badge").locator(".MuiBadge-badge")).not.toHaveClass(
      /MuiBadge-invisible/
    );

    await deploy.click();
    await expect(page.getByTestId("apply-plan-section-addedNodes")).toContainText("client3");
    await expect(page.getByTestId("apply-plan-section-deletedNodes")).toContainText("client2");
    await expect(page.getByTestId("apply-plan-section-recreatedNodes")).toContainText(
      "config drift: image"
    );
    // SR Linux takes the new link live, so leaf1 is not restarted.
    await expect(page.getByTestId("apply-plan-section-restartedNodes")).toHaveCount(0);
    await expect(page.getByTestId("apply-plan-section-addedLinks")).toContainText(
      "client3:eth1  ↔  leaf1:e1-2"
    );
    await expect(page.getByTestId("apply-plan-section-deletedEndpoints")).toContainText(
      "leaf2:e1-1"
    );

    await page.getByTestId("apply-plan-apply").click();
    await expect(page.getByTestId("lifecycle-progress-modal")).toContainText(
      "Recreating container name=spine1"
    );
    await okButton.click();
    await expect(deploy).toBeDisabled();
  });
});
