import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";
import {
  getEmptyCanvasArea,
  modelToPageCoords,
  openNodeContextMenu
} from "../helpers/react-flow-helpers";

const FILE = "simple.clab.yml";
const ADD_MODE_TEXT = "Adding text";

/** Two overlapping rectangles behind the nodes, and the fixture's nodes. */
const ANNOTATIONS = {
  freeTextAnnotations: [],
  freeShapeAnnotations: [
    { id: "shape-a", shapeType: "rectangle", position: { x: 100, y: 100 }, width: 120, height: 80, zIndex: -1 },
    { id: "shape-b", shapeType: "rectangle", position: { x: 150, y: 120 }, width: 120, height: 80, zIndex: -1 }
  ],
  groupStyleAnnotations: [],
  nodeAnnotations: [
    { id: "srl1", position: { x: 380, y: 360 } },
    { id: "srl2", position: { x: 660, y: 360 } }
  ]
};

async function clickEmptyCanvas(page: Page): Promise<void> {
  const area = await getEmptyCanvasArea(page);
  await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
}

async function shapeZIndex(
  topoViewerPage: { getAnnotationsFromFile: (file: string) => Promise<{ freeShapeAnnotations?: Array<{ id: string; zIndex?: number }> }> },
  id: string
): Promise<number | undefined> {
  const annotations = await topoViewerPage.getAnnotationsFromFile(FILE);
  return annotations.freeShapeAnnotations?.find((shape) => shape.id === id)?.zIndex;
}

test.describe("Editor shortcuts", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
  });

  test("single keys switch canvas tools, V goes back to selecting", async ({ page }) => {
    await clickEmptyCanvas(page);

    await page.keyboard.press("t");
    await expect(page.getByText(ADD_MODE_TEXT)).toBeVisible();
    await page.keyboard.press("v");
    await expect(page.getByText(ADD_MODE_TEXT)).toBeHidden();

    await page.keyboard.press("r");
    await expect(page.getByText("Click on the canvas to add rectangle")).toBeVisible();
    await clickEmptyCanvas(page);
    await expect(page.locator(".react-flow__node-free-shape-node")).toHaveCount(1);

    await page.keyboard.press("o");
    await expect(page.getByText("Click on the canvas to add circle")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Click on the canvas to add circle")).toBeHidden();
  });

  test("single keys never fire while typing", async ({ page }) => {
    await clickEmptyCanvas(page);
    await page.getByTestId("navbar-split-view").click();
    await page.getByTestId("panel-tab-nodes").click();
    const search = page.getByPlaceholder("Search nodes...");
    await search.click();
    await page.keyboard.type("tr");

    await expect(search).toHaveValue("tr");
    await expect(page.getByText(ADD_MODE_TEXT)).toBeHidden();
  });

  test("G groups the selection and adds no empty group without one", async ({
    page,
    topoViewerPage
  }) => {
    await clickEmptyCanvas(page);
    await page.keyboard.press("g");
    await page.waitForTimeout(300);
    expect(await topoViewerPage.getGroupCount()).toBe(0);

    await topoViewerPage.selectNode("srl1");
    await page.keyboard.press("g");
    await expect.poll(() => topoViewerPage.getGroupCount()).toBe(1);
  });

  test("L starts a link from the selected node", async ({ page, topoViewerPage }) => {
    await topoViewerPage.selectNode("srl1");
    await page.keyboard.press("l");
    await expect(page.getByText("Creating link from")).toBeVisible();
    await page.keyboard.press("v");
    await expect(page.getByText("Creating link from")).toBeHidden();
  });

  test("Ctrl+] and Ctrl+Shift+[ reorder the selected annotation, saved and undoable", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.writeAnnotationsFile(FILE, ANNOTATIONS);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.selectNode("shape-a");

    await page.keyboard.press("Control+BracketRight");
    await expect.poll(() => shapeZIndex(topoViewerPage, "shape-a")).toBe(0);

    await page.keyboard.press("Control+Shift+BracketLeft");
    await expect.poll(() => shapeZIndex(topoViewerPage, "shape-a")).toBe(-2);

    await topoViewerPage.undo();
    await expect.poll(() => shapeZIndex(topoViewerPage, "shape-a")).toBe(0);
  });

  test("annotation context menus arrange and show the shortcut keys", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.writeAnnotationsFile(FILE, ANNOTATIONS);
    await topoViewerPage.waitForCanvasReady();

    await openNodeContextMenu(page, "shape-a");
    const front = page.getByTestId("context-menu-item-bring-to-front");
    await expect(front).toContainText("Ctrl+Shift+]");
    await expect(page.getByTestId("context-menu-item-delete-shape")).toContainText("Del");
    await front.click();

    // Above the other shape.
    await expect.poll(() => shapeZIndex(topoViewerPage, "shape-a")).toBe(0);
    const zIndex = await page.evaluate(() => {
      const dev = (
        window as unknown as {
          __DEV__: { rfInstance: { getNodes: () => Array<{ id: string; zIndex?: number }> } };
        }
      ).__DEV__;
      return dev.rfInstance.getNodes().find((node) => node.id === "shape-a")?.zIndex;
    });
    expect(zIndex).toBe(0);

    // Where shape-b does not lie under shape-a.
    const point = await modelToPageCoords(page, 250, 190);
    await page.mouse.click(point.x, point.y, { button: "right" });
    await page.getByTestId("context-menu-item-bring-to-front").click();
    await expect.poll(() => shapeZIndex(topoViewerPage, "shape-b")).toBe(1);
  });

  test("the shortcuts modal lists the single-key tools from the same table", async ({ page }) => {
    await page.getByTestId("navbar-more").click();
    await page.getByTestId("navbar-shortcuts").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Add text")).toBeVisible();
    await expect(dialog.getByText("Bring to front")).toBeVisible();
    await expect(page.getByTestId("navbar-undo")).toHaveAttribute("aria-label", "Undo (Ctrl+Z)");
  });

  test("the status line counts nodes, links and annotations", async ({ page, topoViewerPage }) => {
    const stats = page.getByTestId("canvas-stats");
    await expect(stats).toHaveText("2 nodes • 1 link • 1 annotation");

    await topoViewerPage.writeAnnotationsFile(FILE, ANNOTATIONS);
    await topoViewerPage.waitForCanvasReady();
    await expect(stats).toHaveText("2 nodes • 1 link • 2 annotations");
  });
});
