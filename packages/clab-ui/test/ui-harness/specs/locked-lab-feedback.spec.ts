import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";
import { drag } from "../helpers/react-flow-helpers";

/** Counts shake animations started on the navbar lock button. */
async function trackLockShakes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>('[data-testid="navbar-lock"]');
    if (!button) throw new Error("navbar lock button not found");
    const win = window as unknown as { __lockShakes: number };
    win.__lockShakes = 0;
    const animate = button.animate.bind(button);
    button.animate = (...args: Parameters<HTMLElement["animate"]>) => {
      win.__lockShakes += 1;
      return animate(...args);
    };
  });
}

function lockShakes(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __lockShakes: number }).__lockShakes);
}

test.describe("Locked lab feedback", () => {
  test.beforeEach(async ({ page, topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile("simple.clab.yml");
    await topoViewerPage.waitForCanvasReady();
    if (!(await page.getByTestId("panel-tab-nodes").isVisible())) {
      await page.getByTestId("panel-toggle-btn").click();
    }
    await topoViewerPage.setEditMode();
    await topoViewerPage.lock();
    await trackLockShakes(page);
  });

  test("palette cards read as disabled in every tab while locked", async ({ page }) => {
    const networkCard = page.locator("[aria-disabled='true']").filter({ hasText: "Mgmt Net" });
    await expect(networkCard).toBeVisible();
    await expect(networkCard).toHaveAttribute("draggable", "false");
    // Template actions are hidden, not just disabled.
    await expect(page.getByTestId("palette-import-templates")).toHaveCount(0);
    await expect(page.getByTestId("palette-export-templates")).toHaveCount(0);
    // Searching stays available; it changes nothing.
    await expect(page.getByPlaceholder("Search nodes…")).toBeEnabled();

    await page.locator('[data-tab="annotations"]').click();
    const textCard = page.locator("[aria-disabled='true']").filter({ hasText: "Rectangle" });
    await expect(textCard).toBeVisible();
    await expect(textCard).toHaveAttribute("draggable", "false");
  });

  test("grabbing a locked palette card shakes the lock", async ({ page }) => {
    const card = page.locator("[aria-disabled='true']").filter({ hasText: "Mgmt Net" });
    await card.click();
    await card.click();

    await expect.poll(() => lockShakes(page)).toBe(2);
  });

  test("source tabs say they are read-only while locked", async ({ page }) => {
    await page.locator('[data-tab="yaml"]').click();
    await expect(page.getByTestId("palette-source-readonly")).toBeVisible();
    await page.locator('[data-tab="json"]').click();
    await expect(page.getByTestId("palette-source-readonly")).toBeVisible();
  });

  test("a plain click on a node does not shake the lock", async ({ page, topoViewerPage }) => {
    const [nodeId] = await topoViewerPage.getNodeIds();
    const box = await topoViewerPage.getNodeBoundingBox(nodeId);
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    await page.waitForTimeout(200);
    expect(await lockShakes(page)).toBe(0);
  });

  test("dragging a node while locked shakes the lock, no toast", async ({
    page,
    topoViewerPage
  }) => {
    const [nodeId] = await topoViewerPage.getNodeIds();
    const box = await topoViewerPage.getNodeBoundingBox(nodeId);
    expect(box).not.toBeNull();
    const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    await drag(page, start, { x: start.x + 80, y: start.y + 40 }, { steps: 8 });

    await expect.poll(() => lockShakes(page)).toBe(1);
    await expect(page.getByText("Lab is locked")).toHaveCount(0);
  });

  test("the node editor is read-only and pressing it shakes the lock", async ({
    page,
    topoViewerPage
  }) => {
    const [nodeId] = await topoViewerPage.getNodeIds();
    const box = await topoViewerPage.getNodeBoundingBox(nodeId);
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const form = page.getByTestId("editor-readonly");
    await expect(form).toBeVisible();
    await expect(form.locator("input").first()).toBeDisabled();
    await expect(form.locator(".MuiIconButton-root, .MuiButton-root").first()).toBeHidden();

    await form.click();
    await expect.poll(() => lockShakes(page)).toBe(1);
  });

  test("pressing Delete on a selected node while locked shakes the lock", async ({
    page,
    topoViewerPage
  }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    await topoViewerPage.selectNode(nodeIds[0]);
    await page.keyboard.press("Delete");

    await expect.poll(() => lockShakes(page)).toBe(1);
    expect(await topoViewerPage.getNodeIds()).toEqual(nodeIds);
  });
});
