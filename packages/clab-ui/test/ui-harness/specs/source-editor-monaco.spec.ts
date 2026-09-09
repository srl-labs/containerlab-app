import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/topoviewer";

const TOPOLOGY_FILE = "simple.clab.yml";

async function openYamlEditor(page: Page): Promise<void> {
  await page.locator('[data-testid="panel-tab-yaml"]').click();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    return Boolean(
      (window as { __clabMonacoDebug?: { getMarkers?: () => unknown[] } }).__clabMonacoDebug
    );
  });
}

async function setEditorValue(
  page: Page,
  value: string,
  lineNumber: number,
  column: number
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate(
      ({ content, line, col }) => {
        const debug = (
          window as {
            __clabMonacoDebug?: {
              setValue: (value: string) => void;
              setPosition: (lineNumber: number, column: number) => void;
            };
          }
        ).__clabMonacoDebug;
        if (!debug) throw new Error("Monaco debug API is not available");
        debug.setValue(content);
        debug.setPosition(line, col);
      },
      { content: value, line: lineNumber, col: column }
    );

    await expect
      .poll(async () => editorValue(page), {
        timeout: 2000,
        message: "Monaco editor should accept the requested test value"
      })
      .toBe(value);

    await page.waitForTimeout(100);
    if ((await editorValue(page)) === value) {
      await page.evaluate(
        ({ line, col }) => {
          const debug = (
            window as {
              __clabMonacoDebug?: {
                setPosition: (lineNumber: number, column: number) => void;
              };
            }
          ).__clabMonacoDebug;
          if (!debug) throw new Error("Monaco debug API is not available");
          debug.setPosition(line, col);
        },
        { line: lineNumber, col: column }
      );
      return;
    }
  }

  throw new Error("Monaco editor value did not remain stable after retries");
}

async function triggerSuggest(page: Page): Promise<void> {
  await page.evaluate(() => {
    const debug = (
      window as { __clabMonacoDebug?: { triggerSuggest: () => void } }
    ).__clabMonacoDebug;
    if (!debug) throw new Error("Monaco debug API is not available");
    debug.triggerSuggest();
  });
}

async function triggerHover(page: Page): Promise<void> {
  await page.evaluate(() => {
    const debug = (window as { __clabMonacoDebug?: { triggerHover: () => void } })
      .__clabMonacoDebug;
    if (!debug) throw new Error("Monaco debug API is not available");
    debug.triggerHover();
  });
}

async function editorValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const debug = (
      window as {
        __clabMonacoDebug?: {
          model: {
            getValue: () => string;
          };
        };
      }
    ).__clabMonacoDebug;
    if (!debug) throw new Error("Monaco debug API is not available");
    return debug.model.getValue();
  });
}

async function dispatchEditorPaste(page: Page, text: string): Promise<void> {
  await page.evaluate((pasteText) => {
    const debug = (
      window as {
        __clabMonacoDebug?: {
          editor: {
            focus: () => void;
            getDomNode: () => HTMLElement | null;
          };
        };
      }
    ).__clabMonacoDebug;
    const domNode = debug?.editor.getDomNode();
    if (!debug || !domNode) throw new Error("Monaco debug API is not available");

    const data = new DataTransfer();
    data.setData("text/plain", pasteText);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data
    });

    debug.editor.focus();
    domNode.dispatchEvent(event);
  }, text);
}

async function selectEditorRange(
  page: Page,
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }
): Promise<void> {
  await page.evaluate((selectionRange) => {
    const debug = (
      window as {
        __clabMonacoDebug?: {
          editor: {
            focus: () => void;
            setSelection: (range: typeof selectionRange) => void;
          };
        };
      }
    ).__clabMonacoDebug;
    if (!debug) throw new Error("Monaco debug API is not available");
    debug.editor.setSelection(selectionRange);
    debug.editor.focus();
  }, range);
}

async function selectedTextBackgrounds(page: Page): Promise<string[]> {
  return page.locator(".monaco-editor .selected-text").evaluateAll((elements) =>
    elements
      .map((element) => window.getComputedStyle(element).backgroundColor)
      .filter((background) => background !== "" && background !== "rgba(0, 0, 0, 0)")
  );
}

async function markerMessages(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const debug = (
      window as { __clabMonacoDebug?: { getMarkers: () => Array<{ message: string }> } }
    ).__clabMonacoDebug;
    return debug?.getMarkers().map((marker) => marker.message) ?? [];
  });
}

function isRedDominant(background: string): boolean {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(background);
  if (!match) return false;
  const red = Number(match[1]);
  const green = Number(match[2]);
  const blue = Number(match[3]);
  return red > 140 && red > green * 1.25 && red > blue * 1.25;
}

test.describe("Monaco YAML source editor", () => {
  test("shows schema markers, manual completion suggestions, and hover help", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(TOPOLOGY_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await openYamlEditor(page);
    await expect(page.getByTestId("source-editor-suggestions-toggle")).toHaveCount(0);

    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: nokia_srlinux\n", 4, 26);
    await selectEditorRange(page, {
      startLineNumber: 4,
      startColumn: 13,
      endLineNumber: 4,
      endColumn: 26
    });
    await expect
      .poll(async () => selectedTextBackgrounds(page), {
        timeout: 5000,
        message: "selected YAML text should render with a visible selection background"
      })
      .not.toEqual([]);
    expect((await selectedTextBackgrounds(page)).some(isRedDominant)).toBe(false);

    await setEditorValue(
      page,
      "name: demo\ntopology:\n  nodes:\n    srl1:\n      kind: does_not_exist\n      unknown-field: true\n",
      6,
      26
    );

    await expect
      .poll(
        async () => {
          const messages = await markerMessages(page);
          return (
            messages.includes('Unknown property "unknown-field"') &&
            messages.some((message) => message.includes("Value is not accepted"))
          );
        },
        {
          timeout: 5000,
          message: "invalid topology YAML should produce schema markers"
        }
      )
      .toBe(true);

    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: nok", 4, 16);
    await triggerSuggest(page);
    await expect(page.locator(".suggest-widget")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".suggest-widget").getByText("nokia_srlinux")).toBeVisible();

    await page.keyboard.press("Tab");
    await expect
      .poll(async () => editorValue(page), {
        timeout: 5000,
        message: "Tab should indent instead of accepting the regular suggestion widget"
      })
      .not.toContain("nokia_srlinux");

    await page.keyboard.press("Escape");
    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: nok", 4, 16);
    await triggerSuggest(page);
    await expect(page.locator(".suggest-widget")).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => editorValue(page), {
        timeout: 5000,
        message: "Enter should accept the selected regular suggestion"
      })
      .toContain("kind: nokia_srlinux");

    await page.keyboard.press("Escape");

    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: ", 4, 13);
    await expect(page.locator(".suggest-widget")).toBeHidden({ timeout: 1000 });
    await triggerSuggest(page);
    await expect(page.locator(".suggest-widget")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".suggest-widget").getByText("6wind_vsr")).toBeVisible();

    await page.keyboard.press("Escape");
    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: ", 4, 13);
    await page.keyboard.type("n");
    await expect(page.locator(".suggest-widget")).toBeHidden({ timeout: 1000 });
    await triggerSuggest(page);
    await expect(page.locator(".suggest-widget")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".suggest-widget").getByText("nokia_srlinux")).toBeVisible();

    await page.keyboard.press("Escape");
    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: nokia_srlinux\n", 4, 9);
    await triggerHover(page);
    await expect(page.locator(".monaco-hover")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".monaco-hover")).toContainText("Allowed values");

    await page.keyboard.press("Escape");

    await setEditorValue(
      page,
      "topology:\n  nodes:\n    srl1:\n      kind: nokia_srlinux\n    srl2:\n      kind: nokia_srlinux\n  links:\n    - endpoints:\n        - ",
      9,
      11
    );
    await triggerSuggest(page);
    await expect(page.locator(".suggest-widget")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".suggest-widget").getByText("srl1")).toBeVisible();
    await expect(page.locator(".suggest-widget").getByText("srl2")).toBeVisible();
  });

  test("does not fall back to root suggestions in nested node config", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(TOPOLOGY_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await openYamlEditor(page);

    const directNodeBody = [
      "topology:",
      "  nodes:",
      "    srl1:",
      "      kind: nokia_srlinux",
      "      type: ixr-d1",
      "      image: ghcr.io/nokia/srlinux:latest",
      "    client1:",
      "      kind: linux",
      "      image: ghcr.io/srl-labs/network-multitool:latest",
      "      type: iasd                  ",
      "    asdasd:",
      "      "
    ].join("\n");

    await setEditorValue(page, directNodeBody, 12, 7);
    await triggerSuggest(page);
    await expect(page.locator(".suggest-widget")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".suggest-widget").getByText("kind")).toBeVisible();
    await expect(page.locator(".suggest-widget")).not.toContainText("topology");

    const nestedUnknown = [
      "topology:",
      "  nodes:",
      "    asdasd:",
      "      below asdad:",
      "        "
    ].join("\n");

    await page.keyboard.press("Escape");
    await setEditorValue(page, nestedUnknown, 5, 9);
    await triggerSuggest(page);
    await expect(page.locator(".suggest-widget")).not.toContainText("topology");
  });

  test("preserves pasted indentation and undoes a paste as one edit", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(TOPOLOGY_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await openYamlEditor(page);

    const base = "name: demo\ntopology:\n  nodes:\n";
    const pasted = "    leaf1:\n      kind: nokia_srlinux\n      image: ghcr.io/nokia/srlinux\n";
    await setEditorValue(page, base, 4, 1);
    await dispatchEditorPaste(page, pasted);

    await expect
      .poll(async () => editorValue(page), {
        timeout: 5000,
        message: "paste should preserve the clipboard indentation exactly"
      })
      .toBe(base + pasted);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z");
    await expect
      .poll(async () => editorValue(page), {
        timeout: 5000,
        message: "one undo should remove the complete pasted block"
      })
      .toBe(base);
  });

  test("does not open empty suggestions for free-form YAML values", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(TOPOLOGY_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await openYamlEditor(page);

    await setEditorValue(page, "name:", 1, 6);
    await page.keyboard.press("Space");
    await page.keyboard.type("atest");
    await expect
      .poll(async () => editorValue(page), {
        timeout: 5000,
        message: "typing a free-form topology name should update the model"
      })
      .toBe("name: atest");
    await expect(page.locator(".suggest-widget")).toBeHidden({ timeout: 1000 });

    const text = [
      "name: atest",
      "",
      "topology:",
      "  nodes:",
      "    client2:",
      "      kind: 6wind_vsr",
      "      image:"
    ].join("\n");
    await setEditorValue(page, text, 7, 13);
    await page.keyboard.press("Space");
    await expect
      .poll(async () => editorValue(page), {
        timeout: 5000,
        message: "typing a space after image: should update the model"
      })
      .toBe(`${text} `);
    await expect(page.locator(".suggest-widget")).toBeHidden({ timeout: 1000 });
  });
});
