import fs from "node:fs/promises";

import type { Page } from "@playwright/test";

import {
  connected,
  expect,
  mockStandaloneApi,
  seedEndpoints,
  test,
  TEST_ENDPOINT
} from "@srl-labs/containerlab-test-kit/playwright";

test.describe("Standalone Settings Dialog", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem("clab-standalone-settings-test-seeded") !== "true") {
        localStorage.removeItem("clab-standalone-theme");
        localStorage.removeItem("clab-standalone-terminal-settings");
        localStorage.setItem("clab-standalone-settings-test-seeded", "true");
      }
    });
    await seedEndpoints(page, [TEST_ENDPOINT]);
    await page.goto("/");
    await expect(page.getByTestId("standalone-settings-button")).toBeVisible({ timeout: 30_000 });
  });

  async function openSettings(page: Page) {
    await page.getByTestId("standalone-settings-button").click();
    const dialog = page.getByTestId("standalone-settings-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("settings-layout")).toBeVisible();
    return dialog;
  }

  async function mockConnectedEndpointExplorer(page: Page) {
    await mockStandaloneApi(page, { endpoints: [connected(TEST_ENDPOINT)] });
    await page.goto("/", { waitUntil: "domcontentloaded" });
  }

  test("settings opens directly from the shared rail and exposes disconnect", async ({ page }) => {
    const dialog = await openSettings(page);
    await expect(dialog.getByRole("button", { name: "Disconnect Sessions" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId("standalone-settings-button")).toBeFocused();
  });

  test("opens the standalone settings dialog with section navigation", async ({ page }) => {
    const dialog = await openSettings(page);

    await expect(dialog.getByTestId("standalone-settings-close")).toBeVisible();
    await expect(dialog.getByTestId("standalone-settings-nav-general")).toBeVisible();
    await expect(dialog.getByTestId("standalone-settings-nav-terminal")).toBeVisible();
    await expect(dialog.getByTestId("standalone-settings-nav-about")).toBeVisible();

    await dialog.getByTestId("standalone-settings-nav-terminal").click();
    await expect(dialog.getByRole("heading", { name: "Terminal", exact: true })).toBeVisible();
    await expect(dialog.getByLabel("SSH User Mapping JSON")).toBeVisible();
    await expect(dialog.getByLabel("Telnet Port")).toBeVisible();
    await expect(dialog.getByLabel("Terminal Font Size")).toBeVisible();
    await expect(dialog.getByTestId("standalone-settings-font-size-preset-15")).toBeVisible();

    await dialog.getByTestId("standalone-settings-nav-about").click();
    await expect(dialog.getByRole("heading", { name: "About", exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Containerlab App", exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Documentation", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Source Code", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("link", { name: /vscode-containerlab/ })).toHaveCount(0);
    await expect(dialog.getByLabel("Containerlab Version")).toBeVisible();
    await expect(dialog.getByLabel("Update Check")).toBeVisible();
  });

  test("shows endpoint health stats when a connected endpoint is available", async ({ page }) => {
    await mockStandaloneApi(page, { endpoints: [connected(TEST_ENDPOINT)] });
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
    await expect(page.getByTestId("standalone-settings-button")).toBeVisible({ timeout: 30_000 });

    const dialog = await openSettings(page);
    await dialog.getByTestId("standalone-settings-nav-endpoints").click();
    await expect(dialog.getByText("CPU")).toBeVisible();
    await expect(dialog.getByText("Memory")).toBeVisible();
    await expect(dialog.getByText("Disk")).toBeVisible();
    await expect(dialog.getByText("8 cores")).toBeVisible();
    await expect(dialog.getByText("12%", { exact: true })).toBeVisible();
    await expect(dialog.getByText("46%", { exact: true })).toBeVisible();
    await expect(dialog.getByText("68%", { exact: true })).toBeVisible();
    await expect(dialog.getByText("4.0 GiB / 8.0 GiB", { exact: true })).toBeVisible();
    await expect(dialog.getByText("100 GiB / 200 GiB on /", { exact: true })).toBeVisible();
  });

  test("the rail exposes topology creation and endpoint management", async ({ page }) => {
    await mockConnectedEndpointExplorer(page);
    await page.route("**/api/runtime/file-explorer/tree**", (route) => route.fulfill({ json: [] }));
    await page.getByRole("button", { name: "Labs", exact: true }).click();
    await page.getByRole("button", { name: "New Topology File", exact: true }).first().click();
    const create = page.getByRole("dialog", { name: "Create Topology File", exact: true });
    await expect(create).toBeVisible();
    await expect(create.getByLabel("Topology file name", { exact: true })).toBeVisible();
    await expect(create.getByRole("button", { name: "Create", exact: true })).toBeEnabled();
    await create.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Close explorer", exact: true }).click();

    const dialog = await openSettings(page);
    await dialog.getByTestId("standalone-settings-nav-endpoints").click();
    await expect(dialog.getByRole("heading", { name: "Endpoints", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Edit Test Endpoint", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Reconnect Test Endpoint", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Remove Test Endpoint", exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Add Endpoint", exact: true })).toBeVisible();
  });

  test("opens documentation from the Help & Feedback rail button", async ({ page }) => {
    await page.evaluate(() => {
      const targetWindow = window as typeof window & {
        __standaloneOpenedLinks?: Array<{
          features?: string;
          target?: string;
          url: string;
        }>;
      };
      targetWindow.__standaloneOpenedLinks = [];
      window.open = (url?: string | URL, target?: string, features?: string): null => {
        targetWindow.__standaloneOpenedLinks?.push({
          features,
          target,
          url: String(url ?? "")
        });
        return null;
      };
    });

    await page.getByRole("button", { name: "Help & Feedback", exact: true }).click();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const targetWindow = window as typeof window & {
            __standaloneOpenedLinks?: Array<{
              features?: string;
              target?: string;
              url: string;
            }>;
          };
          return targetWindow.__standaloneOpenedLinks?.at(-1);
        })
      )
      .toEqual({
        features: "noopener,noreferrer",
        target: "_blank",
        url: "https://containerlab.app"
      });
  });

  test("exports and imports endpoint profiles from settings", async ({ page }) => {
    const dialog = await openSettings(page);
    await dialog.getByTestId("standalone-settings-nav-endpoints").click();

    const downloadPromise = page.waitForEvent("download");
    await dialog.getByTestId("standalone-endpoints-export").click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(download.suggestedFilename()).toBe("containerlab-app-endpoints.json");
    expect(downloadPath).toBeTruthy();
    const exported = await fs.readFile(downloadPath ?? "", "utf8");
    const payload = JSON.parse(exported) as {
      endpoints: Array<Record<string, unknown>>;
      kind: string;
      version: number;
    };
    expect(payload).toEqual({
      kind: "containerlab-app.endpoints",
      version: 1,
      endpoints: [
        {
          url: "https://localhost:8090",
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
    await dialog.getByTestId("standalone-endpoints-import").click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "endpoints.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          kind: "containerlab-app.endpoints",
          version: 1,
          endpoints: [
            {
              url: "localhost:8090/",
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
    await dialog.getByTestId("standalone-settings-nav-terminal").click();

    const telnetField = dialog.getByLabel("Telnet Port");
    const sshMappingField = dialog.getByLabel("SSH User Mapping JSON");
    const fontSizeField = dialog.getByLabel("Terminal Font Size");
    const saveButton = dialog.getByTestId("standalone-settings-save-terminal");

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

    await dialog.getByRole("combobox", { name: "Color theme" }).click();
    await page.getByRole("option", { name: "Light", exact: true }).click();
    await expect(dialog.getByRole("combobox", { name: "Color theme" })).toHaveText("Light");
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("clab-standalone-theme")))
      .toBe("light");

    await dialog.getByTestId("standalone-settings-nav-terminal").click();
    await dialog.getByLabel("SSH User Mapping JSON").fill('{\n  "custom_kind": "operator"\n}');
    await dialog.getByLabel("Telnet Port").fill("6001");
    await dialog.getByTestId("standalone-settings-font-size-preset-15").click();
    await expect(dialog.getByLabel("Terminal Font Size")).toHaveValue("15");
    await dialog.getByTestId("standalone-settings-save-terminal").click();
    await expect(dialog.getByTestId("standalone-settings-save-terminal")).toBeEnabled();

    await dialog.getByTestId("standalone-settings-close").click();
    await expect(dialog).not.toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("standalone-settings-button")).toBeVisible({ timeout: 30_000 });

    const reloadedDialog = await openSettings(page);
    await expect(reloadedDialog.getByRole("combobox", { name: "Color theme" })).toHaveText("Light");

    await reloadedDialog.getByTestId("standalone-settings-nav-terminal").click();
    await expect(reloadedDialog.getByLabel("Telnet Port")).toHaveValue("6001");
    await expect(reloadedDialog.getByLabel("Terminal Font Size")).toHaveValue("15");
    await expect(reloadedDialog.getByLabel("SSH User Mapping JSON")).toHaveValue(
      /"custom_kind": "operator"/
    );
  });
});
