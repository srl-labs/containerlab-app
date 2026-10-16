import type { Locator, Page } from "@playwright/test";
import * as YAML from "yaml";

import { test, expect } from "../fixtures/topoviewer";

const FILE = "stages.clab.yml";
const SEL_APPLY_BTN = '[data-testid="panel-apply-btn"]';

interface ParsedTopology {
  topology: { nodes: Record<string, Record<string, unknown> | null> };
}

async function readNode(
  topoViewerPage: { getYamlFromFile: (file: string) => Promise<string> },
  nodeId: string
): Promise<Record<string, unknown> | null> {
  const parsed = YAML.parse(await topoViewerPage.getYamlFromFile(FILE)) as ParsedTopology;
  return parsed.topology.nodes[nodeId];
}

async function openStagesTab(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-id="${nodeId}"]`);
  await expect(node).toBeVisible({ timeout: 3000 });
  const box = await node.boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const tab = page.locator('[data-testid="panel-tab-stages"]');
  await expect(tab).toBeVisible({ timeout: 3000 });
  await tab.click();
}

async function pickOption(page: Page, select: Locator, name: string): Promise<void> {
  await select.click();
  await page.getByRole("option", { name, exact: true }).click();
}

async function addWaitFor(
  page: Page,
  stage: string,
  index: number,
  node: string,
  untilStage: string
): Promise<void> {
  await page.getByTestId(`stage-add-wait-for-${stage}`).click();
  const nodeInput = page.locator(`#node-stage-${stage}-wait-for-${index}-node`);
  await nodeInput.fill(node);
  await nodeInput.blur();
  await pickOption(page, page.locator(`#node-stage-${stage}-wait-for-${index}-stage`), untilStage);
}

test.describe("Stages editor", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
  });

  test("shows the node's own stages and what its kind adds", async ({ page }) => {
    await openStagesTab(page, "leaf1");

    const create = page.getByTestId("stage-section-create");
    await expect(create.getByTestId("stage-inherited-entry")).toContainText(
      "Waits for ca (healthy)"
    );
    await expect(create.getByTestId("stage-inherited-entry")).toContainText("from kind");
    await expect(page.locator("#node-stage-create-wait-for-0-node")).toHaveValue("spine1");

    const createLinks = page.getByTestId("stage-section-create-links");
    await expect(page.locator("#node-stage-create-links-exec-0-command")).toHaveValue(
      "ip link show"
    );
    await expect(createLinks.getByTestId("stage-exec-row")).toHaveCount(1);
  });

  test("adding a wait-for and a command writes the node's stages", async ({
    page,
    topoViewerPage
  }) => {
    await openStagesTab(page, "client1");
    await addWaitFor(page, "create", 0, "leaf1", "configure");

    await page.getByTestId("stage-add-exec-healthy").click();
    await page.locator("#node-stage-healthy-exec-0-command").fill("echo ready");
    await pickOption(page, page.locator("#node-stage-healthy-exec-0-phase"), "On exit");
    await pickOption(page, page.locator("#node-stage-healthy-exec-0-target"), "Host");

    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(async () => (await readNode(topoViewerPage, "client1"))?.stages, { timeout: 5000 })
      .toEqual({
        create: { "wait-for": [{ node: "leaf1", stage: "configure" }] },
        healthy: { exec: [{ command: "echo ready", phase: "on-exit", target: "host" }] }
      });
  });

  test("removing the last row removes the stages key", async ({ page, topoViewerPage }) => {
    await openStagesTab(page, "leaf1");
    await page.getByTestId("stage-section-create").getByRole("button", { name: "Remove" }).click();
    await page
      .getByTestId("stage-section-create-links")
      .getByRole("button", { name: "Remove" })
      .click();

    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(async () => readNode(topoViewerPage, "leaf1"), { timeout: 5000 })
      .not.toHaveProperty("stages");
  });

  test("flags unknown nodes and wait-for loops", async ({ page }) => {
    await openStagesTab(page, "spine1");
    await addWaitFor(page, "configure", 0, "nosuchnode", "create");
    await expect(page.getByText("There is no node named nosuchnode")).toBeVisible();

    const nodeInput = page.locator("#node-stage-configure-wait-for-0-node");
    await nodeInput.fill("leaf1");
    await nodeInput.blur();
    await expect(page.getByTestId("stage-cycle-error")).toContainText("spine1 → leaf1 → spine1");
    await expect(page.getByText("Nodes wait for each other in a loop", { exact: true })).toBeVisible();
  });

  test("the Links menu draws wait-for arrows and remembers the choice", async ({
    page,
    topoViewerPage
  }) => {
    await expect(page.getByTestId("wait-for-overlay")).toHaveCount(0);

    await page.getByRole("button", { name: "Links", exact: true }).click();
    const toggle = page.getByRole("menuitemcheckbox", { name: "Show Wait-for Dependencies" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();

    const arrows = page.getByTestId("wait-for-arrow");
    // The kind makes every SR Linux node wait for ca; leaf1 also waits for spine1
    await expect(arrows).toHaveCount(4);
    await expect(page.locator('[data-testid="wait-for-arrow"][data-from="spine1"]')).toHaveAttribute(
      "data-to",
      "leaf1"
    );
    await expect
      .poll(async () => (await topoViewerPage.getAnnotationsFromFile(FILE)).viewerSettings)
      .toMatchObject({ showWaitFor: true });
  });
});
