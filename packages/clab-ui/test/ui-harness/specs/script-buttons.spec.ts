import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/topoviewer";
import { fitGraph, getEmptyCanvasArea, rightClick } from "../helpers/react-flow-helpers";

const DATACENTER_FILE = "datacenter.clab.yml";

const SEL_ADD_SCRIPT_BUTTON = '[data-testid="context-menu-item-add-script-button"]';
const SEL_EDITOR = '[data-testid="script-button-editor"]';
const SEL_RUN = '[data-testid^="script-button-run-"]';
const SEL_CONFIRM = '[data-testid="script-button-confirm"]';
const SEL_CONFIRM_RUN = '[data-testid="script-button-confirm-run"]';
const SEL_OUTPUT = '[data-testid="script-button-output"]';

interface ScriptButtonFileEntry {
  id: string;
  label: string;
  script?: string;
  output?: string;
}

interface TopoViewerApi {
  resetFiles(): Promise<void>;
  gotoFile(filename: "datacenter.clab.yml"): Promise<void>;
  waitForCanvasReady(): Promise<void>;
  setEditMode(): Promise<void>;
  unlock(): Promise<void>;
  lock(): Promise<void>;
  getAnnotationsFromFile(
    filename: "datacenter.clab.yml"
  ): Promise<{ scriptButtonAnnotations?: ScriptButtonFileEntry[] }>;
}

async function setup(page: Page, api: TopoViewerApi) {
  await api.resetFiles();
  await api.gotoFile(DATACENTER_FILE);
  await api.waitForCanvasReady();
  await api.setEditMode();
  await api.unlock();
  await fitGraph(page);
}

/** Adds a script button on empty canvas and gives it an inline script shown in a dialog. */
async function addInlineScriptButton(page: Page, script: string) {
  const area = await getEmptyCanvasArea(page);
  await rightClick(page, area.x + area.width / 2, area.y + area.height / 2);
  await page.locator(SEL_ADD_SCRIPT_BUTTON).click();

  const editor = page.locator(SEL_EDITOR);
  await expect(editor).toBeVisible();
  await editor.locator("#script-button-source").click();
  await page.getByRole("option", { name: "Inline script", exact: true }).click();
  await editor.locator("textarea#script-button-script").fill(script);
  await editor.locator("#script-button-output").click();
  await page.getByRole("option", { name: "Dialog", exact: true }).click();
}

test.describe("Script buttons", () => {
  test("a new button saves its script and runs it after a first confirmation", async ({
    page,
    topoViewerPage
  }) => {
    const api = topoViewerPage as unknown as TopoViewerApi;
    await setup(page, api);
    await addInlineScriptButton(page, "echo hi");

    await expect
      .poll(async () => (await api.getAnnotationsFromFile(DATACENTER_FILE)).scriptButtonAnnotations)
      .toEqual([expect.objectContaining({ label: "Run script", script: "echo hi", output: "dialog" })]);

    // First run asks, showing exactly what will run.
    await page.locator(SEL_RUN).click();
    const confirm = page.locator(SEL_CONFIRM);
    await expect(confirm).toContainText("echo hi");
    await page.locator(SEL_CONFIRM_RUN).click();
    const output = page.locator(SEL_OUTPUT);
    await expect(output).toContainText("ran echo hi");
    await output.getByRole("button", { name: "Close", exact: true }).click();

    // The same script is trusted now and runs straight away.
    await page.locator(SEL_RUN).click();
    await expect(page.locator(SEL_CONFIRM)).toHaveCount(0);
    await expect(output).toContainText("ran echo hi");
  });

  test("a locked lab still runs its script buttons", async ({ page, topoViewerPage }) => {
    const api = topoViewerPage as unknown as TopoViewerApi;
    await setup(page, api);
    await addInlineScriptButton(page, "echo fail");
    await api.lock();

    await page.locator(SEL_RUN).click();
    await page.locator(SEL_CONFIRM_RUN).click();
    const output = page.locator(SEL_OUTPUT);
    await expect(output).toContainText("Exited with 1");
    await expect(output).toContainText("echo fail: failed");
  });

  test("deleting a script button removes it from the annotations only", async ({
    page,
    topoViewerPage
  }) => {
    const api = topoViewerPage as unknown as TopoViewerApi;
    await setup(page, api);
    await addInlineScriptButton(page, "echo bye");
    await expect
      .poll(async () => (await api.getAnnotationsFromFile(DATACENTER_FILE)).scriptButtonAnnotations?.length)
      .toBe(1);

    await page.locator('[data-testid^="script-button-script-button-"]').click({ position: { x: 60, y: 12 } });
    await page.keyboard.press("Delete");
    await expect
      .poll(async () => (await api.getAnnotationsFromFile(DATACENTER_FILE)).scriptButtonAnnotations ?? [])
      .toEqual([]);
  });
});
