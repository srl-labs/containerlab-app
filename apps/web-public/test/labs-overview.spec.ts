import type { Page } from "@playwright/test";
import { expect, test, waitForWorkspace } from "@srl-labs/containerlab-test-kit/playwright";

const FABRIC_YAML = [
  "name: fabric",
  "topology:",
  "  nodes:",
  "    leaf1: { kind: linux, image: alpine:latest }",
  "    leaf2: { kind: linux, image: alpine:latest }",
  "    client: { kind: linux, image: alpine:latest }",
  "  links:",
  "    - endpoints: [leaf1:eth1, leaf2:eth1]",
  "    - endpoints: [client:eth1, leaf1:eth2]",
  "    - endpoints: [client:eth2, host:client-eth2]",
  ""
].join("\n");

const FABRIC_ANNOTATIONS = JSON.stringify({
  nodeAnnotations: [
    { id: "leaf1", position: { x: 0, y: 0 } },
    { id: "leaf2", position: { x: 600, y: 0 } },
    { id: "client", position: { x: 300, y: 300 } }
  ]
});

const FABRIC_CARD = "lab-card-pages-sandbox::fabric/fabric.clab.yml";

/** Seeds the sandbox files once per browser session, so reloads keep later changes. */
async function seedLabs(page: Page): Promise<void> {
  await page.addInitScript((files) => {
    if (sessionStorage.getItem("labs-overview-seeded") !== null) return;
    sessionStorage.setItem("labs-overview-seeded", "1");
    localStorage.setItem("clab-pages-sandbox-files-v1", files);
  }, JSON.stringify({
    "fabric/fabric.clab.yml": FABRIC_YAML,
    "fabric/fabric.clab.yml.annotations.json": FABRIC_ANNOTATIONS,
    "notes/empty.clab.yml": "name: empty\ntopology:\n  nodes: {}\n"
  }));
}

async function openOverview(page: Page) {
  const button = page.getByTestId("workspace-overview-button");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const overview = page.getByTestId("labs-overview");
  await expect(overview).toBeVisible();
  return overview;
}

test("labs overview lists topology files as cards and opens them", async ({ page }) => {
  await seedLabs(page);
  await page.goto("/");
  await waitForWorkspace(page);
  const overview = await openOverview(page);

  // Without lab lifecycle nothing runs: one section, no state filters and no deploy action.
  await expect(overview.getByTestId("labs-overview-section-running")).toHaveCount(0);
  await expect(overview.getByTestId("labs-overview-filter-running")).toHaveCount(0);
  const section = overview.getByTestId("labs-overview-section-undeployed");
  await expect(section.getByRole("article")).toHaveCount(2);
  const card = overview.getByTestId(FABRIC_CARD);
  await expect(card).toHaveAttribute("data-state", "undeployed");
  await expect(card.getByTestId("lab-card-state")).toHaveText("Not deployed");
  await expect(card.getByRole("button", { name: "Deploy fabric", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("connection-banner")).toHaveCount(0);

  // The thumbnail draws node icons at the saved positions and the links between nodes, not to the host.
  const thumbnail = card.getByTestId("lab-card-thumbnail");
  await expect(thumbnail).toHaveAttribute("data-loaded", "true");
  await expect(thumbnail.locator("[data-node] image")).toHaveCount(3);
  await expect(thumbnail.locator("line[data-link]")).toHaveCount(2);
  const [leaf1, leaf2, client] = await Promise.all(["leaf1", "leaf2", "client"].map((id) =>
    thumbnail.locator(`[data-node='${id}'] image`).boundingBox()));
  expect(leaf1!.y).toBeCloseTo(leaf2!.y, 0);
  expect(leaf1!.x).toBeLessThan(client!.x);
  expect(client!.x).toBeLessThan(leaf2!.x);
  expect(client!.y).toBeGreaterThan(leaf1!.y);

  const search = overview.getByTestId("labs-overview-search");
  await search.fill("emp");
  await expect(section.getByRole("article")).toHaveCount(1);
  await expect(overview.getByTestId("lab-card-pages-sandbox::notes/empty.clab.yml")).toBeVisible();
  await overview.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(section.getByRole("article")).toHaveCount(2);

  await card.getByRole("button", { name: "Open fabric", exact: true }).click();
  await expect(overview).toBeHidden();
  await expect(page.getByTestId("workspace-overview-button")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("tab", { name: "fabric", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".react-flow__node[data-id='leaf1']")).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe("?lab=pages-sandbox::fabric/fabric.clab.yml");

  // While the overview covers the document, no tab looks selected.
  await openOverview(page);
  await expect(page.getByRole("tab", { name: "fabric", exact: true })).toHaveAttribute("aria-selected", "false");
  await page.getByRole("tab", { name: "fabric", exact: true }).click();
  await expect(page.getByTestId("labs-overview")).toBeHidden();
  await expect(page.getByRole("tab", { name: "fabric", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("collapsed overview sections stay collapsed and links copy the lab address", async ({ page }) => {
  await seedLabs(page);
  await page.goto("/");
  await waitForWorkspace(page);
  let overview = await openOverview(page);
  const toggle = overview.getByRole("button", { name: /^Not deployed/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(overview.getByRole("article")).toHaveCount(0);

  await page.reload();
  await waitForWorkspace(page);
  overview = await openOverview(page);
  const reloadedToggle = overview.getByRole("button", { name: /^Not deployed/ });
  await expect(reloadedToggle).toHaveAttribute("aria-expanded", "false");
  await reloadedToggle.click();
  await expect(overview.getByRole("article")).toHaveCount(2);

  await overview.getByTestId(FABRIC_CARD).getByRole("button", { name: "Copy link to fabric", exact: true }).click();
  await expect(page.getByText("Copied a link to fabric.", { exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  expect(await page.evaluate(() => navigator.clipboard.readText()))
    .toBe(`${origin}/?lab=pages-sandbox::fabric/fabric.clab.yml`);
});

test("a lab link opens the lab and centers the linked node", async ({ page }) => {
  await seedLabs(page);
  await page.goto("/?lab=pages-sandbox::fabric/fabric.clab.yml&node=leaf2");
  await waitForWorkspace(page);
  await expect(page.getByRole("tab", { name: "fabric", exact: true })).toHaveAttribute("aria-selected", "true");
  const node = page.locator(".react-flow__node[data-id='leaf2']");
  await expect(node).toBeVisible();
  // A fit of the whole lab leaves leaf2 at the right edge; focusing it centers it.
  await expect.poll(async () => {
    const [nodeBox, canvasBox] = await Promise.all([
      node.boundingBox(),
      page.locator(".react-flow").first().boundingBox()
    ]);
    if (!nodeBox || !canvasBox) return Number.POSITIVE_INFINITY;
    return Math.abs(nodeBox.x + nodeBox.width / 2 - (canvasBox.x + canvasBox.width / 2));
  }, { timeout: 15_000 }).toBeLessThan(40);
  expect(new URL(page.url()).search).toBe("?lab=pages-sandbox::fabric/fabric.clab.yml&node=leaf2");

  // Choosing another document moves the address on and drops the node.
  await page.goto("/?lab=pages-sandbox::notes/missing.clab.yml");
  await waitForWorkspace(page);
  await expect(page.getByText("The linked lab notes/missing.clab.yml is not on any connected lab host.", { exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).search).toBe("");
});

test("the overview offers to create the first lab", async ({ page }) => {
  await page.goto("/");
  await waitForWorkspace(page);
  const overview = await openOverview(page);
  await expect(overview.getByText("No labs yet", { exact: true })).toBeVisible();
  await overview.getByRole("button", { name: "Create your first lab", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Topology file name" }).fill("first.clab.yml");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("tab", { name: "first", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(overview).toBeHidden();
  await openOverview(page);
  await expect(page.getByTestId("lab-card-pages-sandbox::first.clab.yml")).toBeVisible();
  await page.getByRole("button", { name: "Close labs overview", exact: true }).click();
  await expect(page.getByTestId("labs-overview")).toBeHidden();
});
