import { expect, test } from "@playwright/test";

const yaml = "name: custom\ntopology:\n  defaults: {kind: linux, image: alpine}\n  nodes:\n    a: {}\n    b: {}\n  links:\n    - endpoints: [a:eth1, b:eth1]\n";

test("an early loader waits for the generated YAML before upgrading streamed markup", async ({ page }) => {
  await page.goto("viewer/reference/");
  await page.evaluate(() => {
    const element = document.createElement("clab-topology");
    element.setAttribute("data-clab-generated", "");
    element.setAttribute("loading", "eager");
    document.querySelector("article")!.prepend(element);
  });
  const component = page.locator("clab-topology");
  await expect(component.locator("iframe")).toHaveCount(0);
  await component.evaluate((element, source) => {
    const pre = document.createElement("pre"); pre.textContent = source; element.append(pre);
  }, yaml);
  await expect(component.locator("iframe")).toHaveCount(0);
  await component.evaluate(element => {
    const end = document.createElement("span"); end.dataset.clabEnd = ""; end.hidden = true; element.append(end);
  });
  await expect(component).toHaveAttribute("data-loaded", "true");
  await expect(component.frameLocator("iframe").locator(".react-flow__node-topology-node")).toHaveCount(2);
  await expect(component.locator(".clab-source")).toContainText("name: custom");
});

test("borderless options compose with tabs, controls, a fixed theme, and canvas colors", async ({ page }) => {
  await page.goto("viewer/reference/");
  await page.evaluate(source => {
    const element = document.createElement("clab-topology");
    for (const [key, value] of Object.entries({ borderless: "", view: "split", toolbar: "true", controls: "true", grid: "lines", transparent: "false", theme: "light", "node-labels": "false", "link-labels": "hide", zoom: "false", pan: "false", loading: "eager" })) element.setAttribute(key, value);
    element.style.setProperty("--clab-surface", "#f5f3ff");
    element.style.setProperty("--clab-edge", "#8b7aa8");
    element.style.setProperty("--clab-raised", "#e0d8ff");
    const pre = document.createElement("pre"); pre.textContent = source; element.append(pre);
    document.querySelector("article")!.prepend(element);
  }, yaml);
  const component = page.locator("clab-topology");
  await expect(component).toHaveAttribute("data-loaded", "true");
  await expect(component.locator(".clab-toolbar")).toBeVisible();
  for (const selector of [".clab-component-heading", ".clab-inspector", ".clab-component-footer"]) await expect(component.locator(selector)).toBeHidden();
  await expect(component.locator(".clab-source")).toBeVisible();
  const viewer = component.frameLocator("iframe");
  await expect(viewer.locator(".react-flow__controls")).toBeVisible();
  await expect(viewer.locator(".react-flow__background")).toBeVisible();
  await expect(viewer.locator(".react-flow")).toHaveCSS("background-color", "rgb(245, 243, 255)");
  await expect(viewer.locator(".react-flow__edge-path")).toHaveCSS("stroke", "rgb(139, 122, 168)");
  await expect(viewer.locator(".react-flow__controls-button").first()).toHaveCSS("background-color", "rgb(224, 216, 255)");
  await expect(viewer.locator(".topology-node-label")).toHaveCount(0);
  await expect(viewer.locator("html")).toHaveAttribute("data-clab-theme", "light");
  await page.locator('label[title="Switch to light mode"]').click();
  await expect(viewer.locator("html")).toHaveAttribute("data-clab-theme", "light");
  await expect(viewer.locator(".react-flow")).toHaveCSS("background-color", "rgb(245, 243, 255)");
  const viewport = viewer.locator(".react-flow__viewport");
  const transform = await viewport.getAttribute("style");
  const bounds = (await component.locator("iframe").boundingBox())!;
  await page.mouse.move(bounds.x + 12, bounds.y + 12);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 70, bounds.y + 40, { steps: 4 });
  await page.mouse.up();
  await page.mouse.wheel(0, 150);
  await page.waitForTimeout(150);
  expect(await viewport.getAttribute("style")).toBe(transform);
});

test("rich annotations retain saved positions and stay read-only", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("viewer/reference/");
  await page.evaluate(source => {
    const element = document.createElement("clab-topology");
    element.setAttribute("loading", "eager");
    element.setAttribute("annotations", JSON.stringify({
      nodeAnnotations: [{ id: "a", position: { x: 80, y: 80 }, groupId: "g" }, { id: "b", position: { x: 300, y: 80 }, groupId: "g" }],
      groupStyleAnnotations: [{ id: "g", name: "Saved group", position: { x: 30, y: 30 }, width: 380, height: 140 }],
      freeTextAnnotations: [{ id: "note", text: "**Saved note**", position: { x: 80, y: 230 }, width: 160, height: 50 }],
      freeShapeAnnotations: [{ id: "shape", shapeType: "rectangle", position: { x: 300, y: 230 }, width: 90, height: 50 }]
    }));
    const pre = document.createElement("pre"); pre.textContent = source; element.append(pre);
    document.querySelector("article")!.prepend(element);
  }, yaml);
  const component = page.locator("clab-topology");
  await expect(component).toHaveAttribute("data-loaded", "true");
  const viewer = component.frameLocator("iframe");
  await expect(viewer.getByText("Saved group", { exact: true })).toBeVisible();
  await expect(viewer.locator(".react-flow__node-free-text-node strong")).toHaveText("Saved note");
  await expect(viewer.locator(".react-flow__node-free-shape-node")).toBeVisible();
  await expect(viewer.locator('[data-id="a"]')).toHaveCSS("transform", "matrix(1, 0, 0, 1, 80, 80)");
  for (const id of ["note", "shape", "g"]) {
    const node = viewer.locator(`.react-flow__node[data-id="${id}"]`);
    const position = await node.evaluate(element => getComputedStyle(element).transform);
    const bounds = (await node.boundingBox())!;
    await page.mouse.move(bounds.x + 10, bounds.y + 10);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 45, bounds.y + 30, { steps: 4 });
    await page.mouse.up();
    await node.press("Delete");
    await expect(node).toBeVisible();
    await expect(node).toHaveCSS("transform", position);
  }
  expect(errors).toEqual([]);
});

test("a failed annotation chunk reports an error and keeps the YAML accessible", async ({ page }) => {
  await page.route("**/GroupNode-*.js", route => route.abort());
  await page.goto("viewer/reference/");
  await page.evaluate(source => {
    const element = document.createElement("clab-topology");
    element.setAttribute("loading", "eager");
    element.setAttribute("borderless", "");
    element.setAttribute("annotations", JSON.stringify({ groupStyleAnnotations: [{ id: "g", name: "Group", position: { x: 0, y: 0 }, width: 300, height: 200 }] }));
    const pre = document.createElement("pre"); pre.textContent = source; element.append(pre);
    document.querySelector("article")!.prepend(element);
  }, yaml);
  const component = page.locator("clab-topology");
  await expect(component.locator(".clab-load-error")).toBeVisible();
  await expect(component.locator(".clab-source")).toContainText("name: custom");
  await expect(component.locator(".clab-source")).toBeVisible();
});
