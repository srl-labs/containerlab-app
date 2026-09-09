import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

const CANVAS_DRAG_FALLBACK_KEY = "__CLAB_UI_CANVAS_DRAG_DATA__";

async function dispatchCanvasDrop(
  page: Page,
  payload: Record<string, unknown>,
  mode: "text" | "fallback"
): Promise<void> {
  await page.evaluate(
    ({ dragPayload, dragMode, fallbackKey }) => {
      const canvas = document.querySelector<HTMLElement>(".react-flow-canvas");
      if (!canvas) throw new Error("Canvas container not found");
      const rect = canvas.getBoundingClientRect();
      const dataTransfer = new DataTransfer();
      if (dragMode === "text") {
        dataTransfer.setData("text/plain", JSON.stringify(dragPayload));
      } else {
        (window as unknown as Record<string, unknown>)[fallbackKey] = {
          payload: dragPayload,
          timestamp: Date.now()
        };
      }
      canvas.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          dataTransfer
        })
      );
    },
    { dragPayload: payload, dragMode: mode, fallbackKey: CANVAS_DRAG_FALLBACK_KEY }
  );
}

test.describe("Canvas Interactions", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.gotoFile("simple.clab.yml");
    await topoViewerPage.waitForCanvasReady();
  });

  test("canvas is visible and has correct selector", async ({ page }) => {
    const canvas = page.locator(".react-flow");
    await expect(canvas).toBeVisible();
  });

  test("app container is visible", async ({ page }) => {
    const app = page.locator('[data-testid="topoviewer-app"]');
    await expect(app).toBeVisible();
  });

  test("click on empty canvas deselects all", async ({ page, topoViewerPage }) => {
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();

    const nodeIds = await topoViewerPage.getNodeIds();
    expect(nodeIds.length).toBeGreaterThan(0);

    // Select a node
    await topoViewerPage.selectNode(nodeIds[0]);
    let selectedIds = await topoViewerPage.getSelectedNodeIds();
    expect(selectedIds.length).toBe(1);

    // Click on empty canvas area (far from center where nodes are)
    await topoViewerPage.clearSelection();
    await page.waitForTimeout(200);

    selectedIds = await topoViewerPage.getSelectedNodeIds();
    expect(selectedIds.length).toBe(0);
  });

  test("lock state persists across interactions", async ({ page, topoViewerPage }) => {
    await topoViewerPage.setEditMode();

    // Unlock the canvas
    await topoViewerPage.unlock();
    let isLocked = await topoViewerPage.isLocked();
    expect(isLocked).toBe(false);

    // Lock the canvas
    await topoViewerPage.lock();
    isLocked = await topoViewerPage.isLocked();
    expect(isLocked).toBe(true);

    // Verify lock persists after some interactions
    const canvasCenter = await topoViewerPage.getCanvasCenter();
    await page.mouse.click(canvasCenter.x, canvasCenter.y);
    await page.waitForTimeout(100);

    isLocked = await topoViewerPage.isLocked();
    expect(isLocked).toBe(true);
  });

  test("mode switching works correctly", async ({ topoViewerPage }) => {
    // Start in edit mode
    await topoViewerPage.setEditMode();

    // Switch to view mode
    await topoViewerPage.setViewMode();

    // Node count should remain the same
    const nodeCount = await topoViewerPage.getNodeCount();
    expect(nodeCount).toBeGreaterThan(0);

    // Switch back to edit mode
    await topoViewerPage.setEditMode();

    // Node count should still be the same
    const nodeCountAfter = await topoViewerPage.getNodeCount();
    expect(nodeCountAfter).toBe(nodeCount);
  });

  test("Ctrl+A is scoped to the canvas and does not select side-panel text", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.clearSelection();

    const panelPaper = page.locator('[data-testid="context-panel"] .MuiDrawer-paper');
    if (!(await panelPaper.isVisible().catch(() => false))) {
      await page.locator('[data-testid="panel-toggle-btn"]').click();
    }
    await expect(panelPaper).toBeVisible();
    await panelPaper.click({ position: { x: 20, y: 20 } });
    await page.keyboard.press("Control+A");

    await expect.poll(() => topoViewerPage.getSelectedNodeIds()).toEqual([]);
    const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    expect(selectedText).toBe("");

    const canvas = topoViewerPage.getCanvas();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.keyboard.press("Control+A");

    await expect
      .poll(() => topoViewerPage.getSelectedNodeIds(), {
        timeout: 3000,
        message: "expected Ctrl+A to select topology nodes from canvas focus"
      })
      .toEqual(expect.arrayContaining(await topoViewerPage.getNodeIds()));
  });

  test("canvas drop accepts text/plain and stripped-dataTransfer fallback payloads", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile("empty.clab.yml");
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();

    await dispatchCanvasDrop(page, { type: "network", networkType: "bridge" }, "text");
    await expect
      .poll(() => topoViewerPage.getNetworkNodeIds(), {
        timeout: 5000,
        message: "expected text/plain drag payload to create a network"
      })
      .toHaveLength(1);

    await dispatchCanvasDrop(page, { type: "network", networkType: "dummy" }, "fallback");
    await expect
      .poll(() => topoViewerPage.getNetworkNodeIds(), {
        timeout: 5000,
        message: "expected fallback drag payload to create a network"
      })
      .toHaveLength(2);
  });
});
