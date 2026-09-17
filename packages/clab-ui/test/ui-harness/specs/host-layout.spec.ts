import { test, expect } from "../fixtures/topoviewer";

test("hosts can disable lifecycle controls while keeping topology editing available", async ({
  page
}) => {
  await page.goto("/?fixture=simple.clab.yml&lifecycleActions=false");
  await expect(page.getByTestId("navbar-lock")).toBeVisible();
  await expect(page.getByTestId("navbar-deploy")).toHaveCount(0);
  await expect(page.getByTestId("navbar-deploy-menu")).toHaveCount(0);
  await expect(page.locator(".react-flow")).toBeVisible();

  await page.goto("/?fixture=simple.clab.yml");
  await expect(page.getByTestId("navbar-deploy")).toBeVisible();
});
