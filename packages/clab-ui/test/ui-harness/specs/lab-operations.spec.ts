import type { Page } from "@playwright/test";

import type { BrowserDevApi } from "../devApi";
import { test, expect } from "../fixtures/topoviewer";
import { openNodeContextMenu, shiftClick } from "../helpers/react-flow-helpers";

const SPINE_LEAF_FILE = "spine-leaf.clab.yml";

interface HarnessMessage {
  command: string;
  operation?: string;
  request?: Record<string, unknown>;
  nodeName?: string;
  nodeNames?: string[];
  options?: Record<string, unknown>;
}

async function setDeploymentState(page: Page, state: "deployed" | "undeployed"): Promise<void> {
  await page.evaluate((next) => {
    const dev = (window as { __DEV__?: BrowserDevApi }).__DEV__;
    if (!dev) throw new Error("__DEV__ API not available");
    dev.setDeploymentState?.(next);
  }, state);
}

async function messages(page: Page, command: RegExp): Promise<HarnessMessage[]> {
  return page.evaluate((source) => {
    const pattern = new RegExp(source);
    const recorded = (window as { __CLAB_UI_HARNESS_MESSAGES__?: HarnessMessage[] })
      .__CLAB_UI_HARNESS_MESSAGES__;
    return (recorded ?? []).filter((message) => pattern.test(message.command));
  }, command.source);
}

async function openDeployMenuItem(page: Page, testId: string): Promise<void> {
  await page.getByTestId("navbar-deploy-menu").click();
  await page.getByTestId(testId).click();
}

async function pick(page: Page, testId: string, option: string): Promise<void> {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

function checkbox(page: Page, testId: string) {
  return page.getByTestId(testId).locator('input[type="checkbox"]');
}

test.describe("Lab operations", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SPINE_LEAF_FILE);
    await topoViewerPage.waitForCanvasReady();
  });

  test("runs a command on a node and on the nodes with a label", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await openNodeContextMenu(page, "leaf1");
    await page.getByTestId("context-menu-item-exec-node").click();

    const dialog = page.getByTestId("lab-exec-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "leaf1" })).toBeVisible();
    await page.getByTestId("lab-exec-command").fill("ip -br addr");
    await expect(page.getByTestId("lab-exec-preview")).toHaveText(
      'containerlab exec --cmd "ip -br addr" # on leaf1'
    );
    await page.getByTestId("lab-exec-run").click();
    await expect(page.getByTestId("lab-exec-stdout-leaf1")).toHaveText("leaf1: ip -br addr ok");
    await expect(page.getByTestId("lab-exec-code-leaf1")).toHaveText("exit 0");

    await page.getByTestId("lab-exec-target-label").click();
    await expect(page.getByTestId("lab-exec-run")).toBeDisabled();
    await page.getByTestId("lab-exec-labels").fill("role=spine");
    await page.getByTestId("lab-exec-labels").press("Enter");
    await page.getByTestId("lab-exec-command").fill("fail now");
    await page.getByTestId("lab-exec-run").click();
    await expect(page.getByTestId("lab-exec-code-spine1")).toHaveText("exit 1");
    await expect(page.getByTestId("lab-exec-stderr-spine2")).toHaveText("spine2: command failed");
    await expect(page.getByTestId("lab-exec-result-leaf1")).toHaveCount(0);

    expect((await messages(page, /^labOperation$/)).map((message) => message.request)).toEqual([
      { command: "ip -br addr", nodeNames: ["leaf1"] },
      { command: "fail now", labels: ["role=spine"] }
    ]);
  });

  test("starts, stops and restarts the selected nodes at once", async ({ page, topoViewerPage }) => {
    await setDeploymentState(page, "deployed");
    await topoViewerPage.selectNode("leaf1");
    const box = await topoViewerPage.getNodeBoundingBox("leaf2");
    expect(box).not.toBeNull();
    await shiftClick(page, box!.x + box!.width / 2, box!.y + box!.height / 2);
    expect((await topoViewerPage.getSelectedNodeIds()).sort()).toEqual(["leaf1", "leaf2"]);

    await openNodeContextMenu(page, "leaf2");
    const stop = page.getByTestId("context-menu-item-stop-node");
    await expect(stop).toContainText("Stop 2 Nodes");
    await stop.click();

    const [message] = await messages(page, /^clab-node-stop$/);
    expect(message?.nodeNames?.slice().sort()).toEqual(["leaf1", "leaf2"]);
  });

  test("saves configs with a copy, VM snapshots and shows inspect details", async ({ page }) => {
    await setDeploymentState(page, "deployed");

    await openDeployMenuItem(page, "navbar-deploy-item-lab-saveConfigs");
    await checkbox(page, "lab-save-copy").check();
    await page.locator("#lab-save-copy-dir").fill("backups");
    await expect(page.getByTestId("lab-save-preview")).toHaveText("containerlab save --copy backups");
    await page.getByTestId("lab-save-run").click();
    await expect(page.getByTestId("lab-save-result")).toContainText("Copied to backups.");
    await page.getByTestId("lab-save-close").click();

    await openDeployMenuItem(page, "navbar-deploy-item-lab-snapshots");
    await pick(page, "lab-snapshots-nodes", "spine1");
    await page.locator("#lab-snapshots-timeout").fill("soon");
    await expect(page.getByTestId("lab-snapshots-run")).toBeDisabled();
    await page.locator("#lab-snapshots-timeout").fill("10m");
    await page.getByTestId("lab-snapshots-run").click();
    await expect(page.getByTestId("lab-snapshots-summary")).toContainText(
      "0 succeeded, 0 failed, 1 skipped"
    );
    await expect(page.getByTestId("lab-snapshots-node-spine1")).toContainText(
      "not a vrnetlab node"
    );
    await page.getByTestId("lab-snapshots-close").click();

    await openDeployMenuItem(page, "navbar-deploy-item-lab-details");
    await expect(page.getByTestId("lab-details-node-client1")).toContainText("network-multitool");
    await page.getByTestId("lab-details-toggle-leaf1").click();
    await expect(page.getByTestId("lab-details-json-leaf1")).toContainText('"clab-node-kind": "nokia_srlinux"');

    expect(
      (await messages(page, /^labOperation$/)).map((message) => [message.operation, message.request])
    ).toEqual([
      ["saveConfigs", { copyDir: "backups" }],
      ["saveSnapshots", { nodeNames: ["spine1"], outputDir: "snapshots", timeout: "10m" }],
      ["inspectDetails", undefined]
    ]);
  });

  test("deploys with VM snapshots restored", async ({ page }) => {
    await setDeploymentState(page, "undeployed");
    await openDeployMenuItem(page, "navbar-deploy-item-options");

    await checkbox(page, "lifecycle-options-restore").check();
    await page.getByTestId("lifecycle-options-restore-add").click();
    await pick(page, "lifecycle-options-restore-node-0", "spine1");
    await page.getByTestId("lifecycle-options-restore-path-0").fill("golden/spine1.tar");
    await expect(page.getByTestId("lifecycle-options-command")).toHaveText(
      "containerlab deploy --restore-all=snapshots --restore=spine1=golden/spine1.tar"
    );

    await page.locator("#lifecycle-options-restore-all").fill("");
    await page.getByTestId("lifecycle-options-restore-path-0").fill("");
    await expect(page.getByTestId("lifecycle-options-run")).toBeDisabled();
    await page.getByTestId("lifecycle-options-restore-path-0").fill("golden/spine1.tar");

    await page.getByTestId("lifecycle-options-run").click();
    expect(await messages(page, /^deployLab$/)).toEqual([
      { command: "deployLab", options: { restore: [{ node: "spine1", path: "golden/spine1.tar" }] } }
    ]);
  });
});

test.describe("Lab operations on an older lab host", () => {
  test.beforeEach(async ({ page, topoViewerPage }) => {
    await page.addInitScript(() => {
      (window as { __CLAB_UI_HARNESS_LAB_OPERATIONS__?: unknown }).__CLAB_UI_HARNESS_LAB_OPERATIONS__ =
        "old";
    });
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SPINE_LEAF_FILE);
    await topoViewerPage.waitForCanvasReady();
  });

  test("hides what the lab host lacks", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await page.getByTestId("navbar-deploy-menu").click();
    await expect(page.getByTestId("navbar-deploy-item-lab-exec")).toBeVisible();
    await expect(page.getByTestId("navbar-deploy-item-lab-saveConfigs")).toBeVisible();
    await expect(page.getByTestId("navbar-deploy-item-lab-snapshots")).toHaveCount(0);
    await expect(page.getByTestId("navbar-deploy-item-lab-details")).toHaveCount(0);

    await page.getByTestId("navbar-deploy-item-lab-exec").click();
    await expect(page.getByTestId("lab-exec-dialog")).toBeVisible();
    await expect(page.getByTestId("lab-exec-target-label")).toHaveCount(0);
    await page.getByTestId("lab-exec-close").click();

    await openDeployMenuItem(page, "navbar-deploy-item-lab-saveConfigs");
    await expect(page.getByTestId("lab-save-dialog")).toBeVisible();
    await expect(page.getByTestId("lab-save-copy")).toHaveCount(0);
    await page.getByTestId("lab-save-close").click();

    await openNodeContextMenu(page, "leaf1");
    await expect(page.getByTestId("context-menu-item-details-node")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await setDeploymentState(page, "undeployed");
    await openDeployMenuItem(page, "navbar-deploy-item-options");
    await expect(page.getByTestId("lifecycle-options-restore")).toHaveCount(0);
  });
});
