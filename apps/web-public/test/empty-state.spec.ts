import { expect, test } from "@playwright/test";

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

test("dotted artwork stays unchanged at idle and while hovering or pinning the rail", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const artwork = page.getByTestId("empty-state-artwork");
  await expect(artwork).toBeVisible();
  const bounds = (await artwork.boundingBox())!;
  const sampling = artwork.evaluate(async (svg) => {
    let changes = 0;
    const observer = new MutationObserver((records) => { changes += records.length; });
    observer.observe(svg, { attributes: true, subtree: true, childList: true });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return changes;
    } finally {
      observer.disconnect();
    }
  });
  const rail = page.getByTestId("workspace-rail");
  for (let index = 0; index < 3; index += 1) {
    await rail.getByRole("button", { name: "Labs", exact: true }).hover();
    await rail.getByRole("button", { name: "File Explorer", exact: true }).hover();
  }
  await rail.getByRole("button", { name: "Pin rail", exact: true }).click();
  await expect(rail).toHaveAttribute("data-pinned", "true");
  expect((await artwork.boundingBox())!.width).toBe(bounds.width - 148);
  await rail.getByRole("button", { name: "Unpin rail", exact: true }).click();
  expect(await artwork.boundingBox()).toEqual(bounds);
  expect(await sampling).toBe(0);
  expect(page.workers()).toHaveLength(0);
});
