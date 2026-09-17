/**
 * SVG export ↔ canvas parity.
 *
 * Loads the ai-fabric fixture (telemetry-style labels, 60px node icons,
 * 45% interface bubbles, free-shape/free-text annotations) and asserts the
 * exported SVG places every element exactly where the canvas renders it.
 */
import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

const FILE = "ai-fabric.clab.yml";

const SEL_NAVBAR_CAPTURE = '[data-testid="navbar-capture"]';
const SEL_SVG_EXPORT_MODAL = '[data-testid="svg-export-modal"]';
const SEL_SVG_EXPORT_BTN = '[data-testid="svg-export-btn"]';

interface CanvasGeometry {
  nodes: Record<string, { x: number; y: number; w: number; h: number }>;
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

    return { nodes, labels, shapes, texts };
  });
}

function findAll(re: RegExp, svg: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(svg)) !== null) matches.push(match);
  return matches;
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

    await page.locator(SEL_NAVBAR_CAPTURE).click();
    await page.waitForTimeout(300);
    await expect(page.locator(SEL_SVG_EXPORT_MODAL)).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.locator(SEL_SVG_EXPORT_BTN).click();
    const svg = await readDownloadAsString(await downloadPromise);

    const tolerance = 0.05;

    // Node icons: same position and size (flow coordinates) as the canvas
    const nodeRects = findAll(
      /<g class="export-node[^"]*" data-id="([^"]+)">.*?<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/gs,
      svg
    );
    const exportNodes = new Map(
      nodeRects.map((m) => [m[1], m.slice(2, 6).map(Number) as number[]])
    );
    for (const [id, node] of Object.entries(canvas.nodes)) {
      const rect = exportNodes.get(id);
      expect(rect, `node ${id} missing from export`).toBeDefined();
      const [x, y, w, h] = rect!;
      expect(Math.abs(x - node.x), `node ${id} x`).toBeLessThan(tolerance);
      expect(Math.abs(y - node.y), `node ${id} y`).toBeLessThan(tolerance);
      expect(Math.abs(w - node.w), `node ${id} width`).toBeLessThan(tolerance);
      expect(Math.abs(h - node.h), `node ${id} height`).toBeLessThan(tolerance);
    }

    // Interface bubbles: every canvas endpoint label has an exported circle
    // at the same spot with the same diameter
    const circles = findAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g, svg).map(
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
      expect(nearest.d, `bubble "${label.text}" position`).toBeLessThan(tolerance);
      expect(Math.abs(nearest.c.r * 2 - label.w), `bubble "${label.text}" size`).toBeLessThan(
        tolerance
      );
    }

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
      expect(Math.abs(x - shape.x), `shape ${shape.id} x`).toBeLessThan(tolerance);
      expect(Math.abs(y - shape.y), `shape ${shape.id} y`).toBeLessThan(tolerance);
      expect(Math.abs(w - shape.w), `shape ${shape.id} width`).toBeLessThan(tolerance);
      expect(Math.abs(h - shape.h), `shape ${shape.id} height`).toBeLessThan(tolerance);
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
      expect(Math.abs(pos![0] - text.x), `text ${text.id} x`).toBeLessThan(tolerance);
      expect(Math.abs(pos![1] - text.y), `text ${text.id} y`).toBeLessThan(tolerance);
    }

    // Negative-zIndex shapes render BEHIND the graph layer (like the canvas)
    const firstShapesLayer = svg.indexOf("annotation-shapes-layer");
    const graphLayer = svg.indexOf("export-graph-layer");
    expect(firstShapesLayer).toBeGreaterThan(-1);
    expect(firstShapesLayer).toBeLessThan(graphLayer);
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
