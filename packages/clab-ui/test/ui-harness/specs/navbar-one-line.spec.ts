import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

type TopoViewerPage = Parameters<Parameters<typeof test>[2]>[0]["topoViewerPage"];

async function openToolbar(page: Page, topoViewerPage: TopoViewerPage) {
  await topoViewerPage.gotoFile("simple.clab.yml");
  await topoViewerPage.waitForCanvasReady();
  await topoViewerPage.setEditMode();
  await topoViewerPage.unlock();
  await expect(page.getByTestId("navbar-capture")).toBeVisible();
}

test("the toolbar stays on one line and moves what does not fit to More", async ({ page, topoViewerPage }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openToolbar(page, topoViewerPage);
  const bar = page.getByTestId("topoviewer-navbar");
  const fullHeight = (await bar.boundingBox())?.height;
  await expect(page.getByTestId("navbar-capture")).toBeVisible();

  await page.setViewportSize({ width: 260, height: 600 });
  await expect(page.getByTestId("navbar-capture")).toHaveCount(0);
  await expect(page.getByTestId("navbar-layout")).toHaveCount(0);
  await expect(page.getByTestId("navbar-deploy")).toBeVisible();
  await expect(page.getByTestId("navbar-more")).toBeVisible();
  expect((await bar.boundingBox())?.height).toBe(fullHeight);
  const fits = await page.evaluate(() => {
    const element = document.querySelector('[data-testid="topoviewer-navbar"]');
    return element !== null && element.getBoundingClientRect().right <= window.innerWidth;
  });
  expect(fits).toBe(true);

  // Trimmed buttons keep working from More, also the ones with a menu of their own.
  await page.getByTestId("navbar-more").click();
  await expect(page.getByTestId("navbar-more-capture")).toBeVisible();
  await page.getByTestId("navbar-more-layout").click();
  await expect(page.getByTestId("navbar-layout-force")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1280, height: 600 });
  await expect(page.getByTestId("navbar-capture")).toBeVisible();
  await page.getByTestId("navbar-more").click();
  await expect(page.getByTestId("navbar-more-capture")).toHaveCount(0);
});

test("the folded filter opens from its button and the bar makes room", async ({ page, topoViewerPage }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openToolbar(page, topoViewerPage);
  await page.setViewportSize({ width: 460, height: 600 });
  const filter = page.getByTestId("navbar-find-node");
  await expect(filter.getByPlaceholder("Filter")).toBeHidden();

  await filter.getByRole("button", { name: "Find nodes" }).click();
  await expect(filter.getByPlaceholder("Filter")).toBeFocused();
  const fits = await page.evaluate(() => {
    const element = document.querySelector('[data-testid="topoviewer-navbar"]');
    return element !== null && element.getBoundingClientRect().right <= window.innerWidth;
  });
  expect(fits).toBe(true);
});

test("this machine reads Local with a runtime icon in the toolbar", async ({ page, topoViewerPage }) => {
  await page.addInitScript(() => {
    (window as unknown as { __CLAB_UI_HARNESS_LAB_HOST_IDENTITY__?: unknown }).__CLAB_UI_HARNESS_LAB_HOST_IDENTITY__ = {
      id: "local",
      label: "This computer",
      kind: "this-computer",
      runtime: "docker",
      status: "connected"
    };
  });
  await page.goto("/");
  await openToolbar(page, topoViewerPage);
  const chip = page.getByTestId("lab-host-chip");
  await expect(chip).toHaveText("Local");
  await expect(chip).toHaveAttribute("aria-label", "Lab host Local, Docker");
  await expect(chip.getByTestId("lab-host-chip-runtime")).toHaveAttribute("data-runtime", "docker");
});

test.describe("the host chip lines up", () => {
  test.use({ deviceScaleFactor: 4 });

  /** How far above (-) or below (+) the chip's middle the drawn dot, text and icon sit, in CSS pixels. */
  async function drawnOffsets(page: Page): Promise<number[]> {
    const chip = page.getByTestId("lab-host-chip");
    await expect(chip).toBeVisible();
    const png = (await chip.screenshot()).toString("base64");
    return page.evaluate(async (data) => {
      const scale = 4;
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const { data: pixels, width, height } = context.getImageData(0, 0, image.width, image.height);
      const at = (x: number, y: number) => pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3);
      const background = at(3 * scale, height / 2);
      const inset = 3 * scale;
      const isInk = (x: number, y: number) =>
        at(x, y).reduce((sum, value, index) => sum + Math.abs(value - background[index]), 0) > 90;
      const rowsWithInk = (from: number, to: number) => {
        const rows: number[] = [];
        for (let y = inset; y < height - inset; y++) {
          for (let x = from; x <= to; x++) {
            if (isInk(x, y)) {
              rows.push(y);
              break;
            }
          }
        }
        return rows;
      };
      // Runs of drawn columns, split where a gap is wider than the space between letters.
      const groups: Array<[number, number]> = [];
      for (let x = inset; x < width - inset; x++) {
        if (rowsWithInk(x, x).length === 0) continue;
        const last = groups[groups.length - 1];
        if (last !== undefined && x - last[1] <= 2.5 * scale) last[1] = x;
        else groups.push([x, x]);
      }
      return groups.map(([from, to]) => {
        const rows = rowsWithInk(from, to);
        return (rows[0] + rows[rows.length - 1] + 1) / 2 / scale - height / 2 / scale;
      });
    }, png);
  }

  // Capitals only: ascenders and descenders pull the drawn text away from the capitals' middle.
  for (const runtime of ["docker", "podman", "c9s"]) {
    test(`dot, name and icon share one middle: ${runtime}`, async ({ page }) => {
      await page.addInitScript((value) => {
        (window as unknown as { __CLAB_UI_HARNESS_LAB_HOST_IDENTITY__?: unknown }).__CLAB_UI_HARNESS_LAB_HOST_IDENTITY__ = {
          id: "host",
          label: "HEH",
          kind: "server",
          runtime: value,
          status: "connected"
        };
      }, runtime);
      await page.goto("/index.html");
      const offsets = await drawnOffsets(page);
      expect(offsets).toHaveLength(3);
      for (const offset of offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(0.5);
    });
  }

  test("a shortened name keeps its descenders and its ellipsis", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __CLAB_UI_HARNESS_LAB_HOST_IDENTITY__?: unknown }).__CLAB_UI_HARNESS_LAB_HOST_IDENTITY__ = {
        id: "host",
        label: "a-very-long-cluster-name-gpq-typography",
        kind: "cluster",
        status: "connected"
      };
    });
    await page.setViewportSize({ width: 560, height: 400 });
    await page.goto("/index.html");
    const name = page.getByTestId("lab-host-chip").locator("span").first();
    await expect(name).toBeVisible();
    const { overflowing, belowBaseline } = await name.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        overflowing: element.scrollWidth > element.clientWidth,
        belowBaseline: parseFloat(style.paddingBottom) / parseFloat(style.fontSize)
      };
    });
    expect(overflowing).toBe(true);
    // A descender reaches about a quarter of the font size below the baseline.
    expect(belowBaseline).toBeGreaterThan(0.25);
  });
});
