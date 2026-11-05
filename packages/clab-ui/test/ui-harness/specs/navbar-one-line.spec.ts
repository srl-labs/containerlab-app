import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

type TopoViewerPage = Parameters<Parameters<typeof test>[2]>[0]["topoViewerPage"];

async function openToolbar(page: Page, topoViewerPage: TopoViewerPage) {
  await topoViewerPage.gotoFile("simple.clab.yml");
  await topoViewerPage.waitForCanvasReady();
  await topoViewerPage.setEditMode();
  await topoViewerPage.unlock();
  await expect(page.getByTestId("navbar-capture")).toBeVisible();
}

test("the toolbar stays on one line and moves what does not fit to More", async ({ page, topoViewerPage }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openToolbar(page, topoViewerPage);
  const bar = page.getByTestId("topoviewer-navbar");
  const fullHeight = (await bar.boundingBox())?.height;
  await expect(page.getByTestId("navbar-capture")).toBeVisible();

  await page.setViewportSize({ width: 260, height: 600 });
  await expect(page.getByTestId("navbar-capture")).toHaveCount(0);
  await expect(page.getByTestId("navbar-layout")).toHaveCount(0);
  await expect(page.getByTestId("navbar-deploy")).toBeVisible();
  await expect(page.getByTestId("navbar-more")).toBeVisible();
  expect((await bar.boundingBox())?.height).toBe(fullHeight);
  const fits = await page.evaluate(() => {
    const element = document.querySelector('[data-testid="topoviewer-navbar"]');
    return element !== null && element.getBoundingClientRect().right <= window.innerWidth;
  });
  expect(fits).toBe(true);

  // Trimmed buttons keep working from More, also the ones with a menu of their own.
  await page.getByTestId("navbar-more").click();
  await expect(page.getByTestId("navbar-more-capture")).toBeVisible();
  await page.getByTestId("navbar-more-layout").click();
  await expect(page.getByTestId("navbar-layout-force")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1280, height: 600 });
  await expect(page.getByTestId("navbar-capture")).toBeVisible();
  await page.getByTestId("navbar-more").click();
  await expect(page.getByTestId("navbar-more-capture")).toHaveCount(0);
});

test("the folded filter opens from its button and the bar makes room", async ({ page, topoViewerPage }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openToolbar(page, topoViewerPage);
  await page.setViewportSize({ width: 460, height: 600 });
  const filter = page.getByTestId("navbar-find-node");
  await expect(filter.getByPlaceholder("Filter")).toBeHidden();

  await filter.getByRole("button", { name: "Find nodes" }).click();
  await expect(filter.getByPlaceholder("Filter")).toBeFocused();
  const fits = await page.evaluate(() => {
    const element = document.querySelector('[data-testid="topoviewer-navbar"]');
    return element !== null && element.getBoundingClientRect().right <= window.innerWidth;
  });
  expect(fits).toBe(true);
});
