import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const labs = [
  { id: "midnight-fabric", nodes: 10, groups: 4, shapes: 0, text: "EVERY RACK. TWO PATHS." },
  { id: "fabric-101", nodes: 3, groups: 3, shapes: 0, text: "Small fabric. Every detail." },
  { id: "security-zones", nodes: 6, groups: 3, shapes: 1, text: "Draw the trust boundary." },
  { id: "wan-ring", nodes: 6, groups: 0, shapes: 1, text: "The long way is still a way." },
  { id: "packet-walk", nodes: 3, groups: 2, shapes: 2, text: "Follow one packet." }
];

test("all five gallery labs render their saved nodes, groups, notes, and shapes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("viewer/customize/");
  for (const lab of labs) {
    const example = page.locator(`.studio-example#${lab.id}`);
    const component = example.locator("clab-topology");
    await component.scrollIntoViewIfNeeded();
    await expect(component).toHaveAttribute("data-loaded", "true");
    const viewer = component.frameLocator("iframe");
    await expect(viewer.locator(".react-flow__node-topology-node")).toHaveCount(lab.nodes);
    await expect(viewer.locator(".react-flow__node-group-node")).toHaveCount(lab.groups);
    await expect(viewer.locator(".react-flow__node-free-shape-node")).toHaveCount(lab.shapes);
    await expect(viewer.getByText(lab.text, { exact: true })).toBeVisible();
    // Annotation text must fit its saved box, including paired interface/IP labels.
    const clipped = await viewer.locator(".free-text-markdown").evaluateAll(elements => elements.filter(element => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1).map(element => element.textContent));
    expect(clipped).toEqual([]);
    await example.screenshot({ path: `test-results/docs/studio-${lab.id}.png` });
  }
  expect(errors).toEqual([]);
});

test("the studio composes options and exports the customized annotations and recipe", async ({ page }) => {
  await page.goto("viewer/customize/");
  const studio = page.locator("clab-customizer");
  const component = studio.locator("clab-topology");
  await expect(component).toHaveAttribute("data-loaded", "true");
  await studio.getByRole("combobox", { name: "Topology", exact: true }).selectOption("packet-walk");
  await studio.getByRole("combobox", { name: "Palette", exact: true }).selectOption("blueprint");
  await studio.getByRole("combobox", { name: "Presentation", exact: true }).selectOption("split");
  await studio.getByRole("combobox", { name: "Grid", exact: true }).selectOption("lines");
  await studio.getByRole("combobox", { name: "Interfaces", exact: true }).selectOption("on-select");
  await studio.getByLabel("Groups", { exact: true }).uncheck();
  await studio.getByLabel("Notes & IPs", { exact: true }).uncheck();
  await studio.getByLabel("Node corners", { exact: true }).fill("22");
  await expect(component).toHaveAttribute("data-loaded", "true");
  await expect(component).toHaveAttribute("view", "split");
  const viewer = component.frameLocator("iframe");
  await expect(viewer.locator("html")).toHaveAttribute("data-clab-theme", "dark");
  await expect(viewer.locator(".react-flow__node-topology-node")).toHaveCount(3);
  await expect(viewer.locator(".react-flow__node-group-node")).toHaveCount(0);
  await expect(viewer.locator(".react-flow__node-free-text-node")).toHaveCount(0);
  await expect(viewer.locator(".react-flow__node-free-shape-node")).toHaveCount(2);
  await expect(viewer.locator(".react-flow")).toHaveCSS("background-color", "rgb(16, 45, 80)");
  await expect(component.locator(".clab-source")).toContainText("net.ipv4.ip_forward");
  await studio.getByRole("button", { name: "Copy recipe" }).click();
  const recipe = await page.evaluate(() => navigator.clipboard.readText());
  expect(recipe).toContain('file="examples/packet-walk.clab.yml"');
  expect(recipe).toContain('view="split"');
  expect(recipe).toContain('grid="lines"');
  expect(recipe).toContain("--clab-surface: #102d50");
  const pending = page.waitForEvent("download");
  await studio.getByRole("button", { name: "Annotations ↓" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("packet-walk.clab.yml.annotations.json");
  const annotations = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(annotations.groupStyleAnnotations).toEqual([]);
  expect(annotations.freeTextAnnotations).toEqual([]);
  expect(annotations.nodeAnnotations[0].iconCornerRadius).toBe(22);
  expect(annotations.nodeAnnotations[0].iconColor).toBe("#a3e7ff");
  expect(annotations.nodeAnnotations[0].position).toEqual({ x: 65, y: 165 });
  expect(annotations.freeShapeAnnotations).toHaveLength(2);
  expect(annotations).toEqual(JSON.parse((await component.getAttribute("annotations"))!));
  const yamlPending = page.waitForEvent("download");
  await studio.getByRole("link", { name: "YAML ↓", exact: true }).click();
  const yamlDownload = await yamlPending;
  expect(await readFile((await yamlDownload.path())!, "utf8")).toBe(await readFile("docs/examples/packet-walk.clab.yml", "utf8"));
  await studio.getByRole("button", { name: "Reset style" }).click();
  await expect(studio.getByRole("combobox", { name: "Topology", exact: true })).toHaveValue("packet-walk");
  await expect(studio.getByRole("combobox", { name: "Palette", exact: true })).toHaveValue("original");
  await expect(component).toHaveAttribute("data-loaded", "true");
  await expect(viewer.locator(".react-flow__node-free-text-node")).toHaveCount(8);
});

test("remix links and instant navigation initialize the studio on mobile without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("examples/");
  await page.getByRole("link", { name: "customization studio", exact: true }).click();
  const studio = page.locator("clab-customizer");
  await expect(studio.locator("clab-topology")).toHaveAttribute("data-loaded", "true");
  await page.locator("#wan-ring [data-remix]").click();
  await expect(studio.getByRole("combobox", { name: "Topology", exact: true })).toHaveValue("wan-ring");
  await expect(studio.locator("clab-topology")).toHaveAttribute("data-loaded", "true");
  await expect(studio.locator("clab-topology").frameLocator("iframe").locator(".react-flow__node-topology-node")).toHaveCount(6);
  await page.locator('label[title="Switch to light mode"]').click();
  await expect(studio.locator("clab-topology").frameLocator("iframe").locator("html")).toHaveAttribute("data-clab-theme", "dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await studio.screenshot({ path: "test-results/docs/studio-mobile.png" });
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(/examples\/$/);
  await page.goForward();
  await expect(studio.locator("clab-topology")).toHaveAttribute("data-loaded", "true");
});

test("a failed lab fetch leaves the gallery usable and a different selection recovers", async ({ page }) => {
  await page.route("**/examples/midnight-fabric.clab.yml.annotations.json", route => route.abort());
  await page.goto("viewer/customize/");
  const studio = page.locator("clab-customizer");
  await expect(studio.locator(".studio-status")).toContainText("Could not load this lab");
  await expect(studio.getByRole("button", { name: "Copy recipe" })).toBeDisabled();
  await studio.getByRole("combobox", { name: "Topology", exact: true }).selectOption("fabric-101");
  await expect(studio.locator("clab-topology")).toHaveAttribute("data-loaded", "true");
  await expect(studio.getByRole("button", { name: "Copy recipe" })).toBeEnabled();
  await expect(studio.locator(".studio-status")).toBeEmpty();
});
