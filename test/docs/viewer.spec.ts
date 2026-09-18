import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("landing example renders the real graph and links a selected node to its YAML", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The GUI for containerlab.");
  await expect(page.getByText("Diagrams that speak YAML", { exact: true })).toHaveCount(0);
  await expect(page.locator(".hero-eyebrow, .hero-caption")).toHaveCount(0);
  const component = page.locator("clab-topology");
  await expect(component).toHaveAttribute("data-loaded", "true");
  const viewer = component.frameLocator("iframe");
  await expect(viewer.locator(".react-flow__node-topology-node")).toHaveCount(8);
  await expect(viewer.locator(".react-flow__edge")).toHaveCount(9);
  await expect(viewer.locator(".topology-node-runtime-badge")).toHaveCount(0);
  await viewer.locator('.react-flow__node[data-id="leaf2"]').click();
  await expect(component.getByLabel("Inspect a node")).toHaveValue("leaf2");
  await expect(component.locator(".clab-node-detail")).toContainText("nokia_srlinux");
  await expect(component.locator(".clab-line-selected").first()).toContainText("leaf2:");
  await component.getByRole("tab", { name: "Topology", exact: true }).click();
  await expect(component.locator(".clab-code")).toBeHidden();
  await component.getByRole("button", { name: "Show in YAML" }).click();
  await expect(component).toHaveAttribute("data-view", "split");
  await expect(component.locator(".clab-line-selected").first()).toBeInViewport();
  await expect(viewer.locator(".react-flow__node-topology-node")).toHaveCount(8);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: "test-results/docs/home-desktop.png", fullPage: true });
});

test("the full sidebar keeps categories and the active page together across instant navigation", async ({ page }) => {
  await page.goto("guides/topologies/");
  const sidebar = page.locator(".md-sidebar--primary");
  const groups = ["Get started", "Installation", "User guide", "Examples", "Developers", "Resources"];
  for (const group of groups) {
    await expect(sidebar.locator("label.md-nav__link").getByText(group, { exact: true })).toBeVisible();
  }
  await expect(sidebar.locator("a.md-nav__link--active")).toHaveText("Design a topology");
  await expect(sidebar.getByRole("link", { name: "Layouts and templates", exact: true })).toBeVisible();
  await expect(page.locator(".md-path")).toContainText("User guide");
  await expect(page.locator(".md-tabs")).toHaveCount(0);

  await sidebar.locator("label.md-nav__link").getByText("Installation", { exact: true }).click();
  await sidebar.getByRole("link", { name: "Desktop app", exact: true }).click();
  await expect(page).toHaveURL(/manual\/gui\/desktop\//);
  await expect(sidebar.locator("a.md-nav__link--active")).toHaveText("Desktop app");
  await expect(sidebar.getByRole("link", { name: "VS Code extension", exact: true })).toBeVisible();
  await expect(page.locator(".md-path")).toContainText("Installation");

  await sidebar.locator("label.md-nav__link").getByText("Developers", { exact: true }).click();
  await sidebar.locator("label.md-nav__link").getByText("Standalone viewer", { exact: true }).click();
  await sidebar.getByRole("link", { name: "Zensical integration", exact: true }).click();
  await expect(page).toHaveURL(/\/viewer\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Diagrams that speak YAML");
  await expect(sidebar.locator("a.md-nav__link--active")).toHaveText("Zensical integration");
  await expect(page.locator(".md-path")).toContainText("Developers");
  await expect(page.locator(".md-path")).toContainText("Standalone viewer");
  for (const group of groups) {
    await expect(sidebar.locator("label.md-nav__link").getByText(group, { exact: true })).toBeVisible();
  }
});

test("mobile navigation exposes the same hierarchy and closes when a guide is selected", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("viewer/");
  await page.locator('.md-header label[for="__drawer"]').click();
  await expect(page.locator("#__drawer")).toBeChecked();
  const sidebar = page.locator(".md-sidebar--primary");
  await expect(sidebar.locator("label.md-nav__link").getByText("Developers", { exact: true })).toBeInViewport();
  await expect(sidebar.locator("label.md-nav__link").getByText("Standalone viewer", { exact: true })).toBeInViewport();
  await expect(sidebar.locator("a.md-nav__link--active")).toHaveText("Zensical integration");
  await sidebar.locator("label.md-nav__link").getByText("User guide", { exact: true }).click();
  await sidebar.getByRole("link", { name: "Keyboard shortcuts", exact: true }).click();
  await expect(page).toHaveURL(/guides\/shortcuts\//);
  await expect(page.locator("#__drawer")).not.toBeChecked();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Keyboard shortcuts");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.md-header label[for="__drawer"]').click();
  await expect(sidebar.locator("a.md-nav__link--active")).toHaveText("Keyboard shortcuts");
  await expect(sidebar.locator("label.md-nav__link").getByText("User guide", { exact: true })).toBeInViewport();
});

test("copy and download contain the original YAML, and tabs work from the keyboard", async ({ page }) => {
  await page.goto("examples/linux/");
  const component = page.locator("clab-topology");
  await component.getByRole("tab", { name: "Topology", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await expect(component.getByRole("tab", { name: "YAML", exact: true })).toBeFocused();
  await expect(component).toHaveAttribute("data-view", "yaml");
  const yaml = await readFile("docs/examples/linux.clab.yml", "utf8");
  await component.getByRole("button", { name: "Copy YAML", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(yaml);
  const pending = page.waitForEvent("download");
  await component.getByRole("button", { name: "Download YAML" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("linux.clab.yml");
  expect(await readFile((await download.path())!, "utf8")).toBe(yaml);
});

test("theme changes preserve the iframe, and instant navigation initializes new examples", async ({ page }) => {
  await page.goto("./");
  const component = page.locator("clab-topology");
  await expect(component).toHaveAttribute("data-loaded", "true");
  await component.locator("iframe").evaluate((frame) => frame.setAttribute("data-preserved", "true"));
  await page.locator('label[title="Switch to light mode"]').click();
  await expect(component.frameLocator("iframe").locator("html")).toHaveAttribute("data-clab-theme", "light");
  await expect(component.locator("iframe")).toHaveAttribute("data-preserved", "true");
  await page.evaluate(() => { (window as unknown as { docsNavigationMarker: boolean }).docsNavigationMarker = true; });
  await page.getByRole("link", { name: "Build your first lab" }).click();
  await expect(page).toHaveURL(/getting-started\/first-lab\//);
  expect(await page.evaluate(() => (window as unknown as { docsNavigationMarker: boolean }).docsNavigationMarker)).toBe(true);
  await expect(page.locator("clab-topology")).toHaveAttribute("data-loaded", "true");
  await expect(page.frameLocator("clab-topology iframe").locator(".react-flow__node-topology-node")).toHaveCount(2);
  await page.goBack();
  await expect(page.locator("clab-topology")).toHaveAttribute("data-loaded", "true");
  await expect(page.frameLocator("clab-topology iframe").locator(".react-flow__node-topology-node")).toHaveCount(8);
});

test("multiple components stay independent and YAML-first examples defer loading", async ({ page }) => {
  await page.goto("examples/linux/");
  await expect(page.locator("clab-topology")).toHaveAttribute("data-loaded", "true");
  await page.evaluate(() => {
    const second = document.createElement("clab-topology");
    second.setAttribute("title", "Independent viewer");
    second.setAttribute("view", "yaml");
    const pre = document.createElement("pre");
    pre.textContent = "name: independent\ntopology:\n  nodes:\n    independent: {kind: linux, image: alpine:3.23}\n";
    second.append(pre);
    document.querySelector("clab-topology")!.after(second);
  });
  const second = page.locator("clab-topology").nth(1);
  await second.scrollIntoViewIfNeeded();
  await expect(second.locator("iframe")).toHaveCount(0);
  await second.getByRole("tab", { name: "Topology", exact: true }).click();
  await expect(second).toHaveAttribute("data-loaded", "true");
  await expect(second.frameLocator("iframe").locator(".react-flow__node-topology-node")).toHaveCount(1);
  await expect(page.locator("clab-topology").first().frameLocator("iframe").locator(".react-flow__node-topology-node")).toHaveCount(2);
  // Same-origin messages from any other window must not impersonate the iframe.
  await page.evaluate(() => window.postMessage({ type: "clab-viewer:error", message: "spoofed" }, location.origin));
  await expect(second.locator(".clab-loading")).toBeHidden();
});

test("mobile layout has no horizontal overflow and retains all controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  const component = page.locator("clab-topology");
  await component.scrollIntoViewIfNeeded();
  await expect(component).toHaveAttribute("data-loaded", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(component.getByRole("button", { name: "Download YAML" })).toBeVisible();
  await component.getByRole("tab", { name: "YAML", exact: true }).click();
  await expect(component.locator(".clab-source")).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: "test-results/docs/home-mobile.png", fullPage: true });
});

test("invalid examples show an error while preserving the source", async ({ page }) => {
  await page.goto("viewer/reference/");
  await page.evaluate(() => {
    const element = document.createElement("clab-topology");
    const pre = document.createElement("pre");
    pre.textContent = "name: missing-topology";
    element.append(pre);
    document.querySelector("article")!.prepend(element);
  });
  const component = page.locator("clab-topology");
  await expect(component.locator(".clab-load-error")).toContainText("topology.nodes");
  await component.getByRole("tab", { name: "YAML", exact: true }).click();
  await expect(component.locator(".clab-source")).toContainText("name: missing-topology");
});

test("YAML stays readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:8011/containerlab-app/docs/getting-started/first-lab/");
  await expect(page.locator("clab-topology .clab-source")).toBeVisible();
  await expect(page.locator("clab-topology .clab-source")).toContainText("10.10.10.1/24");
  await page.goto("http://127.0.0.1:8011/containerlab-app/docs/guides/topologies/");
  await expect(page.locator("clab-topology[borderless] .clab-source")).toBeVisible();
  await expect(page.locator("clab-topology[borderless] .clab-source")).toContainText("name: fabric");
  await context.close();
});

for (const route of ["examples/linux/", "guides/topologies/"]) {
  test(`mouse-wheel zoom works inside the canvas on ${route}`, async ({ page }) => {
    await page.goto(route);
    const component = page.locator("clab-topology");
    await component.scrollIntoViewIfNeeded();
    await expect(component).toHaveAttribute("data-loaded", "true");
    const viewer = component.frameLocator("iframe");
    await expect(viewer.locator(".react-flow__node").first()).toBeVisible();
    const viewport = viewer.locator(".react-flow__viewport");
    const zoom = () => viewport.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
    // Let the initial fit settle before measuring wheel-driven changes.
    await page.waitForTimeout(300);
    const before = await zoom();
    const scroll = await page.evaluate(() => window.scrollY);
    const box = (await component.locator("iframe").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await expect.poll(zoom).toBeGreaterThan(before * 1.1);
    const enlarged = await zoom();
    await page.mouse.wheel(0, 300);
    await expect.poll(zoom).toBeLessThan(enlarged);
    expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  });
}

test("borderless diagrams show only a transparent canvas in both themes", async ({ page }) => {
  await page.goto("guides/topologies/");
  const component = page.locator("clab-topology[borderless]");
  await expect(component).toHaveAttribute("data-loaded", "true");
  await expect(component.getByRole("region", { name: "Leaf–spine fabric" })).toBeVisible();
  for (const selector of [".clab-component-heading", ".clab-toolbar", ".clab-inspector", ".clab-component-footer"]) {
    await expect(component.locator(selector)).toBeHidden();
  }
  await expect(component).toHaveCSS("border-width", "0px");
  await expect(component).toHaveCSS("box-shadow", "none");
  await expect(component).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const viewer = component.frameLocator("iframe");
  await expect(viewer.locator(".react-flow__controls")).toBeHidden();
  await expect(viewer.locator(".react-flow__background")).toBeHidden();
  for (const mode of ["dark", "light"]) {
    if (mode === "light") await page.locator('label[title="Switch to light mode"]').click();
    await expect(viewer.locator("html")).toHaveAttribute("data-clab-theme", mode);
    await expect(viewer.locator("html")).toHaveCSS("color-scheme", mode);
    await expect(component.locator("iframe")).toHaveCSS("color-scheme", mode);
    const opaqueAncestors = await viewer.locator(".react-flow").evaluate((element) => {
      const opaque = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        if (getComputedStyle(node).backgroundColor !== "rgba(0, 0, 0, 0)") opaque.push(node.className || node.tagName);
      }
      return opaque;
    });
    expect(opaqueAncestors).toEqual([]);
    await expect(viewer.locator(".react-flow__node-topology-node")).toHaveCount(8);
  }
});

test("a failed borderless viewer exposes readable YAML and can retry", async ({ page }) => {
  await page.goto("viewer/reference/");
  await page.evaluate(() => {
    const element = document.createElement("clab-topology");
    element.setAttribute("borderless", "");
    const pre = document.createElement("pre");
    pre.textContent = "name: missing-topology";
    element.append(pre);
    document.querySelector("article")!.prepend(element);
  });
  const component = page.locator("clab-topology");
  await expect(component.locator(".clab-load-error")).toContainText("topology.nodes");
  await expect(component.locator(".clab-source")).toBeVisible();
  await expect(component.locator(".clab-source")).toContainText("name: missing-topology");
  await component.getByRole("button", { name: "Retry viewer" }).click();
  await expect(component.locator(".clab-load-error")).toContainText("topology.nodes");
  await expect(component.locator(".clab-source")).toBeVisible();
});

test("the page outline tracks the current section", async ({ page }) => {
  await page.goto("guides/topologies/");
  const toc = page.locator(".md-sidebar--secondary");
  await toc.getByRole("link", { name: "Topology editor", exact: true }).click();
  await expect(page).toHaveURL(/#topology-editor$/);
  await expect(toc.getByRole("link", { name: "Topology editor", exact: true })).toHaveClass(/md-nav__link--active/);
  await expect(page.locator("#topology-editor")).toBeInViewport();
  await toc.getByRole("link", { name: "Follow the connections", exact: true }).click();
  await expect(toc.getByRole("link", { name: "Follow the connections", exact: true })).toHaveClass(/md-nav__link--active/);
});

test("full screen and read-only interactions preserve the topology", async ({ page }) => {
  await page.goto("examples/linux/");
  const component = page.locator("clab-topology");
  await expect(component).toHaveAttribute("data-loaded", "true");
  const viewer = component.frameLocator("iframe");
  const node = viewer.locator('[data-id="client"]');
  await expect(node).toBeVisible();
  const before = await node.getAttribute("style");
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  expect(await node.getAttribute("style")).toBe(before);
  await component.getByRole("button", { name: "Expand example" }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe("CLAB-TOPOLOGY");
  await component.getByRole("button", { name: "Exit full screen" }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null);
  await component.getByRole("button", { name: "Fit topology" }).click();
  await expect(viewer.locator(".react-flow__node-topology-node")).toHaveCount(2);
});
