import { expect, test } from "@playwright/test";

const PREVIEW_URL = "/webviews.html?view=template-preview";

test.describe("Topology template preview", () => {
  test("shows the rendered topology read only, with the variables it used", async ({ page }) => {
    await page.goto(PREVIEW_URL);
    const yaml = page.getByTestId("topology-template-preview-yaml");
    await expect(yaml).toHaveAttribute("data-rendered", "true");
    await expect(page.getByTestId("topology-template-preview-source")).toHaveText(
      "Lab fabric · Variables from fabric.clab_vars.yml"
    );
    await expect(yaml.locator(".view-lines")).toContainText("leaf2:");
    await expect(yaml.locator(".view-lines")).not.toContainText("leaf3:");

    // The rendered YAML cannot be edited.
    await yaml.locator(".view-lines").click();
    await page.keyboard.type("x");
    await expect(yaml.locator(".view-lines")).not.toContainText("xname");
  });

  test("renders again with another vars file and reports problems", async ({ page }) => {
    await page.goto(PREVIEW_URL);
    const yaml = page.getByTestId("topology-template-preview-yaml");
    await expect(yaml).toHaveAttribute("data-rendered", "true");

    const varsFile = page.getByTestId("topology-template-preview-vars");
    await varsFile.fill("prod.yml");
    await page.getByTestId("topology-template-preview-refresh").click();
    await expect(page.getByTestId("topology-template-preview-source")).toHaveText(
      "Lab fabric · Variables from prod.yml"
    );
    await expect(yaml.locator(".view-lines")).toContainText("leaf4:");
    // containerlab rejected the rendered topology; the YAML still shows.
    await expect(page.getByTestId("topology-template-preview-warning")).toHaveText(
      "unknown field bogus"
    );

    await varsFile.fill("/etc/vars.yml");
    await expect(page.getByTestId("topology-template-preview-refresh")).toBeDisabled();

    await varsFile.fill("missing.yml");
    await varsFile.press("Enter");
    await expect(page.getByTestId("topology-template-preview-error")).toHaveText(
      "file not found: labs/missing.yml"
    );
    await expect(yaml).toHaveAttribute("data-rendered", "false");
  });
});
