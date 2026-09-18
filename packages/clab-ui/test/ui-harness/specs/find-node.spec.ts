import { test, expect } from "../fixtures/topoviewer";

const SEL_FIND_NODE = '[data-testid="navbar-find-node"]';
const SEL_FIND_NODE_INPUT = '[data-testid="find-node-input"]';

test.describe("Find Node", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.gotoFile("simple.clab.yml");
    await topoViewerPage.waitForCanvasReady();
  });

  test("navbar has a visible filter field", async ({ page }) => {
    const input = page.locator(SEL_FIND_NODE_INPUT);
    await expect(input).toBeVisible();
    const nativeInput = input.locator("input");
    await expect(nativeInput).toHaveAttribute("placeholder", "Filter");
  });

  test("filter finds matching nodes", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    expect(nodeIds.length).toBeGreaterThan(0);

    const input = page.locator(SEL_FIND_NODE_INPUT).locator("input");
    await input.fill(nodeIds[0].substring(0, 3));

    await expect(page.locator(SEL_FIND_NODE)).toHaveAttribute("data-match-count", /Found \d+ node/);
  });

  test('filter with no results shows "No nodes found"', async ({ page }) => {
    const input = page.locator(SEL_FIND_NODE_INPUT).locator("input");
    await input.fill("xyznonexistent123");

    await expect(page.locator(SEL_FIND_NODE)).toHaveAttribute("data-match-count", "No nodes found");
  });

  test("wildcard filter finds all nodes", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    expect(nodeIds.length).toBeGreaterThan(0);

    const input = page.locator(SEL_FIND_NODE_INPUT).locator("input");
    await input.fill("*");

    await expect(page.locator(SEL_FIND_NODE)).toHaveAttribute("data-match-count", /Found \d+ node/);
  });

  test("prefix filter with + works", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    expect(nodeIds.length).toBeGreaterThan(0);

    const input = page.locator(SEL_FIND_NODE_INPUT).locator("input");
    await input.fill(`+${nodeIds[0].substring(0, 2)}`);

    await expect(page.locator(SEL_FIND_NODE)).toHaveAttribute("data-match-count", /Found \d+ node/);
  });

  test("filter dims nodes that do not match", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    expect(nodeIds.length).toBeGreaterThan(1);

    const input = page.locator(SEL_FIND_NODE_INPUT).locator("input");
    await input.fill(nodeIds[0]);

    const match = page.locator(`.react-flow__node[data-id="${nodeIds[0]}"]`);
    const other = page.locator(`.react-flow__node[data-id="${nodeIds[1]}"]`);

    await expect
      .poll(async () => match.evaluate((el) => getComputedStyle(el).opacity))
      .toBe("1");
    await expect
      .poll(async () => other.evaluate((el) => getComputedStyle(el).opacity))
      .toBe("0.22");
  });

  test("filter for specific node shows exact count", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();

    await topoViewerPage.clearSelection();

    const input = page.locator(SEL_FIND_NODE_INPUT).locator("input");
    await input.fill(nodeIds[0]);

    await expect(page.locator(SEL_FIND_NODE)).toHaveAttribute("data-match-count", "Found 1 node");
  });

  test("empty filter does not show match count", async ({ page }) => {
    const input = page.locator(SEL_FIND_NODE_INPUT).locator("input");
    await input.fill("abc");
    await input.fill("");

    await expect(page.locator(SEL_FIND_NODE)).not.toHaveAttribute("data-match-count");
  });
});
