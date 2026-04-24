import { expect, test } from "@playwright/test";

test.describe("Standalone startup", () => {
  test("renders endpoint login form without a configured session", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByText("Connect one or more `clab-api-server` endpoints", { exact: false })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Add Endpoint" })).toBeVisible();
    await expect(page.getByLabel("API Endpoint")).toHaveValue("http://localhost:8080");
    await expect(page.getByLabel("Label")).toBeVisible();
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByLabel("Keep me signed in")).toHaveValue("24h");
    await expect(page.getByRole("button", { name: "Add Endpoint" })).toBeDisabled();
  });
});
