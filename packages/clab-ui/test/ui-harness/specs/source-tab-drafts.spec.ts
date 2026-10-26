import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

const FILE = "simple.clab.yml";
const ANNOTATIONS_FILE = "simple.clab.yml.annotations.json";

type MonacoDebugWindow = Window & {
  __clabMonacoDebug?: { setValue: (value: string) => void; model: { getValue: () => string } };
};

async function openSourceTab(page: Page, tab: "yaml" | "json"): Promise<void> {
  await page.getByTestId("navbar-split-view").click();
  await page.getByTestId(`panel-tab-${tab}`).click();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => Boolean((window as MonacoDebugWindow).__clabMonacoDebug));
}

async function typeSource(page: Page, value: string): Promise<void> {
  await page.evaluate((content) => {
    (window as MonacoDebugWindow).__clabMonacoDebug?.setValue(content);
  }, value);
}

function sourceValue(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as MonacoDebugWindow).__clabMonacoDebug?.model.getValue());
}

test.describe("Source tab drafts", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
  });

  test("the JSON tab edits the annotations file it names", async ({ page, topoViewerPage }) => {
    await openSourceTab(page, "json");
    await expect(page.getByTestId("panel-tab-json")).toHaveAttribute(
      "title",
      `Annotations file: ${ANNOTATIONS_FILE}`
    );
    await expect(page.getByTestId("context-panel").getByText(ANNOTATIONS_FILE)).toBeVisible();

    const annotations = JSON.parse((await sourceValue(page)) ?? "{}") as Record<string, unknown>;
    annotations.freeTextAnnotations = [{ id: "note-1", text: "Hello", position: { x: 40, y: 40 } }];
    await typeSource(page, JSON.stringify(annotations, null, 2));
    await page.getByTitle("Save").click();

    await expect(page.locator(".react-flow__node-free-text-node")).toHaveCount(1);
    const saved = await topoViewerPage.getAnnotationsFromFile(FILE);
    expect(saved.freeTextAnnotations?.map((text) => text.id)).toEqual(["note-1"]);
  });

  test("editing back to the saved text leaves nothing to save", async ({ page }) => {
    await openSourceTab(page, "yaml");
    const saved = (await sourceValue(page)) ?? "";
    const save = page.getByTitle("Save");

    await typeSource(page, `${saved}# note\n`);
    await expect(save).toBeEnabled();
    await typeSource(page, saved);
    await expect(save).toBeDisabled();
  });

  test("unsaved edits say when the file changed underneath them", async ({
    page,
    topoViewerPage
  }) => {
    await openSourceTab(page, "yaml");
    const saved = (await sourceValue(page)) ?? "";
    await typeSource(page, `${saved}# note\n`);
    await expect(page.getByTestId("palette-source-stale")).toHaveCount(0);

    // A canvas edit, an undo or another editor changes the file.
    const changed = saved.replace("name: simple", "name: simple-renamed");
    await topoViewerPage.writeYamlFile(FILE, changed);
    await expect(page.getByTestId("palette-source-stale")).toBeVisible();

    await page.getByRole("button", { name: "Discard edits" }).click();
    await expect.poll(() => sourceValue(page)).toBe(changed);
    await expect(page.getByTestId("palette-source-stale")).toHaveCount(0);
    await expect(page.getByTitle("Save")).toBeDisabled();
  });

  test("a source tab opened while locked takes edits once unlocked", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.lock();
    await openSourceTab(page, "yaml");
    await expect(page.getByTestId("palette-source-readonly")).toBeVisible();
    await topoViewerPage.unlock();

    const saved = (await sourceValue(page)) ?? "";
    await typeSource(page, `${saved}# note\n`);
    await expect(page.getByTitle("Save")).toBeEnabled();
  });
});
