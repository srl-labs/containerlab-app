import { test, expect, type Page } from "@playwright/test";

async function openOverview(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/overview.html?${query}`);
  await expect(page.getByTestId("labs-overview")).toBeVisible();
  return errors;
}

function activeWatches(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __OVERVIEW__: { activeWatches: () => string[] } }).__OVERVIEW__.activeWatches());
}

/**
 * Labs overview cards draw a miniature of the canvas, and running labs show
 * their CPU and memory, streamed only while their cards are visible.
 */
test.describe("Labs overview usage", () => {
  test("thumbnails draw node icons, names and groups like the canvas", async ({ page }) => {
    const errors = await openOverview(page, "stats=none");
    const spineLeaf = page.getByRole("article", { name: "spine-leaf" }).getByTestId("lab-card-thumbnail");
    await expect(spineLeaf).toHaveAttribute("data-loaded", "true");
    await expect(spineLeaf.locator("g[data-node] image")).toHaveCount(6);
    await expect(spineLeaf.locator("g[data-node] text")).toHaveText(["spine1", "spine2", "leaf1", "leaf2", "client1", "client2"]);
    await expect(spineLeaf.locator("line[data-link]")).toHaveCount(6);

    const datacenter = page.getByRole("article", { name: "datacenter" }).getByTestId("lab-card-thumbnail");
    await expect(datacenter).toHaveAttribute("data-loaded", "true");
    await expect(datacenter.locator("[data-group]").first()).toBeVisible();
    // Many small nodes are squares without names.
    await expect(datacenter.locator("rect[data-node]")).not.toHaveCount(0);
    await expect(datacenter.locator("g[data-node] text")).toHaveCount(0);

    // Without a usage feed no card shows usage.
    await expect(page.getByTestId("lab-card-usage")).toHaveCount(0);
    expect(await activeWatches(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("running labs show live CPU and memory, and per-node load in the thumbnail", async ({ page }) => {
    const errors = await openOverview(page);
    const card = page.getByRole("article", { name: "spine-leaf" });
    const usage = card.getByTestId("lab-card-usage");
    await expect(usage).toHaveAttribute("data-status", "live");
    await expect(usage.getByTestId("lab-card-usage-cpu-value")).toHaveText(/^\d+(\.\d)? %$/);
    await expect(usage.getByTestId("lab-card-usage-memory-value")).toHaveText(/^\d+(\.\d)? (MiB|GiB)$/);
    await expect(card.getByTestId("lab-card-thumbnail").getByTestId("lab-thumbnail-cpu")).toHaveCount(6);
    await expect(card.locator("g[data-node='leaf1']")).toHaveAttribute("data-cpu", /^\d+$/);

    // Nodes that are down report nothing; the card still shows the lab's total.
    const partial = page.getByRole("article", { name: "stages" });
    await expect(partial.getByTestId("lab-card-usage")).toHaveAttribute("data-status", "live");

    // Labs nobody deployed have no usage row.
    await expect(page.getByRole("article", { name: "simple" }).getByTestId("lab-card-usage")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a lab host without node stats shows no usage row", async ({ page }) => {
    await openOverview(page, "stats=unavailable");
    await expect(page.getByRole("article", { name: "spine-leaf" }).getByTestId("lab-card-thumbnail")).toHaveAttribute("data-loaded", "true");
    await expect(page.getByTestId("lab-card-usage")).toHaveCount(0);
  });

  test("only visible running labs stream, and closing the overview stops them", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await openOverview(page, "many=1");
    await expect.poll(() => activeWatches(page)).toContain("spine-leaf");
    const initial = await activeWatches(page);
    // Far down the list, running labs wait until their cards come near the view.
    expect(initial).not.toContain("lab-57");

    await page.getByRole("article", { name: "lab-57" }).scrollIntoViewIfNeeded();
    await expect.poll(() => activeWatches(page)).toContain("lab-57");
    await expect.poll(() => activeWatches(page)).not.toContain("spine-leaf");

    await page.getByRole("button", { name: "Close labs overview" }).click();
    await expect(page.getByTestId("overview-closed")).toBeAttached();
    await expect.poll(() => activeWatches(page)).toEqual([]);
  });
});
