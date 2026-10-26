import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";
import { modelToPageCoords } from "../helpers/react-flow-helpers";

const TOPOLOGY_FILE = "empty.clab.yml";
const GAP_MARKER = '[data-testid="helper-gap-marker"]';

type Box = { x: number; y: number; width: number; height: number };
type FlowNode = {
  id: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
};

async function getNodeBox(page: Page, nodeId: string): Promise<Box> {
  return await page.evaluate((id) => {
    const nodes: FlowNode[] = (window as any).__DEV__?.rfInstance?.getNodes() ?? [];
    const node = nodes.find((candidate) => candidate.id === id);
    if (node === undefined) throw new Error(`Node ${id} not found`);
    return {
      x: node.position.x,
      y: node.position.y,
      width: node.measured?.width ?? 0,
      height: node.measured?.height ?? 0
    };
  }, nodeId);
}

/** Press on a node's center and move it so its position would land on `target`. */
async function startDragTo(
  page: Page,
  nodeId: string,
  target: { x: number; y: number }
): Promise<void> {
  const box = await getNodeBox(page, nodeId);
  const from = await modelToPageCoords(page, box.x + box.width / 2, box.y + box.height / 2);
  const to = await modelToPageCoords(page, target.x + box.width / 2, target.y + box.height / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // React Flow starts the drag on the first move past its threshold and
  // measures from there, so that first nudge does not move the node.
  const nudge = 3;
  await page.mouse.move(from.x + nudge, from.y);
  const steps = 12;
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(
      from.x + nudge + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps
    );
  }
}

test.describe("Helper line snapping", () => {
  test.beforeEach(async ({ page, topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(TOPOLOGY_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();

    // Two nodes with an off-grid gap, and a third to drag into their row.
    await topoViewerPage.createNode("n1", { x: 100, y: 200 });
    await topoViewerPage.createNode("n2", { x: 305, y: 200 });
    await topoViewerPage.createNode("n3", { x: 560, y: 420 });
    // Keep the nodes left of the palette, which opens on an empty lab.
    await topoViewerPage.setZoom(1);
    await topoViewerPage.setPan(40, 0);
    await page.waitForTimeout(200);
    await expect.poll(async () => (await getNodeBox(page, "n3")).width).toBeGreaterThan(0);
  });

  test("repeats the row's gap while dragging and keeps it on drop", async ({
    page,
    topoViewerPage
  }) => {
    const first = await getNodeBox(page, "n1");
    const second = await getNodeBox(page, "n2");
    const gap = second.x - (first.x + first.width);
    const expected = { x: second.x + second.width + gap, y: second.y };
    // An off-grid target shows that the guide, not the 20px grid, places the node.
    expect(expected.x % 20).not.toBe(0);

    await startDragTo(page, "n3", { x: expected.x + 3, y: expected.y + 3 });

    await expect.poll(() => topoViewerPage.getNodePosition("n3")).toEqual(expected);
    await expect(page.locator(GAP_MARKER)).toHaveCount(2);

    await page.mouse.up();
    await expect(page.locator(GAP_MARKER)).toHaveCount(0);
    await expect.poll(() => topoViewerPage.getNodePosition("n3")).toEqual(expected);
    await expect
      .poll(async () => {
        const annotations = await topoViewerPage.getAnnotationsFromFile(TOPOLOGY_FILE);
        return annotations.nodeAnnotations?.find((entry) => entry.id === "n3")?.position;
      })
      .toEqual(expected);
  });

  test("snaps to the grid on drop when no guide holds the node", async ({
    page,
    topoViewerPage
  }) => {
    await startDragTo(page, "n3", { x: 447, y: 553 });
    await expect(page.locator(GAP_MARKER)).toHaveCount(0);
    await page.mouse.up();

    await expect.poll(() => topoViewerPage.getNodePosition("n3")).toEqual({ x: 440, y: 560 });
  });
});
