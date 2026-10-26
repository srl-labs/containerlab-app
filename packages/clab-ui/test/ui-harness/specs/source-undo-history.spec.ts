import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

const FILE = "simple.clab.yml";
const FIRST_LINE = "name: simple";

type MonacoDebugWindow = Window & {
  __clabMonacoDebug?: {
    editor: {
      focus: () => void;
      getPosition: () => { lineNumber: number; column: number } | null;
    };
    model: { getValue: () => string };
    setValue: (value: string) => void;
    setPosition: (lineNumber: number, column: number) => void;
  };
};

async function openSourceTab(page: Page, tab: "yaml" | "json"): Promise<void> {
  await page.getByTestId("navbar-split-view").click();
  await page.getByTestId(`panel-tab-${tab}`).click();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => Boolean((window as MonacoDebugWindow).__clabMonacoDebug));
}

function sourceValue(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as MonacoDebugWindow).__clabMonacoDebug?.model.getValue());
}

function cursor(page: Page): Promise<{ lineNumber: number; column: number } | null | undefined> {
  return page.evaluate(() => (window as MonacoDebugWindow).__clabMonacoDebug?.editor.getPosition());
}

/** Types with the keyboard at the end of the first line. */
async function typeOnFirstLine(page: Page, text: string): Promise<void> {
  await page.evaluate((column) => {
    (window as MonacoDebugWindow).__clabMonacoDebug?.setPosition(1, column);
  }, FIRST_LINE.length + 1);
  await page.keyboard.type(text);
}

function withFirstLine(content: string, suffix: string): string {
  return content.replace(FIRST_LINE, `${FIRST_LINE}${suffix}`);
}

test.describe("One undo history for the source tabs and the canvas", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
  });

  test("the navbar undoes source typing and canvas edits in order", async ({
    page,
    topoViewerPage
  }) => {
    await openSourceTab(page, "yaml");
    const saved = await topoViewerPage.getYamlFromFile(FILE);
    const nodeCount = await topoViewerPage.getNodeCount();
    const save = page.getByTitle("Save");

    await typeOnFirstLine(page, " # one");
    await expect(save).toBeEnabled();
    await topoViewerPage.createNode("srl3", { x: 420, y: 320 });
    await expect.poll(() => topoViewerPage.getNodeCount()).toBe(nodeCount + 1);
    await expect.poll(() => topoViewerPage.getYamlFromFile(FILE)).toContain("srl3:");
    // The typing is still a draft over the file the canvas changed.
    await expect(page.getByTestId("palette-source-stale")).toBeVisible();

    await topoViewerPage.undo();
    await expect.poll(() => topoViewerPage.getNodeCount()).toBe(nodeCount);
    await expect.poll(() => topoViewerPage.getYamlFromFile(FILE)).toBe(saved);
    await expect.poll(() => sourceValue(page)).toBe(withFirstLine(saved, " # one"));
    await expect(page.getByTestId("palette-source-stale")).toHaveCount(0);

    await topoViewerPage.undo();
    await expect.poll(() => sourceValue(page)).toBe(saved);
    await expect(save).toBeDisabled();
    await expect.poll(() => topoViewerPage.canUndo()).toBe(false);

    await topoViewerPage.redo();
    await expect.poll(() => sourceValue(page)).toBe(withFirstLine(saved, " # one"));
    await expect.poll(() => topoViewerPage.getNodeCount()).toBe(nodeCount);
    await topoViewerPage.redo();
    await expect.poll(() => topoViewerPage.getNodeCount()).toBe(nodeCount + 1);
    await expect.poll(() => topoViewerPage.getYamlFromFile(FILE)).toContain("srl3:");
    await expect.poll(() => sourceValue(page)).toBe(withFirstLine(saved, " # one"));
  });

  test("undo in the source editor walks back into canvas edits", async ({
    page,
    topoViewerPage
  }) => {
    const saved = await topoViewerPage.getYamlFromFile(FILE);
    const nodeCount = await topoViewerPage.getNodeCount();
    await topoViewerPage.createNode("srl3", { x: 420, y: 320 });
    await expect.poll(() => topoViewerPage.getNodeCount()).toBe(nodeCount + 1);
    const withNode = await topoViewerPage.getYamlFromFile(FILE);

    await openSourceTab(page, "yaml");
    await expect.poll(() => sourceValue(page)).toBe(withNode);
    await typeOnFirstLine(page, " # one");

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => sourceValue(page)).toBe(withNode);
    await expect(page.getByTitle("Save")).toBeDisabled();

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => topoViewerPage.getNodeCount()).toBe(nodeCount);
    await expect.poll(() => topoViewerPage.getYamlFromFile(FILE)).toBe(saved);
    await expect.poll(() => sourceValue(page)).toBe(saved);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => topoViewerPage.getNodeCount()).toBe(nodeCount + 1);
    await expect.poll(() => sourceValue(page)).toBe(withNode);
    await page.keyboard.press("ControlOrMeta+y");
    await expect.poll(() => sourceValue(page)).toBe(withFirstLine(withNode, " # one"));
    await expect.poll(() => topoViewerPage.getYamlFromFile(FILE)).toBe(withNode);
  });

  test("a typing pause starts a new step and undo puts the cursor back", async ({
    page,
    topoViewerPage
  }) => {
    await openSourceTab(page, "yaml");
    const saved = await topoViewerPage.getYamlFromFile(FILE);

    await typeOnFirstLine(page, " # a");
    await page.waitForTimeout(1300);
    await page.keyboard.type("bc");
    await expect.poll(() => sourceValue(page)).toBe(withFirstLine(saved, " # abc"));

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => sourceValue(page)).toBe(withFirstLine(saved, " # a"));
    await expect.poll(() => cursor(page)).toEqual({ lineNumber: 1, column: FIRST_LINE.length + 5 });

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => sourceValue(page)).toBe(saved);
    await expect.poll(() => cursor(page)).toEqual({ lineNumber: 1, column: FIRST_LINE.length + 1 });

    await page.keyboard.press("ControlOrMeta+y");
    await expect.poll(() => sourceValue(page)).toBe(withFirstLine(saved, " # a"));
    await expect.poll(() => cursor(page)).toEqual({ lineNumber: 1, column: FIRST_LINE.length + 5 });
  });

  test("invalid YAML drafts undo and redo like any other text", async ({
    page,
    topoViewerPage
  }) => {
    await openSourceTab(page, "yaml");
    const saved = await topoViewerPage.getYamlFromFile(FILE);
    const invalid = withFirstLine(saved, ": broken");

    await typeOnFirstLine(page, ": broken");
    await expect.poll(() => sourceValue(page)).toBe(invalid);
    await expect.poll(() => topoViewerPage.getYamlFromFile(FILE)).toBe(saved);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => sourceValue(page)).toBe(saved);
    await page.keyboard.press("ControlOrMeta+y");
    await expect.poll(() => sourceValue(page)).toBe(invalid);
  });

  test("undoing a save restores the file and keeps the text as a draft", async ({
    page,
    topoViewerPage
  }) => {
    await openSourceTab(page, "yaml");
    const saved = await topoViewerPage.getYamlFromFile(FILE);
    const edited = withFirstLine(saved, " # saved");
    const save = page.getByTitle("Save");

    await typeOnFirstLine(page, " # saved");
    await save.click();
    await expect.poll(() => topoViewerPage.getYamlFromFile(FILE)).toBe(edited);
    await expect(save).toBeDisabled();

    await topoViewerPage.undo();
    await expect.poll(() => topoViewerPage.getYamlFromFile(FILE)).toBe(saved);
    await expect.poll(() => sourceValue(page)).toBe(edited);
    await expect(save).toBeEnabled();

    await topoViewerPage.undo();
    await expect.poll(() => sourceValue(page)).toBe(saved);
    await expect(save).toBeDisabled();

    await topoViewerPage.redo();
    await topoViewerPage.redo();
    await expect.poll(() => topoViewerPage.getYamlFromFile(FILE)).toBe(edited);
    await expect.poll(() => sourceValue(page)).toBe(edited);
    await expect(save).toBeDisabled();
  });

  test("JSON tab edits share the history with YAML tab edits", async ({ page, topoViewerPage }) => {
    await openSourceTab(page, "yaml");
    const savedYaml = await topoViewerPage.getYamlFromFile(FILE);
    await typeOnFirstLine(page, " # yaml");

    await page.getByTestId("panel-tab-json").click();
    await page.waitForFunction(
      () => (window as MonacoDebugWindow).__clabMonacoDebug?.model.getValue().trimStart().startsWith("{")
    );
    const savedJson = (await sourceValue(page)) ?? "";
    await page.evaluate(() => {
      (window as MonacoDebugWindow).__clabMonacoDebug?.setPosition(1, 2);
    });
    await page.keyboard.type(" ");
    await expect.poll(() => sourceValue(page)).not.toBe(savedJson);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => sourceValue(page)).toBe(savedJson);
    // The next step back is the YAML typing, though its tab is closed.
    await page.keyboard.press("ControlOrMeta+z");
    await page.getByTestId("panel-tab-yaml").click();
    await page.waitForFunction(
      () => (window as MonacoDebugWindow).__clabMonacoDebug?.model.getValue().startsWith("name:")
    );
    await expect.poll(() => sourceValue(page)).toBe(savedYaml);
    await expect.poll(() => topoViewerPage.canUndo()).toBe(false);
  });
});
