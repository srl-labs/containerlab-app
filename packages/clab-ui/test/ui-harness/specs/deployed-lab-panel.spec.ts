import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

const SEL_PANEL_TAB_INFO = '[data-testid="panel-tab-info"]';
const SEL_PANEL_TAB_EDIT = '[data-testid="panel-tab-edit"]';
const SEL_PANEL_TAB_BASIC = '[data-testid="panel-tab-basic"]';
const SEL_PANEL_TAB_CONFIG = '[data-testid="panel-tab-config"]';

const ATTR_ARIA_SELECTED = "aria-selected";
const ARIA_SELECTED_TRUE = "true";

async function nodeCenter(page: Page, nodeId: string): Promise<{ x: number; y: number }> {
  const nodeHandle = page.locator(`[data-id="${nodeId}"]`);
  await nodeHandle.scrollIntoViewIfNeeded();
  await expect(nodeHandle).toBeVisible({ timeout: 3000 });
  const box = await nodeHandle.boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function clickNode(page: Page, nodeId: string) {
  const { x, y } = await nodeCenter(page, nodeId);
  await page.mouse.click(x, y);
  await page.waitForTimeout(300);
}

async function doubleClickNode(page: Page, nodeId: string) {
  const { x, y } = await nodeCenter(page, nodeId);
  await page.mouse.dblclick(x, y);
  await page.waitForTimeout(300);
}

/**
 * Deployed lab ContextPanel E2E tests.
 *
 * Since the always-editable TopoViewer change, deployed labs keep mode "edit";
 * runtime behavior follows the deployment state instead. Clicking a node in a
 * deployed, unlocked lab selects it: the panel must land on the Info tab with
 * node properties (regression: empty Node Editor on click), and activating the
 * Edit tab must open the full node editor — same as double-click/context menu.
 */
test.describe("Deployed Lab Panel", () => {
  test.beforeEach(async ({ page, topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile("simple.clab.yml");
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
    await page.evaluate(() => {
      window.__DEV__?.setDeploymentState?.("deployed");
    });
  });

  test("clicking a node shows the info tab, not an empty editor", async ({
    page,
    topoViewerPage
  }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    expect(nodeIds.length).toBeGreaterThan(0);

    await clickNode(page, nodeIds[0]);

    const infoTab = page.locator(SEL_PANEL_TAB_INFO);
    await expect(infoTab).toBeVisible();
    await expect(infoTab).toHaveAttribute(ATTR_ARIA_SELECTED, ARIA_SELECTED_TRUE);
  });

  test("edit tab opens the full node editor for a selected node", async ({
    page,
    topoViewerPage
  }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    await clickNode(page, nodeIds[0]);

    const editTab = page.locator(SEL_PANEL_TAB_EDIT);
    await expect(editTab).toBeVisible();
    await editTab.click();

    // Activating the Edit tab enters the real editing state — the full editor
    // with all tabs, identical to double-click or context-menu Edit.
    await expect(page.getByText("Node Editor", { exact: true })).toBeVisible();
    await expect(page.locator(SEL_PANEL_TAB_BASIC)).toBeVisible();
    await expect(page.locator(SEL_PANEL_TAB_CONFIG)).toBeVisible();
    // Editing replaces the selection-driven info view, like double-click does.
    await expect(page.locator(SEL_PANEL_TAB_INFO)).toHaveCount(0);
  });

  test("double-clicking a node opens the full node editor", async ({
    page,
    topoViewerPage
  }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    await doubleClickNode(page, nodeIds[0]);

    await expect(page.getByText("Node Editor", { exact: true })).toBeVisible();
    await expect(page.locator(SEL_PANEL_TAB_BASIC)).toBeVisible();
    await expect(page.locator(SEL_PANEL_TAB_CONFIG)).toBeVisible();
  });
});
