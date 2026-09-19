import { test, expect, type Page } from "@playwright/test";
const card = (page: Page, key: string) =>
  page.locator(`[data-setting-key="containerlab.${key}"]`);
async function search(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Search settings" }).fill(text);
}
test("covers the manifest, searches every category, saves and resets with scope inheritance", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/settings.html");
  await expect(page.locator("[data-setting-key]")).toHaveCount(33);
  await search(page, "telnetPort");
  const setting = card(page, "node.telnetPort");
  await setting.getByRole("spinbutton").fill("65536");
  await expect(
    setting.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await setting.getByRole("spinbutton").fill("5023");
  await setting.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  await page.getByRole("combobox", { name: "Save settings to" }).click();
  await page.getByRole("option", { name: "Workspace", exact: true }).click();
  await expect(setting.getByRole("spinbutton")).toHaveValue("5023");
  await setting.getByRole("spinbutton").fill("6000");
  await setting.getByRole("button", { name: "Save", exact: true }).click();
  await setting.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(setting.getByRole("spinbutton")).toHaveValue("5023");
  expect(errors).toEqual([]);
});
test("preserves drafts across navigation, blocks scope loss, and detects external edits", async ({
  page,
}) => {
  await page.goto("/settings.html");
  const binary = card(page, "binaryPath");
  await binary.getByRole("textbox").fill("/usr/local/bin/clab");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page
    .getByRole("button", {
      name: "General & Runtime",
      exact: true,
    })
    .click();
  await expect(binary.getByRole("textbox")).toHaveValue("/usr/local/bin/clab");
  await page.getByRole("combobox", { name: "Save settings to" }).click();
  await page.getByRole("option", { name: "Workspace", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.evaluate(() =>
    (window as any).settingsHarness.external(
      "containerlab.binaryPath",
      "/opt/clab",
    ),
  );
  await expect(
    binary.getByText("The saved value changed elsewhere.", { exact: false }),
  ).toBeVisible();
  await expect(
    binary.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await binary.getByRole("button", { name: "Use latest" }).click();
  await expect(binary.getByRole("textbox")).toHaveValue("/opt/clab");
});
test("edits mappings and templates, preserves advanced JSON, and reports save failures", async ({
  page,
}) => {
  await page.goto("/settings.html");
  await search(page, "sshUserMapping");
  const mapping = card(page, "node.sshUserMapping");
  await mapping.getByRole("button", { name: "Add mapping" }).click();
  await mapping.getByRole("textbox", { name: "Node kind 1" }).fill("linux");
  await mapping.getByRole("textbox", { name: "SSH user 1" }).fill("root");
  await page.evaluate(() => {
    (window as any).settingsHarness.failNext = true;
  });
  await mapping.getByRole("button", { name: "Save", exact: true }).click();
  await expect(mapping.getByRole("alert")).toContainText(
    "Could not write settings",
  );
  await mapping.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  await search(page, "customNodes");
  const templates = card(page, "editor.customNodes");
  await templates.getByRole("button", { name: "Edit JSON" }).click();
  await templates
    .getByRole("textbox", { name: "Custom node templates JSON" })
    .fill('[{"name":"Linux","kind":"linux","env":{"KEEP":"yes"}}]');
  await templates.getByRole("button", { name: "Form editor" }).click();
  await templates
    .getByRole("textbox", { name: "Name · 1", exact: true })
    .fill("My Linux");
  await templates.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  expect(
    await page.evaluate(
      () =>
        (window as any).settingsHarness.saved.user[
          "containerlab.editor.customNodes"
        ],
    ),
  ).toEqual([{ name: "My Linux", kind: "linux", env: { KEEP: "yes" } }]);
});
test("applies appearance live and stays usable at narrow widths", async ({
  page,
}) => {
  await page.goto("/settings.html");
  await search(page, "colorScheme");
  const scheme = card(page, "appearance.colorScheme");
  await scheme.getByRole("button", { name: "Light", exact: true }).click();
  await scheme.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.body)
          .getPropertyValue("--clab-ui-editor-background")
          .trim(),
      ),
    )
    .toBe("#ffffff");
  await scheme.getByRole("button", { name: "Reset", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.body)
          .getPropertyValue("--clab-ui-editor-background")
          .trim(),
      ),
    )
    .toBe("#000000");
  await search(page, "");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const fontSize = card(page, "appearance.fontSize");
  const label = fontSize.getByRole("heading");
  const originalSize = await label.evaluate((element) =>
    parseFloat(getComputedStyle(element).fontSize),
  );
  await fontSize.getByRole("spinbutton").fill("18");
  await fontSize.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() =>
      label.evaluate((element) =>
        parseFloat(getComputedStyle(element).fontSize),
      ),
    )
    .toBeGreaterThan(originalSize);
  await fontSize.getByRole("button", { name: "Reset", exact: true }).click();
  await expect
    .poll(() =>
      label.evaluate((element) =>
        parseFloat(getComputedStyle(element).fontSize),
      ),
    )
    .toBe(originalSize);
  await page.screenshot({
    path: "/tmp/containerlab-settings-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 480, height: 800 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await expect(card(page, "appearance.fontSize")).toBeVisible();
  await page.screenshot({
    path: "/tmp/containerlab-settings-narrow.png",
    fullPage: true,
  });
});

test("distinguishes modified settings in the current view and across all categories", async ({
  page,
}) => {
  await page.goto("/settings.html");
  await page.evaluate(() => {
    const harness = (window as any).settingsHarness;
    harness.external("containerlab.binaryPath", "/opt/clab");
    harness.external("containerlab.runtime", "podman");
    harness.external("containerlab.appearance.fontSize", 15);
  });
  const here = page.getByRole("button", {
    name: "Modified in this view: 2",
    exact: true,
  });
  const all = page.getByRole("button", {
    name: "Modified across all settings: 3",
    exact: true,
  });
  await expect(here).toBeVisible();
  await expect(all).toBeVisible();
  await here.click();
  await expect(page.locator("[data-setting-key]:visible")).toHaveCount(2);
  await expect(card(page, "appearance.fontSize")).toBeHidden();
  await all.click();
  await expect(page.locator("[data-setting-key]:visible")).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "All modified settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Appearance", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Modified in this view: 1", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-setting-key]:visible")).toHaveCount(1);
  await card(page, "appearance.fontSize")
    .getByRole("button", { name: "Reset", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Modified in this view: 0", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Modified across all settings: 2",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Save settings to" }).click();
  await page.getByRole("option", { name: "Workspace", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Modified across all settings: 0",
      exact: true,
    }),
  ).toBeVisible();
});

test("uses compact rows on wide editors and a scrollable layout on narrow editors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/settings.html");
  await expect(page.getByTestId("settings-layout")).toBeVisible();
  const bounds = await card(page, "binaryPath").boundingBox();
  expect(bounds!.width).toBeGreaterThan(1100);
  expect(bounds!.height).toBeLessThan(120);
  const label = await card(page, "binaryPath")
    .getByRole("heading")
    .boundingBox();
  const input = await card(page, "binaryPath")
    .getByRole("textbox")
    .boundingBox();
  expect(input!.x).toBeGreaterThan(label!.x + label!.width);
  await page.screenshot({ path: "/tmp/containerlab-settings-v2-general.png" });
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.screenshot({
    path: "/tmp/containerlab-settings-v2-appearance.png",
  });
  await page.setViewportSize({ width: 420, height: 720 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await card(page, "appearance.reduceMotion").scrollIntoViewIfNeeded();
  await expect(
    card(page, "appearance.reduceMotion").getByRole("switch"),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/containerlab-settings-v2-narrow.png" });
});
