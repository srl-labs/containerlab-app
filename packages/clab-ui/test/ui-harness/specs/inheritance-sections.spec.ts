import type { Locator, Page } from "@playwright/test";
import * as YAML from "yaml";

import { test, expect } from "../fixtures/topoviewer";

const FILE = "inheritance.clab.yml";

const SEL_LAB_SETTINGS_BTN = '[data-testid="navbar-lab-settings"]';
const SEL_LAB_SETTINGS_MODAL = '[data-testid="lab-settings-modal"]';
const SEL_SECTION_DIALOG = '[data-testid="inheritance-section-dialog"]';

interface ParsedTopology {
  topology: {
    defaults?: Record<string, unknown>;
    kinds?: Record<string, Record<string, unknown>>;
    groups?: Record<string, Record<string, unknown>>;
    nodes: Record<string, Record<string, unknown>>;
  };
}

async function readTopology(topoViewerPage: {
  getYamlFromFile: (file: string) => Promise<string>;
}): Promise<ParsedTopology> {
  return YAML.parse(await topoViewerPage.getYamlFromFile(FILE)) as ParsedTopology;
}

async function openSectionsTab(page: Page): Promise<Locator> {
  await page.locator(SEL_LAB_SETTINGS_BTN).click();
  const modal = page.locator(SEL_LAB_SETTINGS_MODAL);
  await expect(modal).toBeVisible();
  await modal.getByTestId("lab-settings-tab-inheritance").click();
  await expect(modal.getByTestId("lab-inheritance-defaults")).toBeVisible();
  return modal;
}

async function openNodeEditor(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-id="${nodeId}"]`);
  await expect(node).toBeVisible({ timeout: 3000 });
  const box = await node.boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-testid="panel-tab-basic"]')).toBeVisible({ timeout: 3000 });
}

test.describe("Defaults, kinds and groups", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
  });

  test("lab settings list the sections with the nodes that use them", async ({ page }) => {
    const modal = await openSectionsTab(page);
    await expect(modal.getByTestId("lab-inheritance-row-defaults")).toContainText("3 nodes");
    await expect(modal.getByTestId("lab-inheritance-row-kind-nokia_srlinux")).toContainText(
      "2 nodes"
    );
    await expect(modal.getByTestId("lab-inheritance-row-group-fabric")).toContainText("2 nodes");
    await expect(modal.getByTestId("lab-inheritance-row-group-clients")).toContainText("1 node");
  });

  test("editing a group writes its section and a rename follows to its users", async ({
    page,
    topoViewerPage
  }) => {
    const modal = await openSectionsTab(page);
    await modal.getByRole("button", { name: "Edit fabric" }).click();
    const dialog = page.locator(SEL_SECTION_DIALOG);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#node-mgmt-ipv4")).toHaveCount(0);

    await dialog.locator("#node-name").fill("datacenter");
    await dialog.getByTestId("panel-tab-advanced").click();
    await dialog.locator("#node-memory").fill("4G");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => (await readTopology(topoViewerPage)).topology.groups?.datacenter)
      .toEqual({ memory: "4G", env: { ROLE: "fabric" } });
    const topology = (await readTopology(topoViewerPage)).topology;
    expect(topology.groups?.fabric).toBeUndefined();
    expect(topology.kinds?.nokia_srlinux.group).toBe("datacenter");
  });

  test("kinds and groups can be added and removed", async ({ page, topoViewerPage }) => {
    const modal = await openSectionsTab(page);
    await modal.locator("#lab-inheritance-add-group").fill("edge");
    await modal.getByTestId("lab-inheritance-add-group").click();
    const dialog = page.locator(SEL_SECTION_DIALOG);
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("panel-tab-runtime").click();
    await dialog.locator("#node-user").fill("admin");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => (await readTopology(topoViewerPage)).topology.groups?.edge)
      .toEqual({ user: "admin" });

    await modal.getByRole("button", { name: "Remove clients" }).click();
    await expect
      .poll(async () => Object.keys((await readTopology(topoViewerPage)).topology.groups ?? {}))
      .toEqual(["fabric", "edge"]);
    // The node keeps its group key; containerlab also uses it for inventory groups.
    expect((await readTopology(topoViewerPage)).topology.nodes.client1.group).toBe("clients");
  });

  test("the node editor marks inherited values and saves only the node's own", async ({
    page,
    topoViewerPage
  }) => {
    await openNodeEditor(page, "leaf1");
    await expect(page.locator("#node-image-helper-text")).toHaveText("From kind nokia_srlinux");
    await expect(page.locator("#node-group-helper-text")).toHaveText("From kind nokia_srlinux");

    await page.getByTestId("panel-tab-config").click();
    await expect(page.getByTestId("inherited-item-marker")).toHaveCount(3);
    await page.getByText("Overrides group fabric").waitFor();

    await page.getByTestId("panel-tab-runtime").click();
    await page.locator("#node-cmd").fill("bash");
    await page.locator('[data-testid="panel-apply-btn"]').click();

    await expect
      .poll(async () => (await readTopology(topoViewerPage)).topology.nodes.leaf1)
      .toEqual({ kind: "nokia_srlinux", env: { ROLE: "leaf" }, cmd: "bash" });
  });

  test("changing the settings group swaps the inherited values in the form", async ({ page }) => {
    await openNodeEditor(page, "client1");
    await page.getByTestId("panel-tab-advanced").click();
    await expect(page.locator("#node-cpu")).toHaveValue("1");
    await page.getByTestId("panel-tab-basic").click();
    const group = page.locator("#node-group");
    await group.fill("fabric");
    await group.press("Enter");
    await page.getByTestId("panel-tab-advanced").click();
    await expect(page.locator("#node-cpu")).toHaveValue("");
    await expect(page.locator("#node-memory")).toHaveValue("2G");
  });
});
