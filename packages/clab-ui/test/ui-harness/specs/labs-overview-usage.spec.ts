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

function postedToHost(page: Page): Promise<Array<{ type: string; action?: string; cardId?: string }>> {
  return page.evaluate(() => (window as unknown as { __OVERVIEW__: { posted: Array<{ type: string }> } }).__OVERVIEW__.posted);
}

/** In VS Code the overview is its own editor tab; the extension host sends labs, files and usage. */
test.describe("Labs overview in an editor tab", () => {
  test("shows the host's labs with thumbnails and live usage, and sends actions back", async ({ page }) => {
    const errors = await openOverview(page, "host=webview");
    const card = page.getByRole("article", { name: "spine-leaf" });
    await expect(card.getByTestId("lab-card-thumbnail")).toHaveAttribute("data-loaded", "true");
    await expect(card.getByTestId("lab-card-usage")).toHaveAttribute("data-status", "live");
    await expect(card.getByTestId("lab-card-usage-cpu-value")).toHaveText(/^\d+(\.\d)? %$/);
    await expect(card.getByTestId("lab-thumbnail-cpu")).toHaveCount(6);
    // The tab closes like any editor; links are a browser thing.
    await expect(page.getByRole("button", { name: "Close labs overview" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Copy link/ })).toHaveCount(0);

    await card.getByRole("button", { name: "Open spine-leaf" }).click();
    await page.getByRole("article", { name: "simple" }).getByRole("button", { name: "Deploy simple" }).click();
    await page.getByRole("button", { name: "New lab" }).click();
    await expect.poll(async () => (await postedToHost(page)).filter((message) => message.type !== "labs-overview:load-sources" && !message.type.startsWith("labs-overview:usage"))).toEqual([
      { type: "labs-overview:ready" },
      { type: "labs-overview:action", action: "open", cardId: expect.stringMatching(/spine-leaf\.clab\.yml$/) },
      { type: "labs-overview:action", action: "deploy", cardId: expect.stringMatching(/simple\.clab\.yml$/) },
      { type: "labs-overview:create-lab" }
    ]);
    expect(errors).toEqual([]);
  });

  test("a lab host without node stats shows no usage row", async ({ page }) => {
    await openOverview(page, "host=webview&stats=unavailable");
    await expect(page.getByRole("article", { name: "spine-leaf" }).getByTestId("lab-card-thumbnail")).toHaveAttribute("data-loaded", "true");
    await expect(page.getByTestId("lab-card-usage")).toHaveCount(0);
  });

  test("streams follow the visible cards", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await openOverview(page, "host=webview&many=1");
    await expect.poll(() => activeWatches(page)).toContain("spine-leaf");
    expect(await activeWatches(page)).not.toContain("lab-57");

    await page.getByRole("article", { name: "lab-57" }).scrollIntoViewIfNeeded();
    await expect.poll(() => activeWatches(page)).toContain("lab-57");
    await expect.poll(() => activeWatches(page)).not.toContain("spine-leaf");
  });
});

/** The lab hosts above the cards: how much each has left, so a new lab goes where it fits. */
test.describe("Labs overview lab hosts", () => {
  test("lab hosts show their free resources and the one with the most room", async ({ page }) => {
    const errors = await openOverview(page, "hosts=1&stats=none");
    const hosts = page.getByTestId("labs-overview-hosts");
    const busy = hosts.getByTestId("lab-host-harness");
    const big = hosts.getByTestId("lab-host-big");
    await expect(big.getByTestId("lab-host-memory-value")).toHaveText("96 GiB free");
    await expect(big.getByTestId("lab-host-roomiest")).toBeVisible();
    await expect(busy.getByTestId("lab-host-roomiest")).toHaveCount(0);
    await expect(busy.getByTestId("lab-host-memory")).toHaveAttribute("data-level", "full");
    await expect(busy.getByTestId("lab-host-cpu")).toHaveAttribute("data-level", "full");
    await expect(busy).toContainText("6 running labs");
    // A signed-out host is listed without usage.
    await expect(hosts.getByTestId("lab-host-away")).toContainText("Sign in to see its resources.");

    // A host shows only its labs, and again every lab.
    await big.click();
    await expect(page.getByText("No labs match")).toBeVisible();
    await big.click();
    await expect(page.getByRole("article", { name: "spine-leaf" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the editor-tab overview asks the extension host for lab host resources", async ({ page }) => {
    const errors = await openOverview(page, "host=webview&hosts=1&stats=none");
    await expect(page.getByTestId("lab-host-big").getByTestId("lab-host-memory-value")).toHaveText("96 GiB free");
    expect(errors).toEqual([]);
  });
});
