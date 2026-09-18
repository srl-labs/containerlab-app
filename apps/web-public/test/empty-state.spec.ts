import { expect, test, type Page } from "@playwright/test";

async function sampleWaves(page: Page) {
  return page.getByTestId("empty-state-waves").evaluate((canvas) => new Promise<{ visible: number; colored: number; signature: number }>((resolve) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Wave canvas missing");
    requestAnimationFrame(() => {
      const gl = canvas.getContext("webgl2")!;
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let visible = 0;
      let colored = 0;
      let signature = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const [r, g, b, a] = pixels.subarray(index, index + 4);
        if (a > 10) visible += 1;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 20) colored += 1;
        signature += a * (index % 997);
      }
      resolve({ visible, colored, signature });
    });
  }));
}

test("dotted artwork is present with the first workspace render without a fallback or worker", async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = new Proxy(window.Worker, {
      construct() { throw new DOMException("Workers blocked", "SecurityError"); }
    });
    Object.defineProperty(window, "OffscreenCanvas", { value: undefined });
    const observer = new MutationObserver(() => {
      if (!document.querySelector("[data-testid='workspace-sidebar']")) return;
      const empty = document.querySelector("[data-testid='standalone-empty-lab-state']");
      document.documentElement.dataset.firstWorkspaceHasArtwork = String(
        !!empty?.querySelector("[data-testid='empty-state-artwork'] path") && !empty.querySelector("img, canvas")
      );
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  // The rail's optional logo may request this file; the empty workspace must not need it.
  await page.route("**/containerlab.svg", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-first-workspace-has-artwork", "true");
  const artwork = page.getByTestId("empty-state-artwork");
  await expect(artwork).toBeVisible();
  await expect(artwork).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.getByRole("button", { name: "Light mode", exact: true }).click();
  await expect(artwork).toHaveCSS("color", "rgb(0, 0, 0)");
  expect(page.workers()).toHaveLength(0);
  await page.getByRole("button", { name: "Create a lab", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("dotted artwork animates without interaction and while hovering or pinning the rail", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const waves = page.getByTestId("empty-state-waves");
  await expect(waves).toBeVisible();
  const bounds = (await waves.boundingBox())!;
  const initial = await sampleWaves(page);
  await page.waitForTimeout(350);
  expect((await sampleWaves(page)).signature).not.toBe(initial.signature);
  const rail = page.getByTestId("workspace-rail");
  for (let index = 0; index < 3; index += 1) {
    await rail.getByRole("button", { name: "Labs", exact: true }).hover();
    await rail.getByRole("button", { name: "File Explorer", exact: true }).hover();
  }
  await rail.getByRole("button", { name: "Pin rail", exact: true }).click();
  await expect(rail).toHaveAttribute("data-pinned", "true");
  expect((await waves.boundingBox())!.width).toBe(bounds.width - 148);
  await rail.getByRole("button", { name: "Unpin rail", exact: true }).click();
  expect(await waves.boundingBox()).toEqual(bounds);
  await expect(waves).toBeVisible();
  expect((await sampleWaves(page)).visible).toBeGreaterThan(1000);
  expect(page.workers()).toHaveLength(0);
});

test("hover twinkles and colored click ripples settle back to the ongoing ambient animation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const artwork = page.getByTestId("empty-state-artwork");
  const waves = page.getByTestId("empty-state-waves");
  await expect(waves).toBeVisible();
  const bounds = (await waves.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await expect(waves).toBeVisible();
  const hover = await sampleWaves(page);
  expect(hover.visible).toBeGreaterThan(1000);
  expect(hover.colored).toBe(0);
  await page.mouse.move(x + 80, y + 40, { steps: 5 });
  expect((await sampleWaves(page)).signature).not.toBe(hover.signature);
  await page.mouse.click(x, y);
  await expect.poll(async () => (await sampleWaves(page)).colored).toBeGreaterThan(100);
  // Multiple impulses can overlap without removing the field or blocking actions.
  await page.mouse.click(x + 120, y + 80);
  await page.mouse.click(x - 80, y - 60);
  await page.mouse.move(0, 0);
  await expect.poll(async () => (await sampleWaves(page)).colored, { timeout: 6000 }).toBe(0);
  await expect(waves).toBeVisible();
  const idle = await sampleWaves(page);
  await page.waitForTimeout(250);
  expect((await sampleWaves(page)).signature).not.toBe(idle.signature);

  await page.getByRole("button", { name: "Light mode", exact: true }).click();
  await page.mouse.click(x, y);
  await expect.poll(async () => (await sampleWaves(page)).colored).toBeGreaterThan(100);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(waves).toBeHidden();
  await expect(artwork).toBeVisible();
  await page.mouse.click(x + 80, y);
  await expect(waves).toBeHidden();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(waves).toBeVisible();
  await page.getByRole("button", { name: "Create a lab", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(errors).toEqual([]);
});

test("unavailable WebGL preserves the artwork and workspace actions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
      apply(target, receiver, args) {
        if (args[0] === "webgl2") return null;
        return Reflect.apply(target, receiver, args) as unknown;
      }
    });
  });
  await page.goto("/");
  const artwork = page.getByTestId("empty-state-artwork");
  await expect(artwork).toBeVisible();
  const bounds = (await artwork.boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(artwork).toBeVisible();
  await expect(page.getByTestId("empty-state-waves")).toHaveCount(0);
  await page.getByRole("button", { name: "Create a lab", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("waves recover to the SVG when their graphics context is lost", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const artwork = page.getByTestId("empty-state-artwork");
  const waves = page.getByTestId("empty-state-waves");
  await expect(waves).toBeVisible();
  const bounds = (await waves.boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await waves.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("Wave canvas missing");
    element.getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext();
  });
  await expect(waves).toBeHidden();
  await expect(artwork).toBeVisible();
  await page.mouse.move(bounds.x + 150, bounds.y + 250);
  await expect(waves).toBeHidden();
  await expect(artwork).toBeVisible();
});
