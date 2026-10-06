/**
 * Node editor in the boxed node style: a Box section replaces the label
 * options, previews on the canvas, and persists `box` to the annotations.
 */
import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

const SIMPLE_FILE = "simple.clab.yml";
const NODE_ID = "srl1";

const SEL_APPLY_BTN = '[data-testid="panel-apply-btn"]';
const SEL_TOGGLE_BTN = '[data-testid="panel-toggle-btn"]';
const SEL_BOX_SECTION = '[data-testid="node-box-color"]';
const SEL_BOX_FILL_INPUT = "#node-box-color-input";
const SEL_BOX_RESET = '[data-testid="node-box-reset"]';
const SEL_LABEL_POSITION = "#node-label-position";

type TopoViewerPage = Parameters<Parameters<typeof test>[2]>[0]["topoViewerPage"];

async function loadWithNodeStyle(
  topoViewerPage: TopoViewerPage,
  nodeStyle: "icon" | "boxed",
  nodeBox?: Record<string, unknown>
): Promise<void> {
  const annotations = await topoViewerPage.getAnnotationsFromFile(SIMPLE_FILE);
  await topoViewerPage.writeAnnotationsFile(SIMPLE_FILE, {
    ...annotations,
    nodeAnnotations: (annotations.nodeAnnotations ?? []).map((entry) =>
      entry.id === NODE_ID && nodeBox ? { ...entry, box: nodeBox } : entry
    ),
    viewerSettings: { ...annotations.viewerSettings, nodeStyle }
  });
  await topoViewerPage.gotoFile(SIMPLE_FILE);
  await topoViewerPage.waitForCanvasReady();
  await topoViewerPage.setEditMode();
  await topoViewerPage.unlock();
  await topoViewerPage.fit();
}

async function openNodeEditor(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-id="${nodeId}"]`);
  await expect(node).toBeVisible({ timeout: 3000 });
  const rect = await node.boundingBox();
  if (!rect) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await expect(page.locator('[data-testid="panel-tab-basic"]')).toBeVisible({ timeout: 3000 });
}

async function closePanel(page: Page): Promise<void> {
  await page.locator(SEL_TOGGLE_BTN).click();
  await expect(page.locator('[data-testid="panel-tab-basic"]')).toHaveCount(0, { timeout: 3000 });
}

function nodeBox(page: Page, nodeId: string) {
  return page.locator(`[data-id="${nodeId}"] .topology-node-box`);
}

async function boxBackground(page: Page, nodeId: string): Promise<string> {
  return nodeBox(page, nodeId).evaluate((el) => (el as HTMLElement).style.background);
}

async function setFillColor(page: Page, hex: string): Promise<void> {
  await page.locator(SEL_BOX_FILL_INPUT).fill(hex);
  await page.locator(SEL_BOX_FILL_INPUT).blur();
}

/** Move the opacity slider to `value` with the keyboard (one step per key press). */
async function setOpacity(page: Page, value: number): Promise<void> {
  const slider = page.getByRole("slider", { name: "Opacity" });
  await slider.focus();
  await slider.press("End");
  for (let current = 100; current > value; current -= 10) {
    await slider.press("PageDown");
  }
  await expect(slider).toHaveValue(String(value));
}

async function getNodeBoxAnnotation(
  topoViewerPage: TopoViewerPage,
  nodeId: string
): Promise<unknown> {
  const annotations = await topoViewerPage.getAnnotationsFromFile(SIMPLE_FILE);
  return annotations.nodeAnnotations?.find((entry) => entry.id === nodeId)?.box ?? null;
}

test.describe("Node editor box style", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
  });

  test("boxed mode shows the Box section instead of the label options", async ({
    page,
    topoViewerPage
  }) => {
    await loadWithNodeStyle(topoViewerPage, "boxed");
    await openNodeEditor(page, NODE_ID);

    await expect(page.locator(SEL_BOX_SECTION)).toBeVisible();
    await expect(page.locator(SEL_BOX_RESET)).toBeVisible();
    for (const testId of [
      "node-box-opacity",
      "node-box-glass",
      "node-box-border-color",
      "node-box-border-width",
      "node-box-radius",
      "node-box-text-color",
      "node-box-shadow"
    ]) {
      await expect(page.locator(`[data-testid="${testId}"]`)).toBeVisible();
    }
    await expect(page.locator(SEL_LABEL_POSITION)).toHaveCount(0);
    await expect(page.locator("#node-direction")).toHaveCount(0);

    // Blur only shows with frosted glass, which also makes the fill translucent.
    await expect(page.locator('[data-testid="node-box-blur"]')).toHaveCount(0);
    await page.getByRole("switch", { name: "Frosted glass" }).check();
    await expect(page.locator('[data-testid="node-box-blur"]')).toBeVisible();
    await expect(page.getByRole("slider", { name: "Blur" })).toHaveValue("8");
    await expect(page.getByRole("slider", { name: "Opacity" })).toHaveValue("60");
    await expect
      .poll(() => nodeBox(page, NODE_ID).evaluate((el) => (el as HTMLElement).style.backdropFilter))
      .toContain("blur(8px)");
  });

  test("icon mode keeps the label options and hides the Box section", async ({
    page,
    topoViewerPage
  }) => {
    await loadWithNodeStyle(topoViewerPage, "icon");
    await openNodeEditor(page, NODE_ID);

    await expect(page.locator(SEL_LABEL_POSITION)).toBeVisible();
    await expect(page.locator(SEL_BOX_SECTION)).toHaveCount(0);
    await expect(page.locator(SEL_BOX_RESET)).toHaveCount(0);
  });

  test("fill color and opacity preview live and apply persists across reload", async ({
    page,
    topoViewerPage
  }) => {
    await loadWithNodeStyle(topoViewerPage, "boxed");
    await openNodeEditor(page, NODE_ID);
    const before = await boxBackground(page, NODE_ID);

    await setFillColor(page, "#ff0000");
    await expect.poll(() => boxBackground(page, NODE_ID)).toContain("rgb(255, 0, 0)");

    await setOpacity(page, 40);
    await expect.poll(() => boxBackground(page, NODE_ID)).toContain("40%");
    expect(await boxBackground(page, NODE_ID)).not.toBe(before);

    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(() => getNodeBoxAnnotation(topoViewerPage, NODE_ID), { timeout: 5000 })
      .toEqual({ color: "#ff0000", opacity: 40 });

    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await expect.poll(() => boxBackground(page, NODE_ID)).toContain("rgb(255, 0, 0)");
    await expect.poll(() => boxBackground(page, NODE_ID)).toContain("40%");

    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await openNodeEditor(page, NODE_ID);
    await expect(page.getByRole("slider", { name: "Opacity" })).toHaveValue("40");
  });

  test("closing without applying reverts the preview", async ({ page, topoViewerPage }) => {
    await loadWithNodeStyle(topoViewerPage, "boxed");
    await openNodeEditor(page, NODE_ID);
    const before = await boxBackground(page, NODE_ID);

    await setFillColor(page, "#00ff00");
    await setOpacity(page, 30);
    await expect.poll(() => boxBackground(page, NODE_ID)).toContain("rgb(0, 255, 0)");

    await closePanel(page);
    await expect.poll(() => boxBackground(page, NODE_ID)).toBe(before);
    expect(await getNodeBoxAnnotation(topoViewerPage, NODE_ID)).toBeNull();
  });

  test("reset to theme removes box from the annotations", async ({ page, topoViewerPage }) => {
    await loadWithNodeStyle(topoViewerPage, "boxed", { color: "#123456", opacity: 70 });
    await expect.poll(() => boxBackground(page, NODE_ID)).toContain("rgb(18, 52, 86)");

    await openNodeEditor(page, NODE_ID);
    await expect(page.getByRole("slider", { name: "Opacity" })).toHaveValue("70");
    await page.locator(SEL_BOX_RESET).click();
    await expect(page.locator(SEL_BOX_RESET)).toBeDisabled();
    await expect.poll(() => boxBackground(page, NODE_ID)).not.toContain("rgb(18, 52, 86)");

    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(() => getNodeBoxAnnotation(topoViewerPage, NODE_ID), { timeout: 5000 })
      .toBeNull();
  });
});
