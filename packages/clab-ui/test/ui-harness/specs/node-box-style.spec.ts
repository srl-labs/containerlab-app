/**
 * Boxed node style: each node icon sits in a box with its name inside, long
 * names are shortened in the middle, and links attach to the box outline.
 */
import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

const SIMPLE_FILE = "simple.clab.yml";
const LONG_NAME = "srl-datacenter-west-leaf-01";

const SEL_LAB_SETTINGS_BTN = '[data-testid="navbar-lab-settings"]';
const SEL_LAB_SETTINGS_MODAL = '[data-testid="lab-settings-modal"]';
const SEL_LAB_SETTINGS_TAB_APPEARANCE = '[data-testid="lab-settings-tab-appearance"]';
const SEL_LAB_SETTINGS_SAVE_BTN = '[data-testid="lab-settings-save-btn"]';
const SEL_NODE_BOX = ".topology-node-box";

type TopoViewerPage = Parameters<Parameters<typeof test>[2]>[0]["topoViewerPage"];

async function enableBoxedStyle(
  topoViewerPage: TopoViewerPage,
  extraSettings: Record<string, unknown> = {}
): Promise<void> {
  const annotations = await topoViewerPage.getAnnotationsFromFile(SIMPLE_FILE);
  await topoViewerPage.writeAnnotationsFile(SIMPLE_FILE, {
    ...annotations,
    viewerSettings: { ...annotations.viewerSettings, ...extraSettings, nodeStyle: "boxed" }
  });
  await topoViewerPage.gotoFile(SIMPLE_FILE);
  await topoViewerPage.waitForCanvasReady();
}

async function renameNode(topoViewerPage: TopoViewerPage, from: string, to: string) {
  const yaml = await topoViewerPage.getYamlFromFile(SIMPLE_FILE);
  const annotations = await topoViewerPage.getAnnotationsFromFile(SIMPLE_FILE);
  const pattern = new RegExp(`\\b${from}\\b`, "g");
  await topoViewerPage.writeYamlFile(SIMPLE_FILE, yaml.replace(pattern, to));
  await topoViewerPage.writeAnnotationsFile(
    SIMPLE_FILE,
    JSON.parse(JSON.stringify(annotations).replace(pattern, to)) as object
  );
}

/** Edge endpoints and box rects in flow coordinates. */
async function captureLinkGeometry(page: Page) {
  return page.evaluate(() => {
    const dev = (window as any).__DEV__;
    const viewport = dev.rfInstance.getViewport();
    const container = document.querySelector(".react-flow")!.getBoundingClientRect();
    const toFlow = (x: number, y: number) => ({
      x: (x - container.left - viewport.x) / viewport.zoom,
      y: (y - container.top - viewport.y) / viewport.zoom
    });
    const boxes = Array.from(document.querySelectorAll(".topology-node-box")).map((el) => {
      const r = el.getBoundingClientRect();
      const tl = toFlow(r.left, r.top);
      return { x: tl.x, y: tl.y, w: r.width / viewport.zoom, h: r.height / viewport.zoom };
    });
    const endpoints = Array.from(document.querySelectorAll("path.react-flow__edge-path"))
      .map((el) => el.getAttribute("d") ?? "")
      .flatMap((d) => {
        const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
        return nums.length >= 4
          ? [
              { x: nums[0], y: nums[1] },
              { x: nums[nums.length - 2], y: nums[nums.length - 1] }
            ]
          : [];
      });
    return { boxes, endpoints };
  });
}

test.describe("Boxed node style", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
  });

  test("stays boxed after applying lab settings and reloading", async ({
    page,
    topoViewerPage
  }) => {
    await expect(page.locator(SEL_NODE_BOX)).toHaveCount(0);

    await page.locator(SEL_LAB_SETTINGS_BTN).click();
    const modal = page.locator(SEL_LAB_SETTINGS_MODAL);
    await expect(modal).toBeVisible();
    await modal.locator(SEL_LAB_SETTINGS_TAB_APPEARANCE).click();
    await modal.getByRole("combobox", { name: "Node style", exact: true }).click();
    await page.getByRole("option", { name: "Boxed", exact: true }).click();
    await expect(page.locator(SEL_NODE_BOX)).toHaveCount(2);

    await page.locator(SEL_LAB_SETTINGS_SAVE_BTN).click();
    await expect(modal).not.toBeVisible({ timeout: 3000 });

    await expect
      .poll(async () => {
        const annotations = await topoViewerPage.getAnnotationsFromFile(SIMPLE_FILE);
        return annotations.viewerSettings?.nodeStyle;
      })
      .toBe("boxed");
    await expect(page.locator(SEL_NODE_BOX)).toHaveCount(2);

    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await expect(page.locator(SEL_NODE_BOX)).toHaveCount(2);
    await expect(page.locator(".topology-node-label")).toHaveCount(0);
  });

  test("is a per-lab setting that other labs do not inherit", async ({ page, topoViewerPage }) => {
    await enableBoxedStyle(topoViewerPage);
    await expect(page.locator(SEL_NODE_BOX)).toHaveCount(2);

    await topoViewerPage.gotoFile("network.clab.yml");
    await topoViewerPage.waitForCanvasReady();
    await expect(page.locator(".react-flow__node")).not.toHaveCount(0);
    await expect(page.locator(".topology-node-box, .network-node-box")).toHaveCount(0);

    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await expect(page.locator(SEL_NODE_BOX)).toHaveCount(2);
  });

  test("narrow box spacing is offered only for boxes and shrinks them", async ({
    page,
    topoViewerPage
  }) => {
    await page.locator(SEL_LAB_SETTINGS_BTN).click();
    const modal = page.locator(SEL_LAB_SETTINGS_MODAL);
    await modal.locator(SEL_LAB_SETTINGS_TAB_APPEARANCE).click();
    const spacing = modal.getByRole("combobox", { name: "Box spacing", exact: true });
    await expect(spacing).toHaveCount(0);

    await modal.getByRole("combobox", { name: "Node style", exact: true }).click();
    await page.getByRole("option", { name: "Boxed", exact: true }).click();
    const box = page.locator(SEL_NODE_BOX).first();
    const defaultWidth = (await box.boundingBox())?.width ?? 0;

    await spacing.click();
    await page.getByRole("option", { name: "Narrow", exact: true }).click();
    await expect.poll(async () => (await box.boundingBox())?.width ?? 0).toBeLessThan(defaultWidth);

    await page.locator(SEL_LAB_SETTINGS_SAVE_BTN).click();
    await expect(modal).not.toBeVisible({ timeout: 3000 });
    await expect
      .poll(async () => {
        const annotations = await topoViewerPage.getAnnotationsFromFile(SIMPLE_FILE);
        return annotations.viewerSettings?.nodeBoxSpacing;
      })
      .toBe("narrow");
  });

  test("links attach to the box outline", async ({ page, topoViewerPage }) => {
    // Telemetry-style links end at interface bubbles outside the box, so use default labels.
    await enableBoxedStyle(topoViewerPage, { style: "default", linkLabelMode: "show-all" });
    await expect(page.locator(SEL_NODE_BOX)).toHaveCount(2);

    const { boxes, endpoints } = await captureLinkGeometry(page);
    expect(endpoints.length).toBeGreaterThan(0);
    for (const point of endpoints) {
      const onOutline = boxes.some((box) => {
        const inside =
          point.x >= box.x - 1 &&
          point.x <= box.x + box.w + 1 &&
          point.y >= box.y - 1 &&
          point.y <= box.y + box.h + 1;
        const nearEdge =
          Math.min(
            Math.abs(point.x - box.x),
            Math.abs(point.x - (box.x + box.w)),
            Math.abs(point.y - box.y),
            Math.abs(point.y - (box.y + box.h))
          ) <= 1;
        return inside && nearEdge;
      });
      expect(onOutline, `endpoint ${point.x},${point.y} is on a box outline`).toBe(true);
    }
  });

  test("shortens long names in the middle and shows the full name on hover", async ({
    page,
    topoViewerPage
  }) => {
    await renameNode(topoViewerPage, "srl1", LONG_NAME);
    await enableBoxedStyle(topoViewerPage);

    const longNode = page.locator(`.react-flow__node[data-id="${LONG_NAME}"]`);
    const label = longNode.locator(".topology-node-box-label");
    await expect(label).toContainText("…");
    const text = (await label.textContent()) ?? "";
    const head = text.split("\u2026")[0];
    expect(head.length).toBeGreaterThan(0);
    expect(LONG_NAME.startsWith(head)).toBe(true);
    expect(text.endsWith("eaf-01")).toBe(true);
    expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(longNode.locator(".topology-node")).toHaveAttribute("title", LONG_NAME);

    const shortNode = page.locator('.react-flow__node[data-id="srl2"]');
    await expect(shortNode.locator(".topology-node-box-label")).toHaveText("srl2");
    await expect(shortNode.locator(".topology-node")).not.toHaveAttribute("title", /.*/);
  });
});
