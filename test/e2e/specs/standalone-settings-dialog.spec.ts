import fs from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const SEL_SETTINGS_BUTTON = '[data-testid="standalone-settings-button"]';
const SEL_SETTINGS_PANEL = '[data-testid="standalone-settings-panel"]';
const SEL_OPEN_DIALOG = '[data-testid="standalone-settings-open-dialog"]';
const SEL_SETTINGS_DIALOG = '[data-testid="standalone-settings-dialog"]';
const SEL_SETTINGS_CLOSE = '[data-testid="standalone-settings-close"]';
const SEL_NAV_ENDPOINTS = '[data-testid="standalone-settings-nav-endpoints"]';
const SEL_NAV_GENERAL = '[data-testid="standalone-settings-nav-general"]';
const SEL_NAV_TERMINAL = '[data-testid="standalone-settings-nav-terminal"]';
const SEL_NAV_ABOUT = '[data-testid="standalone-settings-nav-about"]';
const SEL_SAVE_TERMINAL = '[data-testid="standalone-settings-save-terminal"]';
const SEL_THEME_LIGHT = '[data-testid="standalone-settings-theme-light"]';
const SEL_FONT_PRESET_15 = '[data-testid="standalone-settings-font-size-preset-15"]';

test.describe("Standalone Settings Dialog", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem("clab-standalone-settings-test-seeded") !== "true") {
        localStorage.removeItem("clab-standalone-theme");
        localStorage.removeItem("clab-standalone-terminal-settings");
        localStorage.setItem("clab-standalone-settings-test-seeded", "true");
      }
      localStorage.setItem(
        "clab-standalone-endpoints",
        JSON.stringify([
          {
            id: "test-endpoint",
            url: "https://localhost:8080",
            label: "Test Endpoint",
            username: "admin",
            sessionDuration: "24h"
          }
        ])
      );
    });
    await page.goto("/");
    await expect(page.locator(SEL_SETTINGS_BUTTON)).toBeVisible();
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
    await expect(panel.getByRole("button", { name: "General Settings" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Disconnect Sessions" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Inspect Labs" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "About" })).toHaveCount(0);
  });

  test("opens the standalone settings dialog with section navigation", async ({ page }) => {
    const dialog = await openSettings(page);

    await expect(dialog.locator(SEL_SETTINGS_CLOSE)).toBeVisible();
    await expect(dialog.locator(SEL_NAV_GENERAL)).toBeVisible();
    await expect(dialog.locator(SEL_NAV_TERMINAL)).toBeVisible();
    await expect(dialog.locator(SEL_NAV_ABOUT)).toBeVisible();

    await dialog.locator(SEL_NAV_TERMINAL).click();
    await expect(dialog.getByRole("heading", { name: "Terminal", exact: true })).toBeVisible();
    await expect(dialog.getByLabel("SSH User Mapping JSON")).toBeVisible();
    await expect(dialog.getByLabel("Telnet Port")).toBeVisible();
    await expect(dialog.getByLabel("Terminal Font Size")).toBeVisible();
    await expect(dialog.locator(SEL_FONT_PRESET_15)).toBeVisible();

    await dialog.locator(SEL_NAV_ABOUT).click();
    await expect(dialog.getByRole("heading", { name: "About", exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Containerlab Version")).toBeVisible();
    await expect(dialog.getByLabel("Update Check")).toBeVisible();
  });

  test("shows endpoint health stats when a connected endpoint is available", async ({ page }) => {
    await page.addInitScript(() => {
      class MockEventSource extends EventTarget {
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        readyState = 0;
        url: string;

        constructor(url: string) {
          super();
          this.url = url;
          window.setTimeout(() => {
            this.readyState = 1;
            this.onopen?.(new Event("open"));
            this.dispatchEvent(new Event("open"));
          }, 0);
        }

        close(): void {
          this.readyState = 2;
        }
      }

      window.EventSource = MockEventSource as unknown as typeof EventSource;
    });
    await page.route("**/auth/me**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          endpoints: [
            {
              id: "test-endpoint",
              url: "https://localhost:8080",
              label: "Test Endpoint",
              username: "admin",
              sessionDuration: "24h",
              status: "connected",
              connected: true
            }
          ]
        })
      });
    });
    await page.route("**/api/runtime/ui/custom-nodes**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ customNodes: [], defaultNode: "" })
      });
    });
    await page.route("**/auth/endpoints/test-endpoint/metrics", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          serverInfo: {
            version: "test",
            uptime: "1m",
            startTime: "2026-04-24T00:00:00Z"
          },
          metrics: {
            cpu: { usagePercent: 12.4, numCPU: 8 },
            mem: { usagePercent: 45.6, usedMem: 4_294_967_296, totalMem: 8_589_934_592 },
            disk: {
              path: "/",
              usagePercent: 67.8,
              usedDisk: 107_374_182_400,
              totalDisk: 214_748_364_800
            }
          }
        })
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(SEL_SETTINGS_BUTTON)).toBeVisible();

    const dialog = await openSettings(page);
    await dialog.locator(SEL_NAV_ENDPOINTS).click();
    await expect(dialog.getByText("CPU")).toBeVisible();
    await expect(dialog.getByText("Memory")).toBeVisible();
    await expect(dialog.getByText("Disk")).toBeVisible();
    await expect(dialog.getByText("8 cores")).toBeVisible();
  });

  test("exports and imports endpoint profiles from settings", async ({ page }) => {
    const dialog = await openSettings(page);
    await dialog.locator(SEL_NAV_ENDPOINTS).click();

    const downloadPromise = page.waitForEvent("download");
    await dialog.locator('[data-testid="standalone-endpoints-export"]').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(download.suggestedFilename()).toBe("containerlab-web-endpoints.json");
    expect(downloadPath).toBeTruthy();
    const exported = await fs.readFile(downloadPath ?? "", "utf8");
    const payload = JSON.parse(exported) as {
      endpoints: Array<Record<string, unknown>>;
      kind: string;
      version: number;
    };
    expect(payload).toEqual({
      kind: "containerlab-web.endpoints",
      version: 1,
      endpoints: [
        {
          url: "https://localhost:8080",
          label: "Test Endpoint",
          username: "admin",
          sessionDuration: "24h"
        }
      ]
    });
    expect(exported).not.toContain("password");
    expect(exported).not.toContain("token");
    expect(exported).not.toContain("connected");

    const fileChooserPromise = page.waitForEvent("filechooser");
    await dialog.locator('[data-testid="standalone-endpoints-import"]').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "endpoints.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          kind: "containerlab-web.endpoints",
          version: 1,
          endpoints: [
            {
              url: "localhost:8080/",
              label: "Imported Endpoint",
              username: "admin",
              sessionDuration: "7d"
            }
          ]
        })
      )
    });

    await expect(dialog.getByText("Imported 1 endpoint profile", { exact: false })).toBeVisible();
    await expect(dialog.getByText("Imported Endpoint")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("clab-standalone-endpoints")))
      .toContain("Imported Endpoint");
  });

  test("invalid terminal settings stay blocked with inline validation", async ({ page }) => {
    const dialog = await openSettings(page);
    await dialog.locator(SEL_NAV_TERMINAL).click();

    const telnetField = dialog.getByLabel("Telnet Port");
    const sshMappingField = dialog.getByLabel("SSH User Mapping JSON");
    const fontSizeField = dialog.getByLabel("Terminal Font Size");
    const saveButton = dialog.locator(SEL_SAVE_TERMINAL);

    await telnetField.fill("70000");
    await expect(dialog.getByText("Telnet port must be an integer between 1 and 65535.")).toBeVisible();
    await expect(saveButton).toBeDisabled();

    await telnetField.fill("5000");
    await sshMappingField.fill("{");
    await expect(dialog.getByText("SSH user mapping must be valid JSON.")).toBeVisible();
    await expect(saveButton).toBeDisabled();

    await sshMappingField.fill('{\n  "nokia_srlinux": "admin"\n}');
    await fontSizeField.fill("30");
    await expect(dialog.getByText("Terminal font size must be an integer between 11 and 18.")).toBeVisible();
    await expect(saveButton).toBeDisabled();
  });

  test("theme and terminal settings persist across reload", async ({ page }) => {
    const dialog = await openSettings(page);

    await dialog.locator(SEL_THEME_LIGHT).click();
    await expect(dialog.locator(SEL_THEME_LIGHT)).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("clab-standalone-theme")))
      .toBe("light");

    await dialog.locator(SEL_NAV_TERMINAL).click();
    await dialog.getByLabel("SSH User Mapping JSON").fill('{\n  "custom_kind": "operator"\n}');
    await dialog.getByLabel("Telnet Port").fill("6001");
    await dialog.locator(SEL_FONT_PRESET_15).click();
    await expect(dialog.getByLabel("Terminal Font Size")).toHaveValue("15");
    await dialog.locator(SEL_SAVE_TERMINAL).click();
    await expect(dialog.locator(SEL_SAVE_TERMINAL)).toBeEnabled();

    await dialog.locator(SEL_SETTINGS_CLOSE).click();
    await expect(dialog).not.toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(SEL_SETTINGS_BUTTON)).toBeVisible();

    const reloadedDialog = await openSettings(page);
    await expect(reloadedDialog.locator(SEL_THEME_LIGHT)).toHaveAttribute("aria-pressed", "true");

    await reloadedDialog.locator(SEL_NAV_TERMINAL).click();
    await expect(reloadedDialog.getByLabel("Telnet Port")).toHaveValue("6001");
    await expect(reloadedDialog.getByLabel("Terminal Font Size")).toHaveValue("15");
    await expect(reloadedDialog.getByLabel("SSH User Mapping JSON")).toHaveValue(
      /"custom_kind": "operator"/
    );
  });
});
