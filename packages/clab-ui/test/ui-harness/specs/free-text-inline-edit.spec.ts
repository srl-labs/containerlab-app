import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../fixtures/topoviewer";
import { rightClick } from "../helpers/react-flow-helpers";

const DATACENTER_FILE = "datacenter.clab.yml";

const SEL_INLINE_INPUT = '[data-testid="free-text-inline-input"]';
const SEL_INLINE_TOOLBAR = '[data-testid="free-text-inline-toolbar"]';
const SEL_INLINE_ITALIC = '[data-testid="inline-text-italic"]';
const SEL_INLINE_MORE = '[data-testid="inline-text-more"]';
const SEL_INLINE_PREVIEW = '[data-testid="free-text-inline-preview"]';
const SEL_ADD_TEXT_ITEM = '[data-testid="context-menu-item-add-text"]';
const SEL_EDIT_TEXT_ITEM = '[data-testid="context-menu-item-edit-text"]';
const SEL_APPLY_BTN = '[data-testid="panel-apply-btn"]';
const PANEL_TEXT_PLACEHOLDER = "Enter your text... (Markdown and fenced code blocks supported)";

interface FreeTextFileEntry {
  id: string;
  text: string;
  backgroundColor?: string;
  fontStyle?: string;
  fontSize?: number;
}

interface TopoViewerApi {
  resetFiles(): Promise<void>;
  gotoFile(filename: "datacenter.clab.yml"): Promise<void>;
  waitForCanvasReady(): Promise<void>;
  setEditMode(): Promise<void>;
  unlock(): Promise<void>;
  lock(): Promise<void>;
  fit(): Promise<void>;
  getCanvas(): Locator;
  getAnnotationsFromFile(
    filename: "datacenter.clab.yml"
  ): Promise<{ freeTextAnnotations?: FreeTextFileEntry[] }>;
}

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

async function setup(page: Page, api: TopoViewerApi) {
  await api.resetFiles();
  await api.gotoFile(DATACENTER_FILE);
  await api.waitForCanvasReady();
  await api.setEditMode();
  await api.unlock();
  await page.waitForTimeout(500);
  await api.fit();
  await page.waitForTimeout(300);
}

async function setupLocked(page: Page, api: TopoViewerApi) {
  await api.resetFiles();
  await api.gotoFile(DATACENTER_FILE);
  await api.waitForCanvasReady();
  await api.setEditMode();
  await api.lock();
  await page.waitForTimeout(500);
  await api.fit();
  await page.waitForTimeout(300);
}

async function getFirstTextAnnotation(api: TopoViewerApi): Promise<FreeTextFileEntry> {
  const annotations = await api.getAnnotationsFromFile(DATACENTER_FILE);
  const text = annotations.freeTextAnnotations?.[0];
  expect(text).toBeDefined();
  return text!;
}

async function getViewport(page: Page): Promise<Viewport> {
  const viewport = await page.evaluate(() => {
    return (
      window as {
        __DEV__?: { rfInstance?: { getViewport?: () => Viewport } };
      }
    ).__DEV__?.rfInstance?.getViewport?.();
  });
  expect(viewport).toBeDefined();
  return viewport!;
}

test.describe("Free Text Inline Editing", () => {
  test("double-click edits text inline and Escape commits", async ({ page, topoViewerPage }) => {
    const api = topoViewerPage as unknown as TopoViewerApi;
    await setup(page, api);
    const text = await getFirstTextAnnotation(api);

    const textElement = page.locator(`[data-id="${text.id}"] .free-text-content`).first();
    await expect(textElement).toBeVisible();
    await textElement.dblclick();

    const input = page.locator(SEL_INLINE_INPUT);
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(text.text);
    await expect(page.locator(SEL_INLINE_TOOLBAR)).toBeVisible();

    // The panel style editor must not hijack the annotation while editing inline.
    const panel = page.locator('[data-testid="context-panel"]');
    await expect(panel.getByText("Edit Text", { exact: true })).not.toBeVisible();

    await input.fill("Inline edited text");
    await input.press("Escape");
    await expect(input).not.toBeVisible();

    await expect
      .poll(
        async () => {
          const after = await api.getAnnotationsFromFile(DATACENTER_FILE);
          return after.freeTextAnnotations?.find((entry) => entry.id === text.id)?.text;
        },
        { timeout: 5000 }
      )
      .toBe("Inline edited text");
  });

  test("double-click edits text inline after locked click then unlock", async ({
    page,
    topoViewerPage
  }) => {
    const api = topoViewerPage as unknown as TopoViewerApi;
    await setupLocked(page, api);
    const text = await getFirstTextAnnotation(api);

    const textElement = page.locator(`[data-id="${text.id}"] .free-text-content`).first();
    const textNode = page.locator(`[data-id="${text.id}"] .free-text-node`).first();
    await expect(textElement).toBeVisible();
    await expect(textNode).toBeVisible();

    await textElement.click();
    await textElement.dblclick();
    await api.unlock();
    await page.waitForTimeout(300);
    const viewportBeforeDoubleClick = await getViewport(page);
    const textBox = await textNode.boundingBox();
    expect(textBox).not.toBeNull();
    await page.mouse.dblclick(textBox!.x + textBox!.width / 2, textBox!.y + textBox!.height / 2);

    const input = page.locator(SEL_INLINE_INPUT);
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(text.text);

    const viewportAfterDoubleClick = await getViewport(page);
    expect(viewportAfterDoubleClick.zoom).toBe(viewportBeforeDoubleClick.zoom);
  });

  test("context-menu Add Text creates annotation with inline editor, blur commits", async ({
    page,
    topoViewerPage
  }) => {
    const api = topoViewerPage as unknown as TopoViewerApi;
    await setup(page, api);

    const canvasBox = await api.getCanvas().boundingBox();
    expect(canvasBox).not.toBeNull();
    await rightClick(page, canvasBox!.x + 200, canvasBox!.y + 200);
    const addTextItem = page.locator(SEL_ADD_TEXT_ITEM);
    await expect(addTextItem).toBeVisible();
    await addTextItem.click();

    const input = page.locator(SEL_INLINE_INPUT);
    await expect(input).toBeVisible();
    await input.fill("Created inline");

    // Clicking elsewhere on the canvas blurs the editor and commits.
    await page.mouse.click(canvasBox!.x + 420, canvasBox!.y + 320);
    await expect(input).not.toBeVisible();

    await expect
      .poll(
        async () => {
          const after = await api.getAnnotationsFromFile(DATACENTER_FILE);
          return (after.freeTextAnnotations ?? []).some(
            (entry) => entry.text === "Created inline"
          );
        },
        { timeout: 5000 }
      )
      .toBe(true);

    const createdAnnotations = await api.getAnnotationsFromFile(DATACENTER_FILE);
    const createdText = createdAnnotations.freeTextAnnotations?.find(
      (entry) => entry.text === "Created inline"
    );
    expect(createdText).toBeDefined();

    const createdElement = page.locator(`[data-id="${createdText!.id}"] .free-text-content`).first();
    await createdElement.dblclick();
    await expect(input).toBeVisible();
    await expect(input).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    await input.fill("Created inline edited");
    await page.locator(SEL_INLINE_MORE).click();
    // The style drawer opens alongside; inline editing continues on the canvas.
    await expect(input).toBeVisible();

    const panel = page.locator('[data-testid="context-panel"]');
    await expect(panel.getByText("Edit Text", { exact: true })).toBeVisible();
    await expect(panel.getByRole("checkbox", { name: "No fill" })).toBeChecked();
    await expect(panel.getByPlaceholder(PANEL_TEXT_PLACEHOLDER)).toHaveValue(
      "Created inline edited"
    );

    await expect
      .poll(
        async () => {
          const after = await api.getAnnotationsFromFile(DATACENTER_FILE);
          return (
            after.freeTextAnnotations?.find((entry) => entry.id === createdText!.id)
              ?.backgroundColor ?? null
          );
        },
        { timeout: 5000 }
      )
      .toBeNull();
  });

  test("committing empty text deletes the annotation", async ({ page, topoViewerPage }) => {
    const api = topoViewerPage as unknown as TopoViewerApi;
    await setup(page, api);
    const text = await getFirstTextAnnotation(api);

    const textElement = page.locator(`[data-id="${text.id}"] .free-text-content`).first();
    await textElement.dblclick();

    const input = page.locator(SEL_INLINE_INPUT);
    await expect(input).toBeVisible();
    await input.fill("");
    await input.press("Escape");

    await expect
      .poll(
        async () => {
          const after = await api.getAnnotationsFromFile(DATACENTER_FILE);
          return (after.freeTextAnnotations ?? []).some((entry) => entry.id === text.id);
        },
        { timeout: 5000 }
      )
      .toBe(false);
  });

  test("inline toolbar italic toggles and persists without Apply", async ({
    page,
    topoViewerPage
  }) => {
    const api = topoViewerPage as unknown as TopoViewerApi;
    await setup(page, api);
    const text = await getFirstTextAnnotation(api);
    // The fixture annotation starts non-italic, so the toggle turns italic on.
    expect(text.fontStyle ?? "normal").toBe("normal");

    const textElement = page.locator(`[data-id="${text.id}"] .free-text-content`).first();
    await textElement.dblclick();

    await expect(page.locator(SEL_INLINE_TOOLBAR)).toBeVisible();
    await page.locator(SEL_INLINE_ITALIC).click();

    // The style change applies live to the editor before committing.
    const input = page.locator(SEL_INLINE_INPUT);
    await expect(input).toHaveCSS("font-style", "italic");
    await input.press("Escape");

    await expect
      .poll(
        async () => {
          const after = await api.getAnnotationsFromFile(DATACENTER_FILE);
          return after.freeTextAnnotations?.find((entry) => entry.id === text.id)?.fontStyle;
        },
        { timeout: 5000 }
      )
      .toBe("italic");
  });

  test("panel editor live-applies style changes without an Apply button", async ({
    page,
    topoViewerPage
  }) => {
    const api = topoViewerPage as unknown as TopoViewerApi;
    await setup(page, api);
    const text = await getFirstTextAnnotation(api);

    // Single click opens the panel style editor.
    const textElement = page.locator(`[data-id="${text.id}"] .free-text-content`).first();
    await textElement.click();

    const panel = page.locator('[data-testid="context-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Edit Text", { exact: true })).toBeVisible();

    const fontSizeInput = page.locator("#text-font-size");
    await expect(fontSizeInput).toBeVisible();
    await fontSizeInput.fill("27");

    // Live apply: no Apply button appears, the change persists on its own.
    await expect(page.locator(SEL_APPLY_BTN)).not.toBeVisible();
    await expect
      .poll(
        async () => {
          const after = await api.getAnnotationsFromFile(DATACENTER_FILE);
          return after.freeTextAnnotations?.find((entry) => entry.id === text.id)?.fontSize;
        },
        { timeout: 5000 }
      )
      .toBe(27);
  });

  test("context-menu Edit Text opens the style drawer and inline editor together", async ({
    page,
    topoViewerPage
  }) => {
    const api = topoViewerPage as unknown as TopoViewerApi;
    await setup(page, api);
    const text = await getFirstTextAnnotation(api);

    const textElement = page.locator(`[data-id="${text.id}"] .free-text-content`).first();
    await expect(textElement).toBeVisible();
    const box = await textElement.boundingBox();
    expect(box).not.toBeNull();
    await rightClick(page, box!.x + box!.width / 2, box!.y + box!.height / 2);

    const editItem = page.locator(SEL_EDIT_TEXT_ITEM);
    await expect(editItem).toBeVisible();
    await editItem.click();

    // Both surfaces open: inline editor on the canvas, style drawer in the panel.
    const input = page.locator(SEL_INLINE_INPUT);
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(text.text);
    const panel = page.locator('[data-testid="context-panel"]');
    await expect(panel.getByText("Edit Text", { exact: true })).toBeVisible();
    await expect(panel.getByPlaceholder(PANEL_TEXT_PLACEHOLDER)).toHaveValue(text.text);

    // Committing the inline edit updates the still-open drawer.
    await input.fill("Edited via inline with drawer open");
    await input.press("Escape");
    await expect(input).not.toBeVisible();
    await expect(panel.getByText("Edit Text", { exact: true })).toBeVisible();
    await expect(panel.getByPlaceholder(PANEL_TEXT_PLACEHOLDER)).toHaveValue(
      "Edited via inline with drawer open"
    );

    await expect
      .poll(
        async () => {
          const after = await api.getAnnotationsFromFile(DATACENTER_FILE);
          return after.freeTextAnnotations?.find((entry) => entry.id === text.id)?.text;
        },
        { timeout: 5000 }
      )
      .toBe("Edited via inline with drawer open");
  });

  test("drawer style change after inline typing keeps the committed text", async ({
    page,
    topoViewerPage
  }) => {
    const api = topoViewerPage as unknown as TopoViewerApi;
    await setup(page, api);
    const text = await getFirstTextAnnotation(api);

    const textElement = page.locator(`[data-id="${text.id}"] .free-text-content`).first();
    const box = await textElement.boundingBox();
    expect(box).not.toBeNull();
    await rightClick(page, box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.locator(SEL_EDIT_TEXT_ITEM).click();

    const input = page.locator(SEL_INLINE_INPUT);
    await expect(input).toBeVisible();
    await input.fill("Typed inline before styling");

    // Focusing the drawer commits the inline edit; the style change must apply
    // on top of the committed text, not the drawer's stale snapshot.
    const fontSizeInput = page.locator("#text-font-size");
    await fontSizeInput.fill("27");
    await expect(input).not.toBeVisible();

    await expect
      .poll(
        async () => {
          const after = await api.getAnnotationsFromFile(DATACENTER_FILE);
          const entry = after.freeTextAnnotations?.find((item) => item.id === text.id);
          return `${entry?.text}|${entry?.fontSize}`;
        },
        { timeout: 5000 }
      )
      .toBe("Typed inline before styling|27");
  });

  test("live markdown preview appears while typing markdown inline", async ({
    page,
    topoViewerPage
  }) => {
    const api = topoViewerPage as unknown as TopoViewerApi;
    await setup(page, api);
    const text = await getFirstTextAnnotation(api);

    const textElement = page.locator(`[data-id="${text.id}"] .free-text-content`).first();
    await textElement.dblclick();
    const input = page.locator(SEL_INLINE_INPUT);
    await expect(input).toBeVisible();

    // Plain text renders identically to the textarea — no preview needed.
    await input.fill("plain text note");
    await expect(page.locator(SEL_INLINE_PREVIEW)).not.toBeVisible();

    // Markdown syntax shows the rendered result before committing.
    await input.fill("**bold** and `code`");
    const preview = page.locator(SEL_INLINE_PREVIEW);
    await expect(preview).toBeVisible();
    await expect(preview.locator("strong")).toHaveText("bold");
    await expect(preview.locator("code")).toHaveText("code");

    await input.press("Escape");
    await expect(preview).not.toBeVisible();
  });

  test("committed newlines render as line breaks (WYSIWYG parity)", async ({
    page,
    topoViewerPage
  }) => {
    const api = topoViewerPage as unknown as TopoViewerApi;
    await setup(page, api);
    const text = await getFirstTextAnnotation(api);

    const textElement = page.locator(`[data-id="${text.id}"] .free-text-content`).first();
    await textElement.dblclick();
    const input = page.locator(SEL_INLINE_INPUT);
    await expect(input).toBeVisible();
    await input.fill("first line\nsecond line");
    await input.press("Escape");
    await expect(input).not.toBeVisible();

    // A single typed newline must stay a visible line break after rendering.
    await expect(page.locator(`[data-id="${text.id}"] .free-text-content br`)).toHaveCount(1);
    await expect
      .poll(
        async () => {
          const after = await api.getAnnotationsFromFile(DATACENTER_FILE);
          return after.freeTextAnnotations?.find((entry) => entry.id === text.id)?.text;
        },
        { timeout: 5000 }
      )
      .toBe("first line\nsecond line");
  });
});
