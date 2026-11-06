/**
 * A quickly filled in node template must not get lost. Every host refuses one without a name
 * or kind, so saving one keeps the dialog open on the field. A base name is optional, so a
 * template without one still has to reach the canvas.
 */
import type { Locator, Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

const FILE = "simple.clab.yml";
const NAME_FIELD = "#node-custom-name";
const BASE_NAME_FIELD = "#node-base-name";
const KIND_FIELD = "#node-kind";
const CREATE_TITLE = "Create Node Template";
const NAME_ERROR = "Give the template a name to save it";
const KIND_ERROR = "Choose a kind to save the template";
const EMPTY_PALETTE = "No node templates defined";

function dialogOf(page: Page): Locator {
  return page.getByRole("dialog");
}

async function openNewTemplate(page: Page): Promise<void> {
  const search = page.getByPlaceholder("Search nodes…");
  if (!(await search.isVisible().catch(() => false))) {
    await page.locator('[data-testid="panel-toggle-btn"]').click();
    await expect(search).toBeVisible({ timeout: 5000 });
  }
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(dialogOf(page)).toContainText(CREATE_TITLE);
}

async function save(page: Page): Promise<void> {
  await dialogOf(page).getByRole("button", { name: "Save", exact: true }).click();
}

async function dragTemplateToCanvas(
  page: Page,
  name: string,
  targetPosition = { x: 200, y: 200 }
): Promise<void> {
  await page
    .getByText(name, { exact: true })
    .dragTo(page.locator(".react-flow-canvas"), { targetPosition });
}

test.describe("Node template without a base name", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
  });

  test("dragging it to the canvas names the node after the template", async ({
    page,
    topoViewerPage
  }) => {
    await openNewTemplate(page);
    await page.locator(NAME_FIELD).fill("My leaf");
    await save(page);
    await expect(dialogOf(page)).toHaveCount(0);

    await dragTemplateToCanvas(page, "My leaf");
    await expect.poll(() => topoViewerPage.getNodeIds()).toContain("My-leaf1");

    await dragTemplateToCanvas(page, "My leaf", { x: 320, y: 320 });
    await expect.poll(() => topoViewerPage.getNodeIds()).toContain("My-leaf2");

    await expect.poll(() => topoViewerPage.getYamlFromFile(FILE)).toContain("My-leaf2:");
  });

  test("a base name still wins over the template name", async ({ page, topoViewerPage }) => {
    await openNewTemplate(page);
    await page.locator(NAME_FIELD).fill("My spine");
    await page.locator(BASE_NAME_FIELD).fill("spine");
    await save(page);
    await expect(dialogOf(page)).toHaveCount(0);

    await dragTemplateToCanvas(page, "My spine");

    await expect.poll(() => topoViewerPage.getNodeIds()).toContain("spine1");
  });
});

test.describe("Node template required fields", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
  });

  test("saving without a name keeps the dialog and what was entered", async ({ page }) => {
    await openNewTemplate(page);
    await expect(page.getByText(NAME_ERROR)).toHaveCount(0);

    await page.locator(BASE_NAME_FIELD).fill("leaf");
    // Clicked through to another tab, where the name field is out of sight
    await page.locator('[data-testid="panel-tab-runtime"]').click();
    await expect(page.locator(NAME_FIELD)).toHaveCount(0);

    await save(page);

    await expect(dialogOf(page)).toContainText(CREATE_TITLE);
    await expect(page.locator(NAME_FIELD)).toBeFocused();
    await expect(page.getByText(NAME_ERROR)).toBeVisible();
    await expect(page.locator(BASE_NAME_FIELD)).toHaveValue("leaf");

    // Naming it clears the error, and the save goes through with everything on it
    await page.locator(NAME_FIELD).fill("My leaf");
    await expect(page.getByText(NAME_ERROR)).toHaveCount(0);
    await save(page);

    await expect(dialogOf(page)).toHaveCount(0);
    await expect(page.getByText("My leaf")).toBeVisible();
    await expect(page.getByText(EMPTY_PALETTE)).toHaveCount(0);
  });

  test("a name of only spaces is no name", async ({ page }) => {
    await openNewTemplate(page);
    await page.locator(NAME_FIELD).fill("   ");

    await save(page);

    await expect(dialogOf(page)).toContainText(CREATE_TITLE);
    await expect(page.getByText(NAME_ERROR)).toBeVisible();
  });

  test("saving without a kind points at the kind", async ({ page }) => {
    await openNewTemplate(page);
    await page.locator(NAME_FIELD).fill("No kind yet");
    await page.locator(KIND_FIELD).fill("");

    await save(page);

    await expect(dialogOf(page)).toContainText(CREATE_TITLE);
    await expect(page.locator(KIND_FIELD)).toBeFocused();
    await expect(page.getByText(KIND_ERROR)).toBeVisible();
    await expect(page.getByText(NAME_ERROR)).toHaveCount(0);
    await expect(page.locator(NAME_FIELD)).toHaveValue("No kind yet");

    await page.locator(KIND_FIELD).fill("linux");
    await expect(page.getByText(KIND_ERROR)).toHaveCount(0);
    await save(page);

    await expect(dialogOf(page)).toHaveCount(0);
    await expect(page.getByText("No kind yet")).toBeVisible();
  });

  test("clearing the name of a saved template does not lose it", async ({ page }) => {
    await openNewTemplate(page);
    await page.locator(NAME_FIELD).fill("Keep me");
    await save(page);
    await expect(dialogOf(page)).toHaveCount(0);

    const row = page.getByText("Keep me");
    await row.hover();
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await expect(dialogOf(page)).toContainText("Edit Node Template");

    await page.locator(NAME_FIELD).fill("");
    await save(page);

    await expect(dialogOf(page)).toContainText("Edit Node Template");
    await expect(page.getByText(NAME_ERROR)).toBeVisible();

    await dialogOf(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(page.getByText("Keep me")).toBeVisible();
  });
});
