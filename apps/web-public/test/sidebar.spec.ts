import { expect, test } from "@playwright/test";

test("only the hovered rail item animates, without resizing the rail or editor", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => localStorage.setItem("clab-pages-sandbox-files-v1", JSON.stringify({
    "motion.clab.yml": "name: motion\ntopology:\n  nodes:\n    router1:\n      kind: linux\n      image: alpine:latest\n    router2:\n      kind: linux\n      image: alpine:latest\n  links:\n    - endpoints: [router1:eth1, router2:eth1]\n"
  })));
  await page.goto("/");
  await expect(page.getByTestId("workspace-rail")).toBeVisible({ timeout: 30_000 });
  const rail = page.getByTestId("workspace-rail");
  await page.mouse.move(400, 200);
  await rail.getByRole("button", { name: "Labs", exact: true }).click();
  await page.getByTestId("workspace-sidebar").getByText("motion.clab.yml", { exact: true }).click();
  await page.getByRole("button", { name: "Close explorer", exact: true }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(rail).toHaveCSS("width", "48px");
  const editor = page.getByTestId("topoviewer-editor");
  const bounds = await editor.boundingBox();
  await rail.getByRole("button", { name: "Files", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(rail.getByRole("button", { name: "Labs", exact: true })).toHaveCSS("width", "36px");
  // Sample actual display frames, not just the animation's final state.
  const samples = await rail.evaluate(async (element) => {
    const editor = document.querySelector("[data-testid='topoviewer-editor']")!;
    const button = element.querySelector<HTMLButtonElement>("button[aria-label='Labs']")!;
    button.focus();
    const frames: Array<{ width: number; opacity: number; railWidth: number; editorX: number; editorWidth: number }> = [];
    for (let frame = 0; frame < 18; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const rect = editor.getBoundingClientRect();
      frames.push({ width: button.getBoundingClientRect().width, opacity: Number(getComputedStyle(button.querySelector("[data-testid='rail-item-surface']")!).opacity), railWidth: element.getBoundingClientRect().width, editorX: rect.x, editorWidth: rect.width });
    }
    button.blur();
    return frames;
  });
  expect(samples.some(({ opacity }) => opacity > 0 && opacity < 1)).toBe(true);
  expect(samples.some(({ width }) => width > 36 && width < samples.at(-1)!.width)).toBe(true);
  expect(samples.at(-1)!.width).toBeGreaterThan(36);
  expect(samples.every(({ railWidth }) => railWidth === 48)).toBe(true);
  expect(samples.every(({ editorX, editorWidth }) => editorX === bounds!.x && editorWidth === bounds!.width)).toBe(true);
  await expect(rail).toHaveCSS("width", "48px");
  await page.mouse.move(24, 72);
  const labs = rail.getByRole("button", { name: "Labs", exact: true });
  await expect(labs.getByTestId("rail-item-surface")).toHaveCSS("opacity", "1");
  await expect(rail.getByRole("button", { name: "Files", exact: true })).toHaveCSS("width", "36px");
  for (let index = 0; index < 4; index += 1) {
    await page.mouse.move(400, 200);
    await page.mouse.move(24, 72);
  }
  await page.mouse.move(400, 200);
  await expect(labs).toHaveCSS("width", "36px");
  await expect(rail).toHaveCSS("width", "48px");
  expect(await editor.boundingBox()).toEqual(bounds);
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(rail).toHaveCSS("width", "196px");
  await page.getByRole("button", { name: "Unpin", exact: true }).click();
  await expect(rail).toHaveCSS("width", "48px");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  expect(await editor.boundingBox()).toEqual(bounds);
});

test("hover labels fit their text even when page JavaScript cannot run", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("workspace-rail")).toBeVisible({ timeout: 30_000 });
  const rail = page.getByTestId("workspace-rail");
  await expect(rail).toBeVisible();
  await page.mouse.move(400, 200);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
  try {
    for (const label of ["Labs", "Files", "Help & Feedback", "Settings", "Pin"]) {
      const button = rail.getByRole("button", { name: label, exact: true });
      const bounds = (await button.boundingBox())!;
      await page.mouse.move(bounds.x + 18, bounds.y + 18);
      await expect(button.getByTestId("rail-item-surface")).toHaveCSS("opacity", "1");
      const sizes = await button.evaluate((element) => ({
        button: element.getBoundingClientRect().width,
        label: element.querySelector(".MuiTypography-root")!.getBoundingClientRect().width
      }));
      expect(sizes.button).toBeCloseTo(sizes.label + 56, 0);
      await expect(rail).toHaveCSS("width", "48px");
    }
  } finally {
    await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });
  }
});

test("pinning survives reload, unpins under the pointer and adapts to a narrow window", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("workspace-rail")).toBeVisible({ timeout: 30_000 });
  const rail = page.getByTestId("workspace-rail");
  const sidebar = page.getByTestId("workspace-sidebar");
  const initial = (await sidebar.boundingBox())!;
  await rail.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(rail).toHaveAttribute("data-pinned", "true");
  await expect(rail).toHaveCSS("width", "196px");
  expect((await sidebar.boundingBox())!.width).toBe(initial.width);
  await page.reload();
  await expect(rail).toBeVisible({ timeout: 30_000 });
  await expect(rail.getByRole("button", { name: "Unpin", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 600, height: 800 });
  await page.mouse.move(500, 300);
  await expect(rail).toHaveCSS("width", "48px");
  expect((await sidebar.boundingBox())!.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(rail).toHaveCSS("width", "196px");
  await rail.getByRole("button", { name: "Unpin", exact: true }).click();
  await expect(rail).toHaveCSS("width", "48px");
  await expect(rail).toHaveAttribute("data-pinned", "false");
  await page.reload();
  await expect(rail).toBeVisible({ timeout: 30_000 });
  await expect(rail.getByRole("button", { name: "Pin", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("carved labels fit each item and keep the surrounding explorer clickable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("workspace-rail")).toBeVisible({ timeout: 30_000 });
  const rail = page.getByTestId("workspace-rail");
  const labs = rail.getByRole("button", { name: "Labs", exact: true });
  const files = rail.getByRole("button", { name: "Files", exact: true });
  await labs.hover();
  const labsWidth = (await labs.boundingBox())!.width;
  await files.hover();
  await expect(labs).toHaveCSS("width", "36px");
  const filesWidth = (await files.boundingBox())!.width;
  expect(labsWidth).toBeGreaterThan(36);
  expect(filesWidth).toBeGreaterThan(36);
  await expect(rail).toHaveCSS("width", "48px");
  // The label itself belongs to the button, including the part outside the rail.
  await files.click({ position: { x: filesWidth - 8, y: 18 } });
  await expect(files).toHaveAttribute("aria-expanded", "true");
  await expect(files).toHaveCSS("width", "36px");
  await rail.getByRole("button", { name: "Help & Feedback", exact: true }).hover();
  await page.getByRole("button", { name: "Close explorer", exact: true }).click();
  await expect(files).toHaveAttribute("aria-expanded", "false");
  const before = (await rail.boundingBox())!;
  await rail.getByRole("button", { name: "Light mode", exact: true }).click();
  expect(await rail.boundingBox()).toEqual(before);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("closing the explorer preserves expanded folders and reopening works from the keyboard", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("clab-pages-sandbox-files-v1", JSON.stringify({ "folder/notes.txt": "notes" })));
  await page.goto("/");
  await expect(page.getByTestId("workspace-rail")).toBeVisible({ timeout: 30_000 });
  const rail = page.getByTestId("workspace-rail");
  const sidebar = page.getByTestId("workspace-sidebar");
  const files = rail.getByRole("button", { name: "Files", exact: true });
  await files.click();
  await sidebar.getByText("folder", { exact: true }).click();
  await expect(sidebar.getByText("notes.txt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close explorer", exact: true }).click();
  await expect(page.locator("#workspace-explorer")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#workspace-explorer")).toHaveCSS("width", "0px");
  await expect(files).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sidebar.getByText("notes.txt", { exact: true })).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  const labs = rail.getByRole("button", { name: "Labs", exact: true });
  await expect(labs).toBeFocused();
  await expect(labs.getByTestId("rail-item-surface")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Escape");
  await expect(labs).toHaveCSS("width", "36px");
  await expect(rail).toHaveCSS("width", "48px");
  await expect(labs).toBeFocused();
});

test("sidebar resize supports keyboard and pointer capture without losing its preferred width", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("workspace-rail")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Labs", exact: true }).click();
  const resize = page.getByRole("separator", { name: "Resize sidebar" });
  await resize.focus();
  await page.keyboard.press("ArrowRight");
  await expect(resize).toHaveAttribute("aria-valuenow", "300");
  const handle = (await resize.boundingBox())!;
  await page.mouse.move(handle.x + 2, handle.y + 150);
  await page.mouse.down();
  await page.mouse.move(handle.x + 82, handle.y + 150, { steps: 8 });
  await page.mouse.up();
  await expect(resize).toHaveAttribute("aria-valuenow", "380");
  const resizedHandle = (await resize.boundingBox())!;
  await page.mouse.move(resizedHandle.x + 2, resizedHandle.y + 150);
  await page.mouse.down();
  await page.mouse.move(resizedHandle.x + 82, resizedHandle.y + 150, { steps: 4 });
  await resize.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", isPrimary: true });
  await page.mouse.up();
  await expect(resize).toHaveAttribute("aria-valuenow", "380");
  await page.reload();
  await expect(page.getByTestId("workspace-rail")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Labs", exact: true }).click();
  await expect(resize).toHaveAttribute("aria-valuenow", "380");
  await page.setViewportSize({ width: 500, height: 700 });
  await expect(resize).toHaveAttribute("aria-valuenow", "250");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(resize).toHaveAttribute("aria-valuenow", "380");
  await resize.focus();
  await page.keyboard.press("Home");
  await expect(resize).toHaveAttribute("aria-valuenow", "280");
  await page.keyboard.press("End");
  await expect(resize).toHaveAttribute("aria-valuenow", "640");
});

test("rail honors reduced motion and remains usable when storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage disabled", "SecurityError"); };
  });
  await page.goto("/");
  await expect(page.getByTestId("workspace-rail")).toBeVisible({ timeout: 30_000 });
  const rail = page.getByTestId("workspace-rail");
  await expect(rail.getByRole("button", { name: "Pin", exact: true })).toHaveCSS("transition-duration", "0s");
  await rail.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(rail).toHaveCSS("width", "196px");
  await rail.getByRole("button", { name: "Unpin", exact: true }).click();
  await expect(rail).toHaveCSS("width", "48px");
});
