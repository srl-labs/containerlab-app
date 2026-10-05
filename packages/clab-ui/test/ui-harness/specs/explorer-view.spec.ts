import { test, expect, type Page } from "@playwright/test";

async function openExplorer(page: Page, query: string) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/explorer.html?${query}`);
  await expect(page.getByText("lab-host-a", { exact: true })).toBeVisible();
  return errors;
}

test("endpoints signal state with a dot and plain words instead of chips", async ({ page }) => {
  const errors = await openExplorer(page, "mode=standalone&theme=dark");

  await expect(page.getByText("Session expired", { exact: true })).toBeVisible();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  // Connected is the quiet default: no pill, no uppercase label.
  await expect(page.getByText(/^connected$/i)).toHaveCount(0);
  await expect(page.getByText("Shared", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Shared lab" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("every row is a single line and details sit beside the name", async ({ page }) => {
  await openExplorer(page, "mode=standalone&theme=dark");

  const rows = page.locator(".explorer-tree-row");
  const heights = new Set<number>();
  for (const row of await rows.all()) {
    const box = await row.boundingBox();
    if (box) heights.add(Math.round(box.height));
  }
  // Endpoints are slightly taller; labs, nodes, interfaces and files share one height.
  expect([...heights].sort()).toEqual([24, 26, 30]);

  const name = (await page.getByText("st", { exact: true }).first().boundingBox())!;
  const owner = (await page.getByText("fschwar", { exact: true }).first().boundingBox())!;
  expect(Math.abs(name.y + name.height / 2 - (owner.y + owner.height / 2))).toBeLessThan(4);
});

test("the disclosure chevron and indent guides follow the tree", async ({ page }) => {
  await openExplorer(page, "mode=standalone&theme=light");

  await expect(page.getByText("e1-49", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Collapse leaf1" }).click();
  await expect(page.getByText("e1-49", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Expand leaf1" }).click();
  await expect(page.getByText("e1-49", { exact: true })).toBeVisible();
});

test("the filter can be cleared and details give way to names in a narrow pane", async ({ page }) => {
  await openExplorer(page, "mode=standalone&theme=dark&width=240");

  await expect(page.getByText("fschwar", { exact: true }).first()).toBeHidden();
  await expect(page.getByText("lab-host-a", { exact: true })).toBeVisible();

  const filter = page.getByPlaceholder("Filter labs, nodes, interfaces");
  await filter.fill("leaf");
  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(filter).toHaveValue("");
});

test("the VS Code layout keeps titled sections with plain counts", async ({ page }) => {
  await page.goto("/explorer.html?mode=vscode&theme=dark");

  await expect(page.getByText("Running Labs", { exact: true })).toBeVisible();
  await expect(page.locator(".explorer-section-count").first()).toHaveText("2");
  await expect(page.getByText("Help & Feedback", { exact: true })).toBeVisible();
});

test("an embedded single section drops its own header", async ({ page }) => {
  await page.goto("/explorer.html?mode=files&theme=dark");

  await expect(page.getByText("Local workspace", { exact: true })).toBeVisible();
  await expect(page.getByText("File Explorer", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Collapse topologies" })).toBeVisible();
});
