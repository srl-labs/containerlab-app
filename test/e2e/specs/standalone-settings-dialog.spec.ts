import { expect, type Page } from "@playwright/test";

import { test } from "../fixtures/topoviewer";

const SIMPLE_FILE = "simple.clab.yml";

const SEL_SETTINGS_BUTTON = '[data-testid="standalone-settings-button"]';
const SEL_SETTINGS_PANEL = '[data-testid="standalone-settings-panel"]';
const SEL_OPEN_DIALOG = '[data-testid="standalone-settings-open-dialog"]';
const SEL_SETTINGS_DIALOG = '[data-testid="standalone-settings-dialog"]';
const SEL_SETTINGS_CLOSE = '[data-testid="standalone-settings-close"]';
const SEL_NAV_GENERAL = '[data-testid="standalone-settings-nav-general"]';
const SEL_NAV_TERMINAL = '[data-testid="standalone-settings-nav-terminal"]';
const SEL_NAV_ABOUT = '[data-testid="standalone-settings-nav-about"]';
const SEL_SAVE_TERMINAL = '[data-testid="standalone-settings-save-terminal"]';
const SEL_THEME_LIGHT = '[data-testid="standalone-settings-theme-light"]';

test.describe("Standalone Settings Dialog", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
  });

  async function openSettings(page: Page) {
    await page.locator(SEL_SETTINGS_BUTTON).click();
    const panel = page.locator(SEL_SETTINGS_PANEL);
    await expect(panel).toBeVisible();
    await panel.locator(SEL_OPEN_DIALOG).click();
    const dialog = page.locator(SEL_SETTINGS_DIALOG);
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test("quick panel keeps connection status and logout close to the gear button", async ({ page }) => {
    await page.locator(SEL_SETTINGS_BUTTON).click();

    const panel = page.locator(SEL_SETTINGS_PANEL);
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Quick Settings")).toBeVisible();
    await expect(panel.getByText("Endpoints")).toBeVisible();
    await expect(panel.getByText("Configured Endpoints")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Logout" })).toBeVisible();
    await expect(panel.getByRole("button", { name: /Manage .* Endpoint/ })).toBeVisible();
    await expect(panel.getByRole("button", { name: "General Settings" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Inspect Labs" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "About" })).toHaveCount(0);
  });

  test("opens the standalone settings dialog with section navigation", async ({ page }) => {
    const dialog = await openSettings(page);

    await expect(dialog.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(dialog.locator(SEL_NAV_GENERAL)).toBeVisible();
    await expect(dialog.locator(SEL_NAV_TERMINAL)).toBeVisible();
    await expect(dialog.locator(SEL_NAV_ABOUT)).toBeVisible();

    await dialog.locator(SEL_NAV_TERMINAL).click();
    await expect(dialog.getByRole("heading", { name: "Terminal" })).toBeVisible();
    await expect(dialog.getByLabel("SSH User Mapping JSON")).toBeVisible();
    await expect(dialog.getByLabel("Telnet Port")).toBeVisible();

    await dialog.locator(SEL_NAV_ABOUT).click();
    await expect(dialog.getByRole("heading", { name: "About" })).toBeVisible();
    await expect(dialog.getByLabel("Containerlab Version")).toBeVisible();
    await expect(dialog.getByLabel("Update Check")).toBeVisible();
  });

  test("invalid terminal settings stay blocked with inline validation", async ({ page }) => {
    const dialog = await openSettings(page);
    await dialog.locator(SEL_NAV_TERMINAL).click();

    const telnetField = dialog.getByLabel("Telnet Port");
    const sshMappingField = dialog.getByLabel("SSH User Mapping JSON");
    const saveButton = dialog.locator(SEL_SAVE_TERMINAL);

    await telnetField.fill("70000");
    await expect(dialog.getByText("Telnet port must be an integer between 1 and 65535.")).toBeVisible();
    await expect(saveButton).toBeDisabled();

    await telnetField.fill("5000");
    await sshMappingField.fill("{");
    await expect(dialog.getByText("SSH user mapping must be valid JSON.")).toBeVisible();
    await expect(saveButton).toBeDisabled();
  });

  test("theme and terminal settings persist across reload", async ({ page, topoViewerPage }) => {
    const dialog = await openSettings(page);

    await dialog.locator(SEL_THEME_LIGHT).click();
    await expect(dialog.locator(SEL_THEME_LIGHT)).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("clab-standalone-theme")))
      .toBe("light");

    await dialog.locator(SEL_NAV_TERMINAL).click();
    await dialog.getByLabel("SSH User Mapping JSON").fill('{\n  "custom_kind": "operator"\n}');
    await dialog.getByLabel("Telnet Port").fill("6001");
    await dialog.locator(SEL_SAVE_TERMINAL).click();
    await expect(dialog.locator(SEL_SAVE_TERMINAL)).toBeEnabled();

    await dialog.locator(SEL_SETTINGS_CLOSE).click();
    await expect(dialog).not.toBeVisible();

    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();

    const reloadedDialog = await openSettings(page);
    await expect(reloadedDialog.locator(SEL_THEME_LIGHT)).toHaveAttribute("aria-pressed", "true");

    await reloadedDialog.locator(SEL_NAV_TERMINAL).click();
    await expect(reloadedDialog.getByLabel("Telnet Port")).toHaveValue("6001");
    await expect(reloadedDialog.getByLabel("SSH User Mapping JSON")).toHaveValue(
      '{\n  "custom_kind": "operator"\n}'
    );
  });
});
