import type { Page } from "@playwright/test";

import type { BrowserDevApi } from "../devApi";
import { test, expect } from "../fixtures/topoviewer";

const TEMPLATE_FILE = "fabric.clab.gotmpl";
const VARS_FILE = "fabric.clab_vars.yml";

/** A template only containerlab can read: its leaves and their links come from a loop. */
const TEMPLATE = `name: fabric
topology:
  nodes:
    spine1:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux:{{ .version }}
{{- range $i := seq 1 .leaves }}
    leaf{{ $i }}:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux:{{ $.version }}
{{- end }}
  links:
{{- range $i := seq 1 .leaves }}
    - endpoints: ["spine1:e1-{{ $i }}", "leaf{{ $i }}:e1-49"]
{{- end }}
`;

/** A template that is YAML as it is written: only a value comes from a variable. */
const PLAIN_TEMPLATE = `name: pair
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux:{{ .version }}
    srl2:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux:{{ .version }}
  links:
    - endpoints: ["srl1:e1-1", "srl2:e1-1"]
`;

function vars(leaves: number): string {
  return `version: 25.3.1\nleaves: ${leaves}\n`;
}

async function writeFile(page: Page, file: string, content: string): Promise<void> {
  await page.evaluate(
    async ({ name, text }) => {
      const dev = (window as { __DEV__?: BrowserDevApi }).__DEV__;
      if (!dev) throw new Error("__DEV__ API not available");
      await dev.writeYamlFile(name, text);
    },
    { name: file, text: content }
  );
}

interface HarnessMessage {
  command: string;
  path?: string;
}

async function openedFiles(page: Page): Promise<Array<string | undefined>> {
  return page.evaluate(() => {
    const recorded = (window as { __CLAB_UI_HARNESS_MESSAGES__?: HarnessMessage[] })
      .__CLAB_UI_HARNESS_MESSAGES__;
    return (recorded ?? [])
      .filter((message) => message.command === "openLabFile")
      .map((message) => message.path);
  });
}

/** Makes the harness's containerlab unable to render, like one before 0.78. */
async function failRendering(page: Page, error: string | undefined): Promise<void> {
  await page.evaluate((message) => {
    (window as { __CLAB_UI_HARNESS_RENDER_ERROR__?: string }).__CLAB_UI_HARNESS_RENDER_ERROR__ =
      message;
  }, error);
}

async function openYamlTab(page: Page): Promise<void> {
  await page.getByTestId("navbar-split-view").click();
  await page.getByTestId("panel-tab-yaml").click();
  await expect(page.locator(".monaco-editor .view-lines")).toBeVisible({ timeout: 15000 });
}

test.describe("Topology template on the canvas", () => {
  test.beforeEach(async ({ page, topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile("simple.clab.yml");
    await topoViewerPage.waitForCanvasReady();
    await failRendering(page, undefined);
    await writeFile(page, VARS_FILE, vars(2));
    await writeFile(page, TEMPLATE_FILE, TEMPLATE);
  });

  test("draws the topology containerlab renders, nodes from loops included", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.gotoFile(TEMPLATE_FILE);
    await topoViewerPage.waitForCanvasReady();

    expect((await topoViewerPage.getNodeIds()).sort()).toEqual(["leaf1", "leaf2", "spine1"]);
    expect(await topoViewerPage.getEdgeCount()).toBe(2);

    const chip = page.getByTestId("template-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-source", "rendered");
    await chip.hover();
    await expect(page.getByRole("tooltip")).toContainText("Variables: fabric.clab_vars.yml");
    await expect(page.getByTestId("template-chip-problem")).toHaveCount(0);
  });

  test("an ordinary topology has no template chip, also after a template was open", async ({
    page,
    topoViewerPage
  }) => {
    await expect(page.getByTestId("template-chip")).toHaveCount(0);

    await topoViewerPage.gotoFile(TEMPLATE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await expect(page.getByTestId("template-chip")).toBeVisible();

    await topoViewerPage.gotoFile("simple.clab.yml");
    await topoViewerPage.waitForCanvasReady();
    await expect(page.getByTestId("template-chip")).toHaveCount(0);
    // Its topology is editable again.
    await topoViewerPage.unlock();
    await expect(page.getByTestId("navbar-undo")).toBeVisible();
  });

  test("the YAML tab shows the rendering read-only and leads to the template", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.gotoFile(TEMPLATE_FILE);
    await topoViewerPage.waitForCanvasReady();
    // Unlocked, an ordinary topology could be edited here.
    await topoViewerPage.unlock();
    await openYamlTab(page);

    const lines = page.locator(".monaco-editor .view-lines");
    await expect(lines).toContainText("leaf2:");
    await expect(lines).not.toContainText("range");
    await expect(page.getByTestId("palette-source-readonly")).toBeVisible();
    await expect(page.getByTitle("Save")).toHaveCount(0);

    await lines.click();
    await page.keyboard.type("x");
    await expect(lines).not.toContainText("xname");

    await page.getByTestId("template-open-file").click();
    await page.getByTestId("template-chip").click();
    await expect.poll(() => openedFiles(page)).toEqual([TEMPLATE_FILE, TEMPLATE_FILE]);

    // The annotations stay editable.
    await page.getByTestId("panel-tab-json").click();
    await expect(page.getByTestId("palette-source-readonly")).toHaveCount(0);
  });

  test("nodes can be moved, their place is saved, and the template is left alone", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.gotoFile(TEMPLATE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();

    const before = await topoViewerPage.getNodePosition("leaf2");
    await topoViewerPage.dragNode("leaf2", { x: 80, y: 60 });
    const after = await topoViewerPage.getNodePosition("leaf2");
    expect(after).not.toEqual(before);

    await expect
      .poll(async () => {
        const annotations = await topoViewerPage.getAnnotationsFromFile(TEMPLATE_FILE);
        return annotations.nodeAnnotations?.find((node) => node.id === "leaf2")?.position;
      })
      .toEqual(after);
    expect(await topoViewerPage.getYamlFromFile(TEMPLATE_FILE)).toBe(TEMPLATE);

    // Nodes and links are the template's: nothing here adds or removes them.
    await expect(page.getByTestId("navbar-undo")).toHaveCount(0);
    await expect(page.getByTestId("navbar-bulk-link")).toHaveCount(0);
    await topoViewerPage.selectNode("leaf1");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(300);
    expect((await topoViewerPage.getNodeIds()).sort()).toEqual(["leaf1", "leaf2", "spine1"]);
    expect(await topoViewerPage.getYamlFromFile(TEMPLATE_FILE)).toBe(TEMPLATE);
  });

  test("the palette says where a template's nodes are added", async ({ page, topoViewerPage }) => {
    await topoViewerPage.gotoFile(TEMPLATE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.unlock();
    if (!(await page.getByTestId("panel-tab-nodes").isVisible())) {
      await page.getByTestId("panel-toggle-btn").click();
    }
    await page.getByTestId("panel-tab-nodes").click();

    const card = page.locator("[aria-disabled='true']").filter({ hasText: "Mgmt Net" });
    await expect(card).toHaveAttribute("draggable", "false");
    await card.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Nodes are added in the template's text");
  });

  test("follows the template when it changes", async ({ page, topoViewerPage }) => {
    await topoViewerPage.gotoFile(TEMPLATE_FILE);
    await topoViewerPage.waitForCanvasReady();
    expect(await topoViewerPage.getNodeCount()).toBe(3);

    await writeFile(page, VARS_FILE, vars(4));
    await writeFile(page, TEMPLATE_FILE, `${TEMPLATE}# four leaves now\n`);
    await expect.poll(() => topoViewerPage.getNodeCount()).toBe(5);
    expect(await topoViewerPage.getEdgeCount()).toBe(4);
  });

  test("a template that does not render opens empty and says why", async ({
    page,
    topoViewerPage
  }) => {
    await writeFile(page, TEMPLATE_FILE, `${TEMPLATE}{{ .missing }}\n`);
    // Not gotoFile: it waits for nodes, and this canvas has none.
    await page.evaluate(async (file) => {
      await (window as { __DEV__?: BrowserDevApi }).__DEV__?.loadTopologyFile(file);
    }, TEMPLATE_FILE);

    const chip = page.getByTestId("template-chip");
    await expect(chip).toHaveAttribute("data-source", "text");
    expect(await topoViewerPage.getNodeCount()).toBe(0);
    const problem =
      "containerlab could not render fabric.clab.gotmpl, so the canvas shows it as written: " +
      'template: fabric.clab.gotmpl: map has no entry for key "missing"';
    await expect(page.getByRole("alert").filter({ hasText: problem })).toBeVisible();
    await chip.hover();
    await expect(page.getByTestId("template-chip-problem")).toHaveText(problem);
  });

  test("a containerlab that cannot render still shows a template that is plain YAML", async ({
    page,
    topoViewerPage
  }) => {
    await failRendering(page, "Rendering a topology needs containerlab 0.78 or newer.");
    await writeFile(page, "pair.clab.gotmpl", PLAIN_TEMPLATE);
    await topoViewerPage.gotoFile("pair.clab.gotmpl");
    await topoViewerPage.waitForCanvasReady();

    expect((await topoViewerPage.getNodeIds()).sort()).toEqual(["srl1", "srl2"]);
    expect(await topoViewerPage.getEdgeCount()).toBe(1);
    await expect(page.getByTestId("template-chip")).toHaveAttribute("data-source", "text");
    await expect(
      page.getByRole("alert").filter({ hasText: "needs containerlab 0.78 or newer" })
    ).toBeVisible();
  });
});
