import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

// Palette drags render a DOM ghost that follows the cursor (the native HTML5
// drag image is suppressed because some hosts, e.g. the VS Code webview on
// Linux, never render it).
const GHOST_SELECTOR = "[data-palette-drag-ghost]";

async function dispatchDragStart(page: Page, cardLabel: string): Promise<void> {
  await page.evaluate((label) => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[draggable="true"]'));
    const card = cards.find((el) => el.textContent?.includes(label));
    if (!card) throw new Error(`Palette card "${label}" not found`);
    card.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        clientX: 200,
        clientY: 200,
        dataTransfer: new DataTransfer()
      })
    );
  }, cardLabel);
}

function dispatchDragEvent(page: Page, type: string, x: number, y: number): Promise<void> {
  return page.evaluate(
    ({ eventType, clientX, clientY }) => {
      document.body.dispatchEvent(
        new DragEvent(eventType, {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          dataTransfer: new DataTransfer()
        })
      );
    },
    { eventType: type, clientX: x, clientY: y }
  );
}

test.describe("Palette drag preview", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.gotoFile("simple.clab.yml");
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
  });

  test("network drag shows a canvas-style icon ghost", async ({ page }) => {
    await dispatchDragStart(page, "Mgmt Net");

    const ghost = page.locator(GHOST_SELECTOR);
    await expect(ghost).toHaveCount(1);
    // Icon rendered like the canvas network node (cloud SVG data URI) with a
    // canvas-style label under it.
    const html = await ghost.innerHTML();
    expect(html).toContain("background-image");
    expect(html).toContain("data:image/svg+xml");
    expect(html).toContain("Mgmt Net");

    await dispatchDragEvent(page, "dragend", 200, 200);
  });

  test("annotation drag clones the palette glyph into the ghost", async ({ page }) => {
    await page.locator('[data-tab="annotations"]').click();
    await expect(page.locator('[draggable="true"]').filter({ hasText: "Rectangle" })).toBeVisible();

    await dispatchDragStart(page, "Rectangle");

    const ghost = page.locator(GHOST_SELECTOR);
    await expect(ghost).toHaveCount(1);
    const html = await ghost.innerHTML();
    expect(html).toContain("<svg");
    expect(html).toContain("Rectangle");

    await dispatchDragEvent(page, "dragend", 200, 200);
  });

  test("ghost follows the cursor during dragover", async ({ page }) => {
    await dispatchDragStart(page, "Mgmt Net");

    const ghost = page.locator(GHOST_SELECTOR);
    const initialTransform = await ghost.evaluate((el) => el.style.transform);

    await dispatchDragEvent(page, "dragover", 500, 400);

    const movedTransform = await ghost.evaluate((el) => el.style.transform);
    expect(movedTransform).not.toBe(initialTransform);
    // Cursor sits at the icon center: y = clientY - 20 (icon is 40px tall).
    expect(movedTransform).toContain("380px");

    await dispatchDragEvent(page, "dragend", 500, 400);
  });

  test("ghost is removed when the drag ends", async ({ page }) => {
    await dispatchDragStart(page, "Mgmt Net");
    await expect(page.locator(GHOST_SELECTOR)).toHaveCount(1);

    await dispatchDragEvent(page, "dragend", 300, 300);
    await expect(page.locator(GHOST_SELECTOR)).toHaveCount(0);
  });

  test("ghost is removed on drop", async ({ page }) => {
    await dispatchDragStart(page, "Mgmt Net");
    await expect(page.locator(GHOST_SELECTOR)).toHaveCount(1);

    await dispatchDragEvent(page, "drop", 300, 300);
    await expect(page.locator(GHOST_SELECTOR)).toHaveCount(0);
  });
});
