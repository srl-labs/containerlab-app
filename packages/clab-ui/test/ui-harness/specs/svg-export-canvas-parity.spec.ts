/**
 * SVG export ↔ canvas parity.
 *
 * Loads the ai-fabric fixture (telemetry-style labels, 60px node icons,
 * 45% interface bubbles, free-shape/free-text annotations) and asserts the
 * exported SVG places every element exactly where the canvas renders it,
 * in both the icon and the boxed node style.
 */
import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

const FILE = "ai-fabric.clab.yml";

const SEL_NAVBAR_CAPTURE = '[data-testid="navbar-capture"]';
const SEL_SVG_EXPORT_MODAL = '[data-testid="svg-export-modal"]';
const SEL_SVG_EXPORT_BTN = '[data-testid="svg-export-btn"]';
const SEL_LAB_SETTINGS_BTN = '[data-testid="navbar-lab-settings"]';
const SEL_LAB_SETTINGS_MODAL = '[data-testid="lab-settings-modal"]';
const SEL_LAB_SETTINGS_TAB_APPEARANCE = '[data-testid="lab-settings-tab-appearance"]';
const SEL_LAB_SETTINGS_CLOSE_BTN = '[data-testid="lab-settings-close-btn"]';
const SEL_NODE_STYLE_SELECT = '[data-testid="lab-settings-node-style"] [role="combobox"]';

const TOLERANCE = 0.05;

type Rect = { x: number; y: number; w: number; h: number };

interface CanvasGeometry {
  nodes: Record<string, Rect>;
  boxes: Record<string, Rect>;
  boxLabels: Record<string, { cx: number; cy: number }>;
  labels: Array<{ text: string; cx: number; cy: number; w: number }>;
  shapes: Array<{ id: string; x: number; y: number; w: number; h: number }>;
  texts: Array<{ id: string; x: number; y: number }>;
}

async function readDownloadAsString(download: any): Promise<string> {
  const stream = await download.createReadStream();
  const chunks = await stream.toArray();
  return Buffer.concat(chunks).toString("utf-8");
}

/** Capture node icons, endpoint bubbles, and annotations in FLOW coordinates. */
async function captureCanvasGeometry(page: Page): Promise<CanvasGeometry> {
  return page.evaluate(() => {
    const dev = (window as any).__DEV__;
    const viewport = dev?.rfInstance?.getViewport?.() ?? {
      x: 0,
      y: 0,
      zoom: 1
    };
    const cRect = document.querySelector(".react-flow")!.getBoundingClientRect();
    const toFlow = (clientX: number, clientY: number) => ({
      x: (clientX - cRect.left - viewport.x) / viewport.zoom,
      y: (clientY - cRect.top - viewport.y) / viewport.zoom
    });

    const nodes: CanvasGeometry["nodes"] = {};
    for (const el of Array.from(
      document.querySelectorAll(".react-flow__node .topology-node-icon")
    )) {
      const id = el.closest(".react-flow__node")?.getAttribute("data-id") ?? "?";
      const r = el.getBoundingClientRect();
      const tl = toFlow(r.left, r.top);
      nodes[id] = {
        x: tl.x,
        y: tl.y,
        w: r.width / viewport.zoom,
        h: r.height / viewport.zoom
      };
    }

    const boxes: CanvasGeometry["boxes"] = {};
    for (const el of Array.from(
      document.querySelectorAll(
        ".react-flow__node .topology-node-box, .react-flow__node .network-node-box"
      )
    )) {
      const id = el.closest(".react-flow__node")?.getAttribute("data-id") ?? "?";
      const r = el.getBoundingClientRect();
      const tl = toFlow(r.left, r.top);
      boxes[id] = { x: tl.x, y: tl.y, w: r.width / viewport.zoom, h: r.height / viewport.zoom };
    }

    const boxLabels: CanvasGeometry["boxLabels"] = {};
    for (const el of Array.from(
      document.querySelectorAll(".react-flow__node .topology-node-box-label")
    )) {
      const id = el.closest(".react-flow__node")?.getAttribute("data-id") ?? "?";
      const r = el.getBoundingClientRect();
      const c = toFlow(r.left + r.width / 2, r.top + r.height / 2);
      boxLabels[id] = { cx: c.x, cy: c.y };
    }

    const labels: CanvasGeometry["labels"] = [];
    for (const el of Array.from(document.querySelectorAll(".topology-edge-label"))) {
      const r = el.getBoundingClientRect();
      const c = toFlow(r.left + r.width / 2, r.top + r.height / 2);
      labels.push({
        text: (el.textContent ?? "").trim(),
        cx: c.x,
        cy: c.y,
        w: r.width / viewport.zoom
      });
    }

    const shapes: CanvasGeometry["shapes"] = [];
    for (const el of Array.from(
      document.querySelectorAll(".free-shape-rectangle, .free-shape-circle")
    )) {
      const id = el.closest(".react-flow__node")?.getAttribute("data-id") ?? "?";
      const r = el.getBoundingClientRect();
      const tl = toFlow(r.left, r.top);
      shapes.push({
        id,
        x: tl.x,
        y: tl.y,
        w: r.width / viewport.zoom,
        h: r.height / viewport.zoom
      });
    }

    const texts: CanvasGeometry["texts"] = [];
    for (const el of Array.from(document.querySelectorAll(".react-flow__node"))) {
      if (!el.querySelector(".free-text-content, .free-text-node")) continue;
      const r = el.getBoundingClientRect();
      const tl = toFlow(r.left, r.top);
      texts.push({ id: el.getAttribute("data-id") ?? "?", x: tl.x, y: tl.y });
    }

    return { nodes, boxes, boxLabels, labels, shapes, texts };
  });
}

function findAll(re: RegExp, svg: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(svg)) !== null) matches.push(match);
  return matches;
}

async function exportSvg(page: Page): Promise<string> {
  await page.locator(SEL_NAVBAR_CAPTURE).click();
  await page.waitForTimeout(300);
  await expect(page.locator(SEL_SVG_EXPORT_MODAL)).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.locator(SEL_SVG_EXPORT_BTN).click();
  return readDownloadAsString(await downloadPromise);
}

/** Every canvas endpoint label has an exported circle at the same spot with the same diameter. */
function expectBubblesMatch(svg: string, canvas: CanvasGeometry): void {
  // Icon artwork may draw circles of its own.
  const withoutIcons = svg.replace(/<svg class="export-node-icon"[\s\S]*?<\/svg>/g, "");
  const circles = findAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g, withoutIcons).map(
    (m) => ({ cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3]) })
  );
  expect(circles.length).toBe(canvas.labels.length);
  for (const label of canvas.labels) {
    const nearest = circles.reduce(
      (best, c) => {
        const d = Math.hypot(c.cx - label.cx, c.cy - label.cy);
        return d < best.d ? { d, c } : best;
      },
      { d: Number.POSITIVE_INFINITY, c: circles[0] }
    );
    expect(nearest.d, `bubble "${label.text}" position`).toBeLessThan(TOLERANCE);
    expect(Math.abs(nearest.c.r * 2 - label.w), `bubble "${label.text}" size`).toBeLessThan(
      TOLERANCE
    );
  }
}

test.describe("SVG export canvas parity", () => {
  test("exported SVG matches canvas geometry 1:1", async ({ page, topoViewerPage }) => {
    await topoViewerPage.gotoFile(FILE);
    await topoViewerPage.waitForCanvasReady();
    await page.waitForTimeout(500);

    const canvas = await captureCanvasGeometry(page);
    expect(Object.keys(canvas.nodes).length).toBeGreaterThan(0);
    expect(canvas.labels.length).toBeGreaterThan(0);
    expect(canvas.shapes.length).toBeGreaterThan(0);

    const svg = await exportSvg(page);

    // Node icons: same position and size (flow coordinates) as the canvas
    const nodeRects = findAll(
      /<g class="export-node[^"]*" data-id="([^"]+)">.*?<(?:svg|image) class="export-node-icon" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/gs,
      svg
    );
    const exportNodes = new Map(
      nodeRects.map((m) => [m[1], m.slice(2, 6).map(Number) as number[]])
    );
    for (const [id, node] of Object.entries(canvas.nodes)) {
      const rect = exportNodes.get(id);
      expect(rect, `node ${id} missing from export`).toBeDefined();
      const [x, y, w, h] = rect!;
      expect(Math.abs(x - node.x), `node ${id} x`).toBeLessThan(TOLERANCE);
      expect(Math.abs(y - node.y), `node ${id} y`).toBeLessThan(TOLERANCE);
      expect(Math.abs(w - node.w), `node ${id} width`).toBeLessThan(TOLERANCE);
      expect(Math.abs(h - node.h), `node ${id} height`).toBeLessThan(TOLERANCE);
    }

    // Interface bubbles
    expect(svg).not.toContain("export-node-box");
    expectBubblesMatch(svg, canvas);

    // Shape annotations: top-left position and size match the canvas
    const shapeRects = findAll(
      /<g class="annotation-shape" data-id="([^"]+)"[^>]*>\s*<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g,
      svg
    );
    const exportShapes = new Map(
      shapeRects.map((m) => [m[1], m.slice(2, 6).map(Number) as number[]])
    );
    for (const shape of canvas.shapes) {
      const rect = exportShapes.get(shape.id);
      expect(rect, `shape ${shape.id} missing from export`).toBeDefined();
      const [x, y, w, h] = rect!;
      expect(Math.abs(x - shape.x), `shape ${shape.id} x`).toBeLessThan(TOLERANCE);
      expect(Math.abs(y - shape.y), `shape ${shape.id} y`).toBeLessThan(TOLERANCE);
      expect(Math.abs(w - shape.w), `shape ${shape.id} width`).toBeLessThan(TOLERANCE);
      expect(Math.abs(h - shape.h), `shape ${shape.id} height`).toBeLessThan(TOLERANCE);
    }

    // Free text annotations: top-left position matches the canvas
    const textRects = findAll(
      /<g class="annotation-text" data-id="([^"]+)"[^>]*>\s*<foreignObject x="([-\d.]+)" y="([-\d.]+)"/g,
      svg
    );
    const exportTexts = new Map(
      textRects.map((m) => [m[1], m.slice(2, 4).map(Number) as number[]])
    );
    for (const text of canvas.texts) {
      const pos = exportTexts.get(text.id);
      expect(pos, `text ${text.id} missing from export`).toBeDefined();
      expect(Math.abs(pos![0] - text.x), `text ${text.id} x`).toBeLessThan(TOLERANCE);
      expect(Math.abs(pos![1] - text.y), `text ${text.id} y`).toBeLessThan(TOLERANCE);
    }

    // Negative-zIndex shapes render BEHIND the graph layer (like the canvas)
    const firstShapesLayer = svg.indexOf("annotation-shapes-layer");
    const graphLayer = svg.indexOf("export-graph-layer");
    expect(firstShapesLayer).toBeGreaterThan(-1);
    expect(firstShapesLayer).toBeLessThan(graphLayer);
  });

  test("boxed node style matches canvas boxes, names and link anchors", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.gotoFile(FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();

    await page.locator(SEL_LAB_SETTINGS_BTN).click();
    const settings = page.locator(SEL_LAB_SETTINGS_MODAL);
    await expect(settings).toBeVisible();
    await settings.locator(SEL_LAB_SETTINGS_TAB_APPEARANCE).click();
    await settings.locator(SEL_NODE_STYLE_SELECT).click();
    await page.getByRole("option", { name: "Boxed", exact: true }).click();
    await settings.locator(SEL_LAB_SETTINGS_CLOSE_BTN).click();
    await expect(settings).toBeHidden();
    await expect(page.locator(".topology-node-box").first()).toBeVisible();
    await page.waitForTimeout(500);

    const canvas = await captureCanvasGeometry(page);
    expect(Object.keys(canvas.boxes).length).toBe(Object.keys(canvas.nodes).length);
    expect(Object.keys(canvas.boxLabels).length).toBe(Object.keys(canvas.boxes).length);

    const svg = await exportSvg(page);

    // Boxes: the exported stroke is inset by half the 1px border
    const boxRects = findAll(
      /<g class="export-node[^"]*" data-id="([^"]+)"><rect class="export-node-box" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g,
      svg
    );
    const exportBoxes = new Map(boxRects.map((m) => [m[1], m.slice(2, 6).map(Number)]));
    for (const [id, box] of Object.entries(canvas.boxes)) {
      const rect = exportBoxes.get(id);
      expect(rect, `box ${id} missing from export`).toBeDefined();
      const [x, y, w, h] = rect!;
      expect(Math.abs(x - 0.5 - box.x), `box ${id} x`).toBeLessThan(TOLERANCE);
      expect(Math.abs(y - 0.5 - box.y), `box ${id} y`).toBeLessThan(TOLERANCE);
      expect(Math.abs(w + 1 - box.w), `box ${id} width`).toBeLessThan(TOLERANCE);
      expect(Math.abs(h + 1 - box.h), `box ${id} height`).toBeLessThan(TOLERANCE);
    }

    // Names: one row centered where the canvas renders it, no pill
    const boxLabels = findAll(
      /<g class="export-node[^"]*" data-id="([^"]+)">.*?<text class="export-node-box-label" x="([-\d.]+)" y="([-\d.]+)"/gs,
      svg
    );
    const exportLabels = new Map(boxLabels.map((m) => [m[1], [Number(m[2]), Number(m[3])]]));
    for (const [id, label] of Object.entries(canvas.boxLabels)) {
      const pos = exportLabels.get(id);
      expect(pos, `name ${id} missing from export`).toBeDefined();
      expect(Math.abs(pos![0] - label.cx), `name ${id} x`).toBeLessThan(TOLERANCE);
      expect(Math.abs(pos![1] - label.cy), `name ${id} y`).toBeLessThan(TOLERANCE);
    }
    expect(svg).not.toContain("url(#text-shadow)");

    // Interface bubbles sit on the box outline like on the canvas
    expectBubblesMatch(svg, canvas);
  });

  // Regression: the traffic-label placement search used to freeze the webview
  // on this 148-link topology (billions of collision checks). The bundle must
  // complete without blocking the page for more than a few seconds.
  test("grafana bundle with legend completes on a large topology", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.gotoFile(FILE);
    await topoViewerPage.waitForCanvasReady();

    await page.locator(SEL_NAVBAR_CAPTURE).click();
    await page.waitForTimeout(300);
    const modal = page.locator(SEL_SVG_EXPORT_MODAL);
    await expect(modal).toBeVisible();

    await modal.getByRole("checkbox", { name: "Grafana bundle" }).check();
    await page.locator('[data-testid="svg-export-grafana-advanced-btn"]').click();
    const settings = page.locator('[data-testid="svg-export-grafana-settings-modal"]');
    await expect(settings).toBeVisible();
    await settings.getByRole("checkbox", { name: "Add traffic legend (top-left)" }).check();
    await settings.getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      (window as any).__CLAB_UI_HARNESS_MESSAGES__ = [];
    });

    const startedAt = Date.now();
    await page.locator(SEL_SVG_EXPORT_BTN).click();

    await page.waitForFunction(
      () => {
        const messages = ((window as any).__CLAB_UI_HARNESS_MESSAGES__ ?? []) as unknown[];
        return messages.some(
          (m: any) => m?.command === "export-svg-grafana-bundle" && typeof m.svgContent === "string"
        );
      },
      undefined,
      { timeout: 30000 }
    );

    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs, "grafana bundle export duration").toBeLessThan(15000);

    const svgContent = await page.evaluate(() => {
      const messages = ((window as any).__CLAB_UI_HARNESS_MESSAGES__ ?? []) as any[];
      return messages.find((m) => m?.command === "export-svg-grafana-bundle")?.svgContent as string;
    });
    expect(svgContent).toContain("grafana-traffic-legend");
    expect(svgContent).toContain("grafana-traffic-half");
  });
});
