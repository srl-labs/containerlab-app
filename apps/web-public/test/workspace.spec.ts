import { expect, test, type Page } from "@playwright/test";

async function createLab(page: Page, name: string) {
  await page.getByRole("button", { name: "New Topology File", exact: true }).click();
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

test("animated empty-state logo stays painted during resizing and respects reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const emptyState = page.getByTestId("standalone-empty-lab-state");
  await expect(emptyState.locator("canvas")).toBeVisible();
  await expect(emptyState.getByRole("img", { name: "Containerlab" })).toBeHidden();
  expect(await emptyState.evaluate((host) =>
    host.querySelector("canvas")?.getContext("2d")?.getContextAttributes().desynchronized
  )).toBe(false);

  const frames = await emptyState.evaluate(async (host) => {
    const canvas = host.querySelector("canvas")!;
    const context = canvas.getContext("2d")!;
    const originalWidth = host.style.width;
    const width = host.getBoundingClientRect().width;
    const samples: Array<{ painted: boolean; width: number }> = [];
    try {
      for (let index = 0; index < 24; index += 1) {
        // Resize on consecutive display frames, including frames between the 30 fps redraws.
        host.style.width = `${width - (index % 2) * 12}px`;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const pixels = context.getImageData(
          Math.floor(canvas.width / 2) - 16,
          Math.floor(canvas.height / 2) - 16,
          32,
          32
        ).data;
        samples.push({
          painted: pixels.some((value, offset) => offset % 4 === 3 && value > 0),
          width: canvas.width
        });
      }
      return samples;
    } finally {
      host.style.width = originalWidth;
    }
  });
  expect(new Set(frames.map((frame) => frame.width)).size).toBeGreaterThan(1);
  expect(frames.every((frame) => frame.painted)).toBe(true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(emptyState.locator("canvas")).toBeHidden();
  await expect(emptyState.getByRole("img", { name: "Containerlab" })).toBeVisible();
});
