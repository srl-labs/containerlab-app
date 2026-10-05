import { createTopologyFile, expect, test, waitForWorkspace } from "@srl-labs/containerlab-test-kit/playwright";

test("local backend uses shared dialogs, document tabs, keyboard navigation and settings", async ({ page }) => {
  await page.goto("/");
  await waitForWorkspace(page);
  await expect(page.getByTestId("workspace-sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Deploy Lab File", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Manage Images", exact: true })).toHaveCount(0);
  await createTopologyFile(page, "first");
  await createTopologyFile(page, "second");
  const first = page.getByRole("tab", { name: "first", exact: true });
  const second = page.getByRole("tab", { name: "second", exact: true });
  await second.focus();
  await page.keyboard.press("ArrowUp");
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
  await settings.getByRole("combobox", { name: "Color theme" }).click();
  await page.getByRole("option", { name: "Light", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Dark mode", exact: true })).toBeVisible();
});

test("toolbar and YAML panel stay usable in a narrow workspace", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto("/");
  await waitForWorkspace(page);
  await createTopologyFile(page, "narrow");
  await page.getByRole("button", { name: "Close explorer", exact: true }).click();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByText("Lab Settings", { exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("navbar-split-view").click();
  await expect(page.getByTestId("panel-tab-yaml")).toBeVisible();
  const sidebar = (await page.getByTestId("workspace-sidebar").boundingBox())!;
  const panel = (await page.getByTestId("context-panel").boundingBox())!;
  expect(panel.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
});

test("dotted artwork stays present during resizing and reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await waitForWorkspace(page);
  const emptyState = page.getByTestId("standalone-empty-lab-state");
  const artwork = page.getByTestId("empty-state-artwork");
  const waves = page.getByTestId("empty-state-waves");
  await expect(waves).toBeVisible();

  const frames = await emptyState.evaluate(async (host) => {
    const svg = host.querySelector("svg")!;
    const path = svg.querySelector("path")!;
    const canvas = host.querySelector("canvas")!;
    const originalWidth = host.style.width;
    const width = host.getBoundingClientRect().width;
    const samples: Array<{ present: boolean; width: number }> = [];
    try {
      for (let index = 0; index < 24; index += 1) {
        host.style.width = `${width - (index % 2) * 12}px`;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        samples.push({
          present: svg.isConnected && svg.querySelector("path") === path && canvas.isConnected && getComputedStyle(canvas).display !== "none",
          width: canvas.getBoundingClientRect().width
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
  await expect(waves).toBeHidden();
  await createTopologyFile(page, "artwork-lifecycle", { fromEmptyState: true });
  await expect(emptyState).toBeHidden();
  await page.getByRole("tab", { name: "artwork-lifecycle", exact: true }).hover();
  await page.getByRole("button", { name: "Close artwork-lifecycle", exact: true }).click();
  await expect(artwork).toBeVisible();
});

test("shared sidebar resizes independently of the floating palette and toolbar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await waitForWorkspace(page);
  await createTopologyFile(page, "rail", { fromEmptyState: true });
  await page.getByRole("button", { name: "Unlock lab to edit", exact: true }).click();
  const sidebar = page.getByTestId("workspace-sidebar");
  // Empty labs open the palette on the right by default.
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.locator(".react-flow__pane").click({ button: "right", position: { x: 120, y: 160 } });
  await page.getByText("Open Palette", { exact: true }).click();
  const panel = page.getByTestId("context-panel");
  const drawer = page.getByTestId("context-panel-surface");
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

  await page.getByRole("button", { name: "Close explorer", exact: true }).click();
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
  expect(panelBounds.x).toBeGreaterThanOrEqual(editor.x);
  expect(panelBounds.y).toBeGreaterThanOrEqual(editor.y);

  const rightHandle = (await panelResize.boundingBox())!;
  await page.mouse.move(rightHandle.x + rightHandle.width / 2, rightHandle.y + 200);
  await page.mouse.down();
  await page.mouse.move(editor.x, rightHandle.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect(drawer).toHaveCSS("width", `${Math.floor(editor.width / 2)}px`);

  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await page.getByRole("button", { name: "Open panel", exact: true }).click();
  await expect(drawer).toBeVisible();

  await page.getByRole("tab", { name: "rail", exact: true }).focus();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("button", { name: "Open panel", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create a lab", exact: true })).toBeVisible();
});

test("file tabs replace the canvas, guard unsaved edits and restore topology controls", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("clab-pages-sandbox-files-v1", JSON.stringify({ "notes.txt": "workspace notes\n" }))
  );
  await page.goto("/");
  await waitForWorkspace(page);
  await createTopologyFile(page, "files", { fromEmptyState: true });
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.getByTestId("workspace-sidebar").getByText("notes.txt", { exact: true }).click();
  await page.getByRole("button", { name: "Close explorer", exact: true }).click();
  const editor = page.getByTestId("file-editor-tab-panel");
  await expect(editor).toBeVisible();
  await expect(page.getByTestId("navbar-lock")).toHaveCount(0);
  await expect(page.locator(".react-flow")).toBeHidden();
  const tab = page.getByRole("tab", { name: /notes.txt/ });
  await expect(tab).toHaveAttribute("aria-selected", "true");

  await editor.getByRole("textbox", { name: "Editor content", exact: true }).focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.insertText("updated workspace notes");
  await expect(page.getByTestId("file-editor-tab-save")).toBeEnabled();
  await tab.hover();
  await page.getByRole("button", { name: "Close notes.txt", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Discard Unsaved Changes" });
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeVisible();
  await page.getByTestId("file-editor-tab-save").click();
  await expect(page.getByTestId("file-editor-tab-save")).toBeDisabled();
  await expect.poll(() => page.evaluate(() =>
    (JSON.parse(localStorage.getItem("clab-pages-sandbox-files-v1") ?? "{}") as Record<string, string>)["notes.txt"]
  )).toBe("updated workspace notes");

  await tab.hover();
  await page.getByRole("button", { name: "Close notes.txt", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByTestId("navbar-lock")).toBeVisible();
  await expect(page.locator(".react-flow")).toBeVisible();
});

test("the sandbox lists its topology files without any running-lab concepts", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("clab-pages-sandbox-files-v1", JSON.stringify({
      "plain.clab.yml": "name: plain\ntopology:\n  nodes:\n    router1:\n      kind: linux\n      image: alpine:latest\n"
    }))
  );
  await page.goto("/");
  await waitForWorkspace(page);
  await page.getByTestId("workspace-rail").getByRole("button", { name: "Labs", exact: true }).click();
  const sidebar = page.getByTestId("workspace-sidebar");
  await expect(sidebar.getByText("plain.clab.yml", { exact: true })).toBeVisible();
  for (const text of ["Connected", "Undeployed Labs", "Running Labs", "Endpoints"]) {
    await expect(sidebar.getByText(text, { exact: false })).toHaveCount(0);
  }
  await sidebar.getByText("plain.clab.yml", { exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(page.locator(".topology-node-runtime-badge")).toHaveCount(0);
  await expect(page.getByTestId("navbar-deploy")).toHaveCount(0);
});
