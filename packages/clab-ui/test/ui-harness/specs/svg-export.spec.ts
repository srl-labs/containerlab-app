import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

const SIMPLE_FILE = "simple.clab.yml";
const DATACENTER_FILE = "datacenter.clab.yml";

// Test selectors for the new MUI Dialog-based SVG export
const SEL_NAVBAR_CAPTURE = '[data-testid="navbar-capture"]';
const SEL_SVG_EXPORT_MODAL = '[data-testid="svg-export-modal"]';
const SEL_SVG_EXPORT_BTN = '[data-testid="svg-export-btn"]';
const SEL_SVG_EXPORT_FILENAME = '[data-testid="svg-export-filename"]';

// Annotation layer identifiers in exported SVG
const LAYER_GROUPS = "annotation-groups-layer";
const LAYER_SHAPES = "annotation-shapes-layer";
const LAYER_TEXT = "annotation-text-layer";

async function readDownloadAsString(download: any): Promise<string> {
  const stream = await download.createReadStream();
  const chunks = await stream.toArray();
  return Buffer.concat(chunks).toString("utf-8");
}

async function waitForGrafanaBundleSvg(page: Page): Promise<string> {
  const handle = await page.waitForFunction(() => {
    const messages = ((window as any).__CLAB_UI_HARNESS_MESSAGES__ ?? []) as unknown[];
    const message = messages.find((candidate) => {
      if (typeof candidate !== "object" || candidate === null) return false;
      const record = candidate as Record<string, unknown>;
      return (
        record.command === "export-svg-grafana-bundle" && typeof record.svgContent === "string"
      );
    }) as { svgContent?: string } | undefined;
    return message?.svgContent ?? null;
  });
  return (await handle.jsonValue()) as string;
}

async function inspectSvgNodeViewportFit(page: Page, svgString: string): Promise<{
  hasGraphLayer: boolean;
  nodeCount: number;
  violations: string[];
}> {
  return page.evaluate((svgContent) => {
    const doc = new DOMParser().parseFromString(svgContent, "image/svg+xml");
    const svgEl = doc.documentElement;
    const viewBox = (svgEl.getAttribute("viewBox") ?? "0 0 0 0")
      .split(/[,\s]+/)
      .map((part) => Number.parseFloat(part));
    const [viewX, viewY, viewWidth, viewHeight] = viewBox;
    const graphLayer = doc.querySelector("g.export-graph-layer[transform]");

    function parseTransform(transform: string): { tx: number; ty: number; scale: number } {
      let tx = 0;
      let ty = 0;
      const translateRegex = /translate\(\s*([^)]+?)\s*\)/gi;
      let translateMatch: RegExpExecArray | null;
      while ((translateMatch = translateRegex.exec(transform)) !== null) {
        const args = translateMatch[1]
          .split(/[,\s]+/)
          .map((part) => Number.parseFloat(part))
          .filter((value) => Number.isFinite(value));
        tx += args[0] ?? 0;
        ty += args[1] ?? 0;
      }

      const scaleMatch = /scale\(\s*([^)]+?)\s*\)/i.exec(transform);
      const scale = scaleMatch === null ? 1 : Number.parseFloat(scaleMatch[1]);
      return { tx, ty, scale: Number.isFinite(scale) && scale !== 0 ? scale : 1 };
    }

    if (!(graphLayer instanceof Element)) {
      return { hasGraphLayer: false, nodeCount: 0, violations: ["missing graph layer"] };
    }

    const graphTransform = parseTransform(graphLayer.getAttribute("transform") ?? "");
    const nodeRects = Array.from(
      doc.querySelectorAll("g.export-node > g > rect[x][y][width][height]")
    );
    const tolerance = 1;
    const violations = nodeRects
      .map((rect) => {
        const nodeId = rect.closest("g.export-node")?.getAttribute("data-id") ?? "unknown";
        const x =
          Number.parseFloat(rect.getAttribute("x") ?? "0") * graphTransform.scale +
          graphTransform.tx;
        const y =
          Number.parseFloat(rect.getAttribute("y") ?? "0") * graphTransform.scale +
          graphTransform.ty;
        const width = Number.parseFloat(rect.getAttribute("width") ?? "0") * graphTransform.scale;
        const height = Number.parseFloat(rect.getAttribute("height") ?? "0") * graphTransform.scale;
        const outside =
          x < viewX - tolerance ||
          y < viewY - tolerance ||
          x + width > viewX + viewWidth + tolerance ||
          y + height > viewY + viewHeight + tolerance;
        return outside ? nodeId : null;
      })
      .filter((nodeId): nodeId is string => nodeId !== null);

    return { hasGraphLayer: true, nodeCount: nodeRects.length, violations };
  }, svgString);
}

async function inspectGrafanaTrafficPathStrokes(page: Page, svgString: string): Promise<{
  pathCount: number;
  invalidPaths: Array<{ id: string | null; stroke: string | null; styleStroke: string }>;
}> {
  return page.evaluate((svgContent) => {
    const doc = new DOMParser().parseFromString(svgContent, "image/svg+xml");
    const paths = Array.from(
      doc.querySelectorAll("g.grafana-traffic-half > path:not(.grafana-traffic-hitbox)")
    );
    const invalidPaths = paths
      .map((path) => ({
        id: path.closest("g.grafana-traffic-half")?.getAttribute("data-cell-id") ?? null,
        stroke: path.getAttribute("stroke"),
        styleStroke: (path as SVGPathElement).style.stroke
      }))
      .filter((path) => path.stroke !== "gray" || path.styleStroke.length > 0);

    return { pathCount: paths.length, invalidPaths };
  }, svgString);
}

/**
 * SVG Export Modal E2E Tests (MUI Dialog version)
 *
 * In the new MUI design, SVG export is shown in a Dialog with
 * quality settings, background options, annotations toggle,
 * filename input, and export button.
 */
test.describe("SVG Export Modal", () => {
  test("opens SVG export modal and shows all controls", async ({ page, topoViewerPage }) => {
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();

    await page.locator(SEL_NAVBAR_CAPTURE).click();
    await page.waitForTimeout(300);

    const modal = page.locator(SEL_SVG_EXPORT_MODAL);
    await expect(modal).toBeVisible();

    // Title
    await expect(modal.locator("h2")).toHaveText("Export SVG");

    // Background options
    await expect(modal.getByText("Transparent", { exact: true })).toBeVisible();
    await expect(modal.getByText("Custom", { exact: true })).toBeVisible();

    // Filename input
    await expect(page.locator(SEL_SVG_EXPORT_FILENAME)).toBeVisible();

    // Export button
    await expect(page.locator(SEL_SVG_EXPORT_BTN)).toBeVisible();
  });

  test("exports SVG with default filename", async ({ page, topoViewerPage }) => {
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();

    await page.locator(SEL_NAVBAR_CAPTURE).click();
    await page.waitForTimeout(300);

    // Set up download listener
    const downloadPromise = page.waitForEvent("download");

    await page.locator(SEL_SVG_EXPORT_BTN).click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("simple.svg");

    // Read and verify SVG content
    const svgString = await readDownloadAsString(download);

    expect(svgString).toContain("<svg");
    expect(svgString).toContain("</svg>");
  });

  test("exports SVG with custom background color", async ({ page, topoViewerPage }) => {
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();

    await page.locator(SEL_NAVBAR_CAPTURE).click();
    await page.waitForTimeout(300);

    const modal = page.locator(SEL_SVG_EXPORT_MODAL);
    await expect(modal).toBeVisible();

    await modal.getByRole("radio", { name: "Custom" }).check();
    const colorInput = modal.getByRole("textbox", { name: "Color" });
    await colorInput.fill("ffffff");
    await page.waitForTimeout(100);

    const downloadPromise = page.waitForEvent("download");
    await page.locator(SEL_SVG_EXPORT_BTN).click();
    const download = await downloadPromise;

    const svgString = await readDownloadAsString(download);
    expect(svgString).toContain("<svg");
    expect(svgString).toContain('fill="#ffffff"');
  });

  test("exports SVG with annotations from datacenter topology", async ({ page, topoViewerPage }) => {
    await topoViewerPage.gotoFile(DATACENTER_FILE);
    await topoViewerPage.waitForCanvasReady();

    // Ensure the topology actually has annotations on disk
    const annotations = await topoViewerPage.getAnnotationsFromFile(DATACENTER_FILE);
    const total =
      (annotations.freeTextAnnotations?.length ?? 0) +
      (annotations.freeShapeAnnotations?.length ?? 0) +
      (annotations.groupStyleAnnotations?.length ?? 0);
    expect(total).toBeGreaterThan(0);

    await page.locator(SEL_NAVBAR_CAPTURE).click();
    await page.waitForTimeout(300);

    const modal = page.locator(SEL_SVG_EXPORT_MODAL);
    await expect(modal).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.locator(SEL_SVG_EXPORT_BTN).click();
    const download = await downloadPromise;

    const svgString = await readDownloadAsString(download);

    // Verify annotation layers exist
    expect(svgString).toContain(LAYER_GROUPS);
    expect(svgString).toContain(LAYER_SHAPES);
    expect(svgString).toContain(LAYER_TEXT);

    // Verify annotation content made it into the SVG for existing annotation kinds.
    const expectedAnnotationMarkers = [
      [(annotations.groupStyleAnnotations?.length ?? 0) > 0, "annotation-group"],
      [(annotations.freeShapeAnnotations?.length ?? 0) > 0, "annotation-shape"],
      [(annotations.freeTextAnnotations?.length ?? 0) > 0, "foreignObject"],
    ] as const;

    expectedAnnotationMarkers
      .filter(([shouldExist]) => shouldExist)
      .forEach(([, marker]) => expect(svgString).toContain(marker));
  });

  test("exports SVG with custom filename", async ({ page, topoViewerPage }) => {
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();

    await page.locator(SEL_NAVBAR_CAPTURE).click();
    await page.waitForTimeout(300);

    // Change filename
    const filenameInput = page.locator(SEL_SVG_EXPORT_FILENAME).locator("input");
    await filenameInput.clear();
    await filenameInput.fill("my-topology");

    const downloadPromise = page.waitForEvent("download");
    await page.locator(SEL_SVG_EXPORT_BTN).click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("my-topology.svg");
  });

  test("annotation layer transforms match React Flow transform", async ({ page, topoViewerPage }) => {
    await topoViewerPage.gotoFile(DATACENTER_FILE);
    await topoViewerPage.waitForCanvasReady();

    await page.locator(SEL_NAVBAR_CAPTURE).click();
    await page.waitForTimeout(300);

    const modal = page.locator(SEL_SVG_EXPORT_MODAL);
    await expect(modal).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.locator(SEL_SVG_EXPORT_BTN).click();
    const download = await downloadPromise;

    const svgString = await readDownloadAsString(download);

    // Extract the annotation layer transforms.
    const groupsLayerMatch = new RegExp(`${LAYER_GROUPS}[^>]*transform="([^"]+)"`).exec(svgString);
    const textLayerMatch = new RegExp(`${LAYER_TEXT}[^>]*transform="([^"]+)"`).exec(svgString);

    expect(groupsLayerMatch).not.toBeNull();
    expect(textLayerMatch).not.toBeNull();
    expect(groupsLayerMatch![1]).toBe(textLayerMatch![1]);
    expect(groupsLayerMatch![1]).toContain("translate(");
    expect(groupsLayerMatch![1]).toContain("scale(");

    // Sanity: exported SVG still contains expected annotation layers.
    expect(svgString).toContain(LAYER_GROUPS);
    expect(svgString).toContain(LAYER_TEXT);
  });

  test("Grafana bundle trim keeps connected nodes inside the SVG viewBox", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.gotoFile(DATACENTER_FILE);
    await topoViewerPage.waitForCanvasReady();

    await page.locator(SEL_NAVBAR_CAPTURE).click();
    await page.waitForTimeout(300);

    const modal = page.locator(SEL_SVG_EXPORT_MODAL);
    await expect(modal).toBeVisible();
    await modal.getByRole("checkbox", { name: "Grafana bundle" }).check();
    await page.evaluate(() => {
      (window as any).__CLAB_UI_HARNESS_MESSAGES__ = [];
    });

    await page.locator(SEL_SVG_EXPORT_BTN).click();

    const svgString = await waitForGrafanaBundleSvg(page);
    const fit = await inspectSvgNodeViewportFit(page, svgString);

    expect(fit.hasGraphLayer).toBe(true);
    expect(fit.nodeCount).toBeGreaterThan(0);
    expect(fit.violations).toEqual([]);
  });

  test("Grafana traffic paths use gray as their no-data baseline stroke", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.gotoFile(DATACENTER_FILE);
    await topoViewerPage.waitForCanvasReady();

    await page.locator(SEL_NAVBAR_CAPTURE).click();
    await page.waitForTimeout(300);

    const modal = page.locator(SEL_SVG_EXPORT_MODAL);
    await expect(modal).toBeVisible();
    await modal.getByRole("checkbox", { name: "Grafana bundle" }).check();
    await page.evaluate(() => {
      (window as any).__CLAB_UI_HARNESS_MESSAGES__ = [];
    });

    await page.locator(SEL_SVG_EXPORT_BTN).click();

    const svgString = await waitForGrafanaBundleSvg(page);
    const trafficPaths = await inspectGrafanaTrafficPathStrokes(page, svgString);

    expect(trafficPaths.pathCount).toBeGreaterThan(0);
    expect(trafficPaths.invalidPaths).toEqual([]);
  });

  test("modal closes with Escape key", async ({ page, topoViewerPage }) => {
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();

    await page.locator(SEL_NAVBAR_CAPTURE).click();
    await page.waitForTimeout(300);

    const modal = page.locator(SEL_SVG_EXPORT_MODAL);
    await expect(modal).toBeVisible();

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    await expect(modal).not.toBeVisible();
  });
});
