import type { Page } from "@playwright/test";

import type { CustomIconInfo } from "../../../src/core/types/icons";
import { getCustomIconUrl } from "../../../src/utils/iconUtils";

import { test, expect } from "../fixtures/topoviewer";

const SIMPLE_FILE = "simple.clab.yml";
const CUSTOM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <title>Router 東京</title>
  <style>.body { fill: #112233; }</style>
  <rect class="body" x="8" y="8" width="32" height="32"/>
  <path d="M12 24h24" fill="none" style="stroke: white; stroke-width: 4"/>
</svg>`;
const CUSTOM_ICONS: CustomIconInfo[] = [
  {
    name: "custom-router",
    source: "workspace",
    format: "svg",
    dataUri: `data:image/svg+xml;base64,${Buffer.from(CUSTOM_SVG).toString("base64")}`
  },
  {
    name: "custom-png",
    source: "workspace",
    format: "png",
    dataUri:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
  }
];

async function loadCustomIcons(page: Page): Promise<void> {
  await page.evaluate((icons) => {
    (
      window as Window & { __DEV__: { setCustomIcons: (value: CustomIconInfo[]) => void } }
    ).__DEV__.setCustomIcons(icons);
  }, CUSTOM_ICONS);
}

async function sampleIconPixels(page: Page, source: string) {
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 48;
    const ctx = canvas.getContext("2d")!;
    const scale = Math.max(48 / img.naturalWidth, 48 / img.naturalHeight);
    const width = img.naturalWidth * scale;
    const height = img.naturalHeight * scale;
    ctx.drawImage(img, (48 - width) / 2, (48 - height) / 2, width, height);
    return {
      fill: Array.from(ctx.getImageData(24, 16, 1, 1).data),
      stroke: Array.from(ctx.getImageData(24, 24, 1, 1).data),
      transparent: Array.from(ctx.getImageData(0, 0, 1, 1).data)
    };
  }, source);
}

async function getCanvasIconSource(page: Page, nodeId: string): Promise<string> {
  return page
    .locator(`[data-id="${nodeId}"] .topology-node-icon`)
    .evaluate((element) => getComputedStyle(element).backgroundImage.slice(5, -2));
}

async function openIconEditor(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit Icons" })).toBeVisible();
}

/**
 * Get a node's role (icon id) from React Flow node data.
 * This is what drives which SVG icon gets rendered on the canvas.
 */
async function getNodeRole(page: Page, nodeId: string): Promise<string | undefined> {
  return page.evaluate((id) => {
    const dev = (window as any).__DEV__;
    const rf = dev?.rfInstance;
    if (rf === undefined || rf === null) return undefined;
    const nodes = rf.getNodes?.() ?? [];
    const node = nodes.find((n: any) => n.id === id);
    const data = node?.data ?? {};
    return data.role ?? data.extraData?.topoViewerRole;
  }, nodeId);
}

/**
 * Click a node to open the editor
 */
async function clickNode(page: Page, nodeId: string): Promise<void> {
  const nodeHandle = page.locator(`[data-id="${nodeId}"]`);
  await nodeHandle.scrollIntoViewIfNeeded();
  await expect(nodeHandle).toBeVisible({ timeout: 3000 });
  const box = await nodeHandle.boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
}

async function openNodeEditor(page: Page, nodeId: string): Promise<void> {
  await clickNode(page, nodeId);
  // Ensure we actually opened the Node Editor (not e.g. link editor/info view).
  await expect(page.getByText("Node Editor", { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.locator("#node-kind")).toBeVisible({ timeout: 5000 });
}

/**
 * Node Icon Change E2E Tests (MUI version)
 *
 * Tests that changing a node's icon via the editor updates the graph
 * and persists to the annotations file.
 */
test.describe("Node Icon Change", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
  });

  test("can read initial node icon", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    expect(nodeIds.length).toBeGreaterThan(0);

    const role = await getNodeRole(page, nodeIds[0]);
    expect(role).toBeDefined();
  });

  test("custom SVG tint preserves fills, strokes and transparency for both encodings", async ({
    page
  }) => {
    for (const source of [
      CUSTOM_ICONS[0].dataUri,
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(CUSTOM_SVG)}`
    ]) {
      expect(await sampleIconPixels(page, getCustomIconUrl(source, "#ff6600"))).toEqual({
        fill: [255, 102, 0, 255],
        stroke: [255, 102, 0, 255],
        transparent: [0, 0, 0, 0]
      });
    }
    const translucentSvg = CUSTOM_SVG.replace('class="body"', 'class="body" opacity="0.5"');
    expect(
      await sampleIconPixels(
        page,
        getCustomIconUrl(`data:image/svg+xml,${encodeURIComponent(translucentSvg)}`, "#ff6600")
      )
    ).toMatchObject({ fill: [255, 102, 0, 128] });

    // Match the canvas and Avatar's existing cover sizing for non-square icons.
    const wideSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 48"><rect x="24" width="48" height="48"/></svg>';
    const widePixels = await sampleIconPixels(
      page,
      getCustomIconUrl(`data:image/svg+xml,${encodeURIComponent(wideSvg)}`, "#ff6600")
    );
    expect(widePixels.transparent).toEqual([255, 102, 0, 255]);
  });

  test("custom SVG color previews, persists, exports and resets to the original artwork", async ({
    page,
    topoViewerPage
  }) => {
    const nodeId = "srl1";
    await loadCustomIcons(page);
    await openNodeEditor(page, nodeId);
    await openIconEditor(page);
    const dialog = page.getByRole("dialog", { name: "Edit Icons" });
    await dialog.getByRole("tab", { name: "Custom", exact: true }).click();
    await dialog.locator('button[title="custom-router (workspace)"]').click();
    const preview = dialog.getByAltText("Preview", { exact: true });
    await expect(preview).toHaveAttribute("src", CUSTOM_ICONS[0].dataUri);

    const color = dialog.getByRole("textbox", { name: "Icon Color", exact: true });
    await expect(color).toBeEnabled();
    await color.fill("ff6600");
    await color.blur();
    await expect
      .poll(async () => sampleIconPixels(page, (await preview.getAttribute("src"))!))
      .toEqual({
        fill: [255, 102, 0, 255],
        stroke: [255, 102, 0, 255],
        transparent: [0, 0, 0, 0]
      });
    const tintedSource = (await preview.getAttribute("src"))!;
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByAltText("Icon preview", { exact: true })).toHaveAttribute(
      "src",
      tintedSource
    );
    await page.getByTestId("panel-apply-btn").click();
    await expect
      .poll(async () => {
        const annotations = await topoViewerPage.getAnnotationsFromFile(SIMPLE_FILE);
        return annotations.nodeAnnotations?.find((node: { id: string }) => node.id === nodeId);
      })
      .toMatchObject({ icon: "custom-router", iconColor: "#ff6600" });
    await expect.poll(() => getCanvasIconSource(page, nodeId)).toBe(tintedSource);

    // Reload the topology from persisted annotations and check the saved tint.
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await expect.poll(() => getCanvasIconSource(page, nodeId)).toBe(tintedSource);
    await page.getByTestId("navbar-capture").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("svg-export-btn").click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const svg = Buffer.concat(await stream.toArray()).toString("utf8");
    const exportedSource = await page.evaluate(
      ({ content, id }) => {
        const document = new DOMParser().parseFromString(content, "image/svg+xml");
        const node = document.querySelector(`g.export-node[data-id="${id}"]`)!;
        if (node.querySelector(":scope > g > rect") !== null) {
          throw new Error("Custom icon export must retain its transparent background");
        }
        return node.querySelector("image")?.getAttribute("href");
      },
      { content: svg, id: nodeId }
    );
    expect(exportedSource).toBe(tintedSource);
    // Render the nested exported image, too: no opaque background may obscure its transparency.
    expect(
      await sampleIconPixels(
        page,
        `data:image/svg+xml,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><image width="48" height="48" href="${exportedSource}"/></svg>`
        )}`
      )
    ).toMatchObject({ fill: [255, 102, 0, 255], transparent: [0, 0, 0, 0] });
    await page.keyboard.press("Escape");

    await openNodeEditor(page, nodeId);
    await openIconEditor(page);
    await expect(color).toHaveValue("ff6600");
    // Built-in default blue must also be selectable as an explicit custom SVG tint.
    await color.fill("005aff");
    await color.blur();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByTestId("panel-apply-btn").click();
    await expect
      .poll(async () => {
        const annotations = await topoViewerPage.getAnnotationsFromFile(SIMPLE_FILE);
        return annotations.nodeAnnotations?.find((node: { id: string }) => node.id === nodeId)
          ?.iconColor;
      })
      .toBe("#005aff");

    await openIconEditor(page);
    await dialog.getByRole("button", { name: "Restore original icon colors" }).click();
    await expect(preview).toHaveAttribute("src", CUSTOM_ICONS[0].dataUri);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByTestId("panel-apply-btn").click();
    await expect
      .poll(async () => {
        const annotations = await topoViewerPage.getAnnotationsFromFile(SIMPLE_FILE);
        return annotations.nodeAnnotations?.find((node: { id: string }) => node.id === nodeId)
          ?.iconColor;
      })
      .toBeUndefined();
    await expect.poll(() => getCanvasIconSource(page, nodeId)).toBe(CUSTOM_ICONS[0].dataUri);
  });

  test("custom PNG color stays disabled and built-in color stays editable", async ({ page }) => {
    await loadCustomIcons(page);
    await openNodeEditor(page, "srl1");
    await openIconEditor(page);
    const dialog = page.getByRole("dialog", { name: "Edit Icons" });
    const color = dialog.getByRole("textbox", { name: "Icon Color", exact: true });
    await expect(color).toBeEnabled();
    await color.fill("ff6600");
    await color.blur();
    await dialog.getByRole("tab", { name: "Custom", exact: true }).click();
    await dialog.locator('button[title="custom-png (workspace)"]').click();
    await expect(color).toBeDisabled();
    await expect(dialog.getByAltText("Preview", { exact: true })).toHaveAttribute(
      "src",
      CUSTOM_ICONS[1].dataUri
    );
    await expect(
      dialog.getByRole("button", { name: "Restore original icon colors" })
    ).toBeDisabled();
    await dialog.getByRole("tab", { name: "Built-in", exact: true }).click();
    await dialog.locator('button[title="Leaf"]').click();
    await expect(color).toBeEnabled();
    await expect(color).toHaveValue("ff6600");
  });

  test("changing kind updates node data", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    const nodeId = nodeIds[0];

    await openNodeEditor(page, nodeId);

    // Change kind to linux
    const kindField = page.locator("#node-kind");
    await kindField.clear();
    await kindField.fill("linux");
    await kindField.blur();
    await page.waitForTimeout(200);

    await page.locator('[data-testid="panel-apply-btn"]').click();
    await page.waitForTimeout(500);

    // Verify YAML updated
    const yaml = await topoViewerPage.getYamlFromFile(SIMPLE_FILE);
    expect(yaml).toContain("kind: linux");
  });

  test("changing node icon persists to canvas and annotations file", async ({
    page,
    topoViewerPage
  }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    expect(nodeIds.length).toBeGreaterThan(0);
    const nodeId = nodeIds.includes("srl1") ? "srl1" : nodeIds[0];

    const initialRole = await getNodeRole(page, nodeId);
    const initialAnnotations = await topoViewerPage.getAnnotationsFromFile(SIMPLE_FILE);
    const initialNodeAnn = initialAnnotations.nodeAnnotations?.find(
      (n: { id: string }) => n.id === nodeId
    );
    const initialIcon = initialNodeAnn?.icon;

    await openNodeEditor(page, nodeId);
    await page.locator('[data-testid="panel-tab-basic"]').click();

    // Select "Leaf" icon (label) from the dropdown. Stored value should be "leaf".
    // MUI Autocomplete uses the provided id on the input element.
    const iconCombobox = page.locator("#node-icon");
    await expect(iconCombobox).toBeVisible({ timeout: 5000 });
    await iconCombobox.scrollIntoViewIfNeeded();
    await iconCombobox.click({ force: true });
    await iconCombobox.fill("Leaf");
    await expect(page.getByRole("option", { name: "Leaf" })).toBeVisible({ timeout: 5000 });
    await page.getByRole("option", { name: "Leaf" }).click();
    await page.waitForTimeout(200);

    await page.locator('[data-testid="panel-apply-btn"]').click();

    // Verify persisted to annotations file
    await expect
      .poll(
        async () => {
          const annotations = await topoViewerPage.getAnnotationsFromFile(SIMPLE_FILE);
          const ann = annotations.nodeAnnotations?.find((n: { id: string }) => n.id === nodeId);
          return ann?.icon;
        },
        { timeout: 5000 }
      )
      .toBe("leaf");

    // Verify canvas role reflects updated icon value
    await expect.poll(async () => await getNodeRole(page, nodeId), { timeout: 5000 }).toBe("leaf");

    // Sanity: it actually changed from whatever was there
    expect(initialRole).not.toBe("leaf");
    expect(initialIcon).not.toBe("leaf");
  });
});
