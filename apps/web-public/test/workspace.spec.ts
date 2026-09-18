import { expect, test, type Page } from "@playwright/test";

async function createLab(page: Page, name: string, fromEmptyState = false) {
  await page.getByRole("button", { name: fromEmptyState ? "Create a lab" : "New Topology File", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Topology file name" }).fill(`${name}.clab.yml`);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("tab", { name: `${name} Close ${name}`, exact: true })).toHaveAttribute("aria-selected", "true");
}

test("local backend uses shared dialogs, document tabs, keyboard navigation and settings", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByTestId("workspace-sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Deploy Lab File", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Manage Images", exact: true })).toHaveCount(0);
  await createLab(page, "first");
  await createLab(page, "second");
  const first = page.getByRole("tab", { name: "first Close first", exact: true });
  const second = page.getByRole("tab", { name: "second Close second", exact: true });
  await second.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(second).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Delete");
  await expect(second).toHaveCount(0);
  await expect(first).toBeFocused();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByTestId("standalone-settings-dialog");
  await expect(settings).toBeVisible();
  await expect(page.getByTestId("standalone-settings-nav-endpoints")).toHaveCount(0);
  await expect(page.getByTestId("standalone-settings-nav-terminal")).toHaveCount(0);
  await page.getByTestId("standalone-settings-theme-light").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Dark mode", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("toolbar and YAML panel stay usable in a narrow workspace", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto("/");
  await createLab(page, "narrow");
  await page.getByRole("button", { name: "Close explorer", exact: true }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByText("Lab Settings", { exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("navbar-split-view").click();
  await expect(page.getByTestId("panel-tab-yaml")).toBeVisible();
  const tabs = await page.getByTestId("lab-tabs").boundingBox();
  const panel = await page.getByTestId("context-panel").boundingBox();
  expect(panel!.y).toBeGreaterThanOrEqual(tabs!.y + tabs!.height);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
});

test("dotted artwork stays present during resizing and reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const emptyState = page.getByTestId("standalone-empty-lab-state");
  const artwork = page.getByTestId("empty-state-artwork");
  await expect(artwork).toBeVisible();
  await expect(emptyState.locator("canvas, img")).toHaveCount(0);

  const frames = await emptyState.evaluate(async (host) => {
    const svg = host.querySelector("svg")!;
    const path = svg.querySelector("path")!;
    const originalWidth = host.style.width;
    const width = host.getBoundingClientRect().width;
    const samples: Array<{ present: boolean; width: number }> = [];
    try {
      for (let index = 0; index < 24; index += 1) {
        host.style.width = `${width - (index % 2) * 12}px`;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        samples.push({
          present: svg.isConnected && svg.querySelector("path") === path && Number(getComputedStyle(path).opacity) > 0,
          width: svg.getBoundingClientRect().width
        });
      }
      return samples;
    } finally {
      host.style.width = originalWidth;
    }
  });
  expect(new Set(frames.map((frame) => frame.width)).size).toBeGreaterThan(1);
  expect(frames.every((frame) => frame.present)).toBe(true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(artwork).toBeVisible();
  await expect(emptyState.locator("canvas, img")).toHaveCount(0);
  await createLab(page, "artwork-lifecycle", true);
  await expect(emptyState).toBeHidden();
  await page.getByRole("button", { name: "Close artwork-lifecycle", exact: true }).click();
  await expect(artwork).toBeVisible();
});

test("shared sidebar resizes independently of the floating palette and toolbar", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Close explorer", exact: true }).click();
  await createLab(page, "rail", true);
  await page.getByRole("button", { name: "Unlock lab to edit", exact: true }).click();
  const sidebar = page.getByTestId("workspace-sidebar");
  await expect(sidebar.getByRole("button", { name: "Node palette", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: /Move sidebar/ })).toHaveCount(0);
  // Empty labs open the palette on the right by default.
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.locator(".react-flow__pane").click({ button: "right", position: { x: 120, y: 160 } });
  await page.getByText("Open Palette", { exact: true }).click();
  const panel = page.getByTestId("context-panel");
  const drawer = panel.locator(".MuiDrawer-paper");
  await expect(panel.getByText("Node Templates", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Move panel to left", exact: true }).click();
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Create Node Template" })).toHaveCount(1);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();

  await sidebar.getByRole("button", { name: "Labs", exact: true }).click();
  const resize = sidebar.getByRole("separator", { name: "Resize sidebar" });
  await resize.focus();
  await page.keyboard.press("ArrowRight");
  await expect(resize).toHaveAttribute("aria-valuenow", "300");
  const handle = (await resize.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect(resize).toHaveAttribute("aria-valuenow", "340");

  const sidebarBounds = (await sidebar.boundingBox())!;
  const editor = (await page.getByTestId("topoviewer-editor").boundingBox())!;
  expect(sidebarBounds.x).toBe(0);
  expect(editor.x).toBe(sidebarBounds.x + sidebarBounds.width);
  await expect(drawer).toHaveCSS("left", "0px");

  const panelResize = page.getByTestId("context-panel-resize-handle");
  const panelHandle = (await panelResize.boundingBox())!;
  await page.mouse.move(panelHandle.x + panelHandle.width / 2, panelHandle.y + 200);
  await page.mouse.down();
  await page.mouse.move(editor.x + 520, panelHandle.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect(drawer).toHaveCSS("width", "520px");

  await page.getByTestId("navbar-split-view").click();
  await expect(panel.getByTestId("panel-tab-yaml")).toBeVisible();
  await page.getByRole("button", { name: "Move panel to right", exact: true }).click();
  await expect(drawer).toHaveCSS("right", "0px");
  expect(await sidebar.boundingBox()).toEqual(sidebarBounds);
  const toolbar = (await page.getByTestId("topoviewer-navbar").boundingBox())!;
  const panelBounds = (await drawer.boundingBox())!;
  expect(toolbar.x).toBeGreaterThanOrEqual(editor.x);
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(panelBounds.x);
  const tabs = (await page.getByTestId("lab-tabs").boundingBox())!;
  expect(panelBounds.y).toBeGreaterThanOrEqual(tabs.y + tabs.height);

  const rightHandle = (await panelResize.boundingBox())!;
  await page.mouse.move(rightHandle.x + rightHandle.width / 2, rightHandle.y + 200);
  await page.mouse.down();
  await page.mouse.move(editor.x, rightHandle.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect(drawer).toHaveCSS("width", `${Math.floor(editor.width / 2)}px`);

  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.getByRole("button", { name: "Open panel", exact: true }).click();
  await expect(drawer).toBeVisible();

  await page.getByRole("button", { name: "Close rail", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open panel", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create a lab", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
