import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

const FILE = "datacenter.clab.yml";
const TEXT_ID = "text-title";

async function openText(page: Page) {
  await page.locator(`[data-id="${TEXT_ID}"] .free-text-content`).click();
  await expect(page.getByRole("textbox", { name: "Rotation angle", exact: true })).toBeVisible();
}

async function pathMidpoint(page: Page, id: string) {
  return page.evaluate((edgeId) => {
    const path = document.getElementById(edgeId) as unknown as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, id);
}

async function edgeAngle(page: Page, id: string) {
  return page.evaluate((edgeId) => {
    const path = document.getElementById(edgeId) as unknown as SVGPathElement;
    const mid = path.getTotalLength() / 2;
    const a = path.getPointAtLength(mid - 1);
    const b = path.getPointAtLength(mid + 1);
    let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return angle;
  }, id);
}

test.describe("Annotation rotation", () => {
  test.use({ viewport: { width: 1600, height: 1000 } });
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
  });

  test("precise angle, presets, keyboard dial, persistence and undo", async ({
    page,
    topoViewerPage
  }) => {
    await openText(page);
    const input = page.getByRole("textbox", {
      name: "Rotation angle",
      exact: true
    });
    const readRotation = async () =>
      (await topoViewerPage.getAnnotationsFromFile(FILE)).freeTextAnnotations?.find(
        (a: { id: string }) => a.id === TEXT_ID
      )?.rotation;
    await input.fill("22.75");
    await input.press("Enter");
    await expect.poll(readRotation).toBe(22.75);
    await input.fill("-");
    await input.press("Tab");
    await expect(input).toHaveValue("22.75");
    await page.getByRole("button", { name: "Set rotation to 45°", exact: true }).click();
    await expect.poll(readRotation).toBe(45);
    await page.getByRole("button", { name: "Rotation dial", exact: true }).focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(readRotation).toBe(60);
    await topoViewerPage.undo();
    await expect.poll(readRotation).toBe(45);
    await expect(input).toHaveValue("45");
    await topoViewerPage.redo();
    await expect.poll(readRotation).toBe(60);
  });

  test("matches a link without changing selection; Escape cancels", async ({
    page,
    topoViewerPage
  }) => {
    await openText(page);
    const edgeId = (await topoViewerPage.getEdgeIds())[2];
    const expectedAngle = await edgeAngle(page, edgeId);
    const midpoint = await pathMidpoint(page, edgeId);
    expect(midpoint).not.toBeNull();
    await page.getByRole("button", { name: "Match rotation", exact: true }).click();
    await page.mouse.move(midpoint.x, midpoint.y);
    await expect(page.locator("[data-rotation-source]")).toBeVisible();
    await page.mouse.click(midpoint.x, midpoint.y);
    await expect(page.getByTestId("rotation-match-hint")).not.toBeVisible();
    await expect(page.getByRole("textbox", { name: "Rotation angle", exact: true })).toHaveValue(
      String(Number(expectedAngle.toFixed(2)))
    );
    await expect(page.locator(`[data-id="${TEXT_ID}"]`)).toHaveClass(/selected/);
    await expect
      .poll(
        async () =>
          (await topoViewerPage.getAnnotationsFromFile(FILE)).freeTextAnnotations?.find(
            (a: { id: string }) => a.id === TEXT_ID
          )?.rotation
      )
      .toBeCloseTo(expectedAngle, 4);
    await page.getByRole("button", { name: "Match rotation", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("rotation-match-hint")).not.toBeVisible();
    await expect(page.getByRole("textbox", { name: "Rotation angle", exact: true })).toBeVisible();
  });

  test("copy a connector angle and apply it to a label", async ({ page, topoViewerPage }) => {
    const edgeId = (await topoViewerPage.getEdgeIds())[2];
    const midpoint = await pathMidpoint(page, edgeId);
    await page.mouse.dblclick(midpoint.x, midpoint.y);
    const computed = page.getByRole("textbox", {
      name: "Computed rotation angle",
      exact: true
    });
    await expect(computed).toBeVisible();
    await expect(computed).toHaveAttribute("readonly", "");
    const expectedAngle = Number(await computed.inputValue());
    await page.getByRole("button", { name: "Copy rotation", exact: true }).click();
    await openText(page);
    await page.getByRole("button", { name: "Apply copied rotation", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await topoViewerPage.getAnnotationsFromFile(FILE)).freeTextAnnotations?.find(
            (a: { id: string }) => a.id === TEXT_ID
          )?.rotation
      )
      .toBeCloseTo(expectedAngle, 2);
  });

  test("line rotation updates its endpoints and survives reopening", async ({
    page,
    topoViewerPage
  }) => {
    const annotations = await topoViewerPage.getAnnotationsFromFile(FILE);
    await topoViewerPage.writeAnnotationsFile(FILE, {
      ...annotations,
      freeShapeAnnotations: [
        {
          id: "rotation-line",
          shapeType: "line",
          position: { x: 60, y: 0 },
          endPosition: { x: 260, y: 100 },
          borderColor: "#38bdf8",
          borderWidth: 4,
          lineEndArrow: true
        }
      ]
    });
    await topoViewerPage.emitCurrentSnapshot();
    const line = page.locator('[data-id="rotation-line"] .free-shape-line');
    await expect(line).toBeVisible();
    await line.dblclick();
    const input = page.getByRole("textbox", {
      name: "Rotation angle",
      exact: true
    });
    await expect(input).toHaveValue("26.57");
    await input.fill("90");
    await input.press("Enter");
    const readLine = async () =>
      (await topoViewerPage.getAnnotationsFromFile(FILE)).freeShapeAnnotations?.find(
        (a: { id: string }) => a.id === "rotation-line"
      );
    await expect.poll(async () => (await readLine())?.position.x).toBeCloseTo(160, 5);
    const rotated = await readLine();
    expect(rotated.endPosition.x).toBeCloseTo(160, 5);
    expect(
      Math.hypot(
        rotated.endPosition.x - rotated.position.x,
        rotated.endPosition.y - rotated.position.y
      )
    ).toBeCloseTo(Math.hypot(200, 100), 5);
    expect((rotated.position.y + rotated.endPosition.y) / 2).toBeCloseTo(50, 5);
    await page.getByTestId("panel-toggle-btn").click();
    await line.dblclick();
    await expect(input).toHaveValue("90");
  });

  test("dial supports pointer snapping and locking cancels the picker", async ({
    page,
    topoViewerPage
  }) => {
    await openText(page);
    const dial = page.getByRole("button", { name: "Rotation dial", exact: true });
    // Wait for the panel's opening transition before measuring pointer coordinates.
    await dial.hover();
    const bounds = await dial.boundingBox();
    expect(bounds).not.toBeNull();
    await page.keyboard.down("Shift");
    await page.mouse.move(bounds!.x + bounds!.width - 8, bounds!.y + bounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height - 8, {
      steps: 8
    });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await expect(page.getByRole("textbox", { name: "Rotation angle", exact: true })).toHaveValue(
      "90"
    );
    await page.getByRole("button", { name: "Match rotation", exact: true }).click();
    await topoViewerPage.lock();
    await expect(page.getByTestId("rotation-match-hint")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Match rotation", exact: true })).toBeDisabled();
    await expect(dial).toBeDisabled();
  });

  test("geographic line rotation updates both geographic endpoints", async ({
    page,
    topoViewerPage
  }) => {
    await page.evaluate(() => {
      (window as any).maplibreStyle = { version: 8, sources: {}, layers: [] };
    });
    const annotations = await topoViewerPage.getAnnotationsFromFile(FILE);
    await topoViewerPage.writeAnnotationsFile(FILE, {
      ...annotations,
      freeShapeAnnotations: [
        {
          id: "geo-rotation-line",
          shapeType: "line",
          position: { x: 60, y: 0 },
          endPosition: { x: 260, y: 100 },
          geoCoordinates: { lat: 52, lng: 5 },
          endGeoCoordinates: { lat: 50, lng: 8 },
          borderWidth: 4
        }
      ]
    });
    await topoViewerPage.emitCurrentSnapshot();
    await page.locator('[data-id="geo-rotation-line"] .free-shape-line').dblclick();
    await page.evaluate(() => (window as any).__DEV__.setLayout("geo"));
    await page.waitForSelector("#react-topoviewer-geo-map canvas");
    // Map initialization and its initial fit animate before the geometry is stable.
    await expect
      .poll(async () => page.evaluate(() => (window as any).__DEV__.isGeoLayout()))
      .toBe(true);
    await page.waitForTimeout(1000);
    const input = page.getByRole("textbox", { name: "Rotation angle", exact: true });
    await input.fill("90");
    await input.press("Enter");
    await expect
      .poll(async () => {
        const line = (await topoViewerPage.getAnnotationsFromFile(FILE)).freeShapeAnnotations?.find(
          (a: { id: string }) => a.id === "geo-rotation-line"
        );
        return Math.abs(line.geoCoordinates.lng - line.endGeoCoordinates.lng);
      })
      .toBeLessThan(0.00001);
    await expect(input).toHaveValue("90");
  });

  test("matches the visible direction of a curved parallel link", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.createLink("border2", "spine2", "e1-20", "e1-20");
    await openText(page);
    const curveId = await page.evaluate(() => {
      const curves = document.querySelectorAll<SVGPathElement>(".react-flow__edge-path");
      for (const path of curves) {
        if (path.getAttribute("d")?.includes("Q") !== true) continue;
        const point = path.getPointAtLength(path.getTotalLength() / 2);
        const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
        if (
          document
            .elementFromPoint(screen.x, screen.y)
            ?.closest(".react-flow__edge")
            ?.getAttribute("data-id") === path.id
        )
          return path.id;
      }
      return null;
    });
    expect(curveId).not.toBeNull();
    const angle = await edgeAngle(page, curveId!);
    const point = await pathMidpoint(page, curveId!);
    await page.getByRole("button", { name: "Match rotation", exact: true }).click();
    await page.mouse.click(point.x, point.y);
    await expect(page.getByRole("textbox", { name: "Rotation angle", exact: true })).toHaveValue(
      String(Number(angle.toFixed(2)))
    );
    await expect
      .poll(
        async () =>
          (await topoViewerPage.getAnnotationsFromFile(FILE)).freeTextAnnotations?.find(
            (a: { id: string }) => a.id === TEXT_ID
          )?.rotation
      )
      .toBeCloseTo(angle, 4);
  });
});
