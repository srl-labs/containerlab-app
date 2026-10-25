import type { Locator, Page } from "@playwright/test";
import * as YAML from "yaml";

import { test, expect } from "../fixtures/topoviewer";

const MULTI_FILE = "multi-mgmt.clab.yml";
const SIMPLE_FILE = "simple.clab.yml";

const SEL_LAB_SETTINGS_BTN = '[data-testid="navbar-lab-settings"]';
const SEL_LAB_SETTINGS_MODAL = '[data-testid="lab-settings-modal"]';
const SEL_LAB_SETTINGS_TAB_MGMT = '[data-testid="lab-settings-tab-mgmt"]';
const SEL_LAB_SETTINGS_SAVE_BTN = '[data-testid="lab-settings-save-btn"]';
const SEL_ADD_NETWORK = '[data-testid="lab-settings-mgmt-add-network"]';
const SEL_APPEARANCE_TAB = '[data-testid="lab-settings-tab-appearance"]';

interface ParsedTopology {
  mgmt?: unknown;
  topology: {
    defaults?: Record<string, unknown>;
    kinds?: Record<string, Record<string, unknown>>;
    nodes: Record<string, Record<string, unknown>>;
  };
}

async function openMgmtTab(page: Page): Promise<Locator> {
  await page.locator(SEL_LAB_SETTINGS_BTN).click();
  const modal = page.locator(SEL_LAB_SETTINGS_MODAL);
  await expect(modal).toBeVisible();
  await modal.locator(SEL_LAB_SETTINGS_TAB_MGMT).click();
  await expect(modal.getByTestId("lab-settings-mgmt-networks")).toBeVisible();
  return modal;
}

async function readTopology(
  topoViewerPage: { getYamlFromFile: (file: string) => Promise<string> },
  file: string
): Promise<ParsedTopology> {
  return YAML.parse(await topoViewerPage.getYamlFromFile(file)) as ParsedTopology;
}

async function clickNode(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-id="${nodeId}"]`);
  await expect(node).toBeVisible({ timeout: 3000 });
  const box = await node.boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-testid="panel-tab-basic"]')).toBeVisible({ timeout: 3000 });
}

test.describe("Multiple management networks", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(MULTI_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
  });

  test("nodes carry a dot for their network and a marker when it is invalid", async ({ page }) => {
    await expect(page.locator('[data-id="spine1"] [data-mgmt-net="oob"]')).toHaveCount(1);
    await expect(page.locator('[data-id="leaf2"] [data-mgmt-net="lab"]')).toHaveCount(1);
    await expect(page.locator('[data-id="client1"] [data-mgmt-net="lab"]')).toHaveCount(1);
    await expect(page.locator('[data-id="client2"] .topology-node-mgmt-badge.problem')).toHaveCount(
      1
    );
  });

  test("the dot shows on hover by default, or always when set in Appearance", async ({
    page,
    topoViewerPage
  }) => {
    const dot = page.locator('[data-id="leaf1"] .topology-node-mgmt-badge');
    await expect(dot).toHaveCSS("opacity", "0");
    await page.locator('[data-id="leaf1"]').hover();
    await expect(dot).toHaveCSS("opacity", "1");
    // Problems stay visible without hovering.
    await expect(page.locator('[data-id="client2"] .topology-node-mgmt-badge.problem')).toHaveCSS(
      "opacity",
      "1"
    );

    await page.locator(SEL_LAB_SETTINGS_BTN).click();
    const modal = page.locator(SEL_LAB_SETTINGS_MODAL);
    await modal.locator(SEL_APPEARANCE_TAB).click();
    await modal.getByRole("combobox", { name: "Management network badge" }).click();
    await page.getByRole("option", { name: "Always" }).click();
    await modal.locator(SEL_LAB_SETTINGS_SAVE_BTN).click();
    await expect(modal).toBeVisible();

    await page.mouse.move(5, 5);
    await expect(dot).toHaveCSS("opacity", "1");
    await expect
      .poll(async () => (await topoViewerPage.getAnnotationsFromFile(MULTI_FILE)).viewerSettings)
      .toMatchObject({ mgmtNetworkBadge: "always" });
  });

  test("the Management tab lists the networks and the nodes on unknown ones", async ({ page }) => {
    const modal = await openMgmtTab(page);
    await expect(modal.getByTestId("lab-settings-mgmt-network-0")).toContainText("oob");
    await expect(modal.getByTestId("lab-settings-mgmt-network-0")).toContainText("default");
    await expect(modal.getByTestId("lab-settings-mgmt-network-0")).toContainText("2 nodes");
    await expect(modal.getByTestId("lab-settings-mgmt-network-1")).toContainText("lab");
    await expect(modal.getByTestId("lab-settings-mgmt-unknown")).toContainText("client2 (storage)");
    await expect(modal.getByRole("combobox", { name: "Default management network" })).toContainText("oob");
  });

  test("adding a network appends it to the mgmt list", async ({ page, topoViewerPage }) => {
    const modal = await openMgmtTab(page);
    await modal.locator(SEL_ADD_NETWORK).click();
    await expect(modal.getByTestId("lab-settings-mgmt-network-2")).toBeVisible();
    await modal.getByRole("textbox", { name: "Network Name" }).fill("storage");
    await modal.locator(SEL_LAB_SETTINGS_SAVE_BTN).click();
    await expect(modal).toBeVisible();

    await expect
      .poll(async () => (await readTopology(topoViewerPage, MULTI_FILE)).mgmt)
      .toEqual([
        { network: "oob", "ipv4-subnet": "172.31.10.0/24" },
        { network: "lab", "ipv4-subnet": "172.31.20.0/24", bridge: "br-lab" },
        { network: "storage" }
      ]);
    // client2 now points at a defined network.
    await expect(page.locator('[data-id="client2"] .topology-node-mgmt-badge.problem')).toHaveCount(
      0
    );
  });

  test("renaming a network renames the nodes and kinds that use it", async ({
    page,
    topoViewerPage
  }) => {
    const modal = await openMgmtTab(page);
    await modal.getByRole("button", { name: "Edit management network lab" }).click();
    await modal.getByRole("textbox", { name: "Network Name" }).fill("data");
    await modal.locator(SEL_LAB_SETTINGS_SAVE_BTN).click();
    await expect(modal).toBeVisible();

    await expect
      .poll(async () => {
        const topo = await readTopology(topoViewerPage, MULTI_FILE);
        return [topo.topology.kinds?.linux["mgmt-net"], topo.topology.nodes.leaf2["mgmt-net"]];
      })
      .toEqual(["data", "data"]);
  });

  test("duplicate names block Apply and stay on the Management tab", async ({
    page,
    topoViewerPage
  }) => {
    const before = await topoViewerPage.getYamlFromFile(MULTI_FILE);
    const modal = await openMgmtTab(page);
    await modal.getByRole("button", { name: "Edit management network lab" }).click();
    await modal.getByRole("textbox", { name: "Network Name" }).fill("oob");
    await expect(modal.getByText("Another management network uses this name")).toBeVisible();

    await modal.getByTestId("lab-settings-tab-basic").click();
    await modal.locator(SEL_LAB_SETTINGS_SAVE_BTN).click();
    await expect(modal.locator(SEL_LAB_SETTINGS_TAB_MGMT)).toHaveAttribute("aria-current", "page");
    await expect(modal).toBeVisible();
    expect(await topoViewerPage.getYamlFromFile(MULTI_FILE)).toBe(before);
  });

  test("the node editor picks the network and shows where an inherited one comes from", async ({
    page,
    topoViewerPage
  }) => {
    await clickNode(page, "client1");
    await page.locator('[data-testid="panel-tab-network"]').click();
    const select = page.locator("#node-mgmt-net");
    await expect(select).toContainText("lab");
    await expect(page.getByText("From kind linux")).toBeVisible();

    await select.click();
    await page.getByRole("option", { name: "oob (default)" }).click();
    await page.locator('[data-testid="panel-apply-btn"]').click();
    await expect
      .poll(async () => (await readTopology(topoViewerPage, MULTI_FILE)).topology.nodes.client1)
      .toMatchObject({ "mgmt-net": "oob" });
  });

  test("a static address outside the network subnet is flagged", async ({ page }) => {
    await clickNode(page, "spine1");
    await page.locator('[data-testid="panel-tab-network"]').click();
    const ipv4 = page.locator("#node-mgmt-ipv4");
    await expect(ipv4).toHaveValue("172.31.10.11");
    await expect(page.getByText("Outside oob")).toHaveCount(0);
    await ipv4.fill("172.31.20.11");
    await expect(page.getByText("Outside oob (172.31.10.0/24)")).toBeVisible();
  });
});

test.describe("Single management network", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
  });

  test("no network dots until a second network is added", async ({ page, topoViewerPage }) => {
    await expect(page.locator(".topology-node-mgmt-badge")).toHaveCount(0);

    const modal = await openMgmtTab(page);
    await expect(modal.getByTestId("lab-settings-mgmt-network-0")).toContainText("clab");
    await modal.locator(SEL_ADD_NETWORK).click();
    await expect(modal.getByTestId("lab-settings-mgmt-unassigned")).toContainText("srl1, srl2");

    await modal.getByRole("combobox", { name: "Default management network" }).click();
    await page.getByRole("option", { name: "clab" }).click();
    await expect(modal.getByTestId("lab-settings-mgmt-unassigned")).toHaveCount(0);
    await modal.locator(SEL_LAB_SETTINGS_SAVE_BTN).click();
    await expect(modal).toBeVisible();

    await expect
      .poll(async () => {
        const topo = await readTopology(topoViewerPage, SIMPLE_FILE);
        return { mgmt: topo.mgmt, defaults: topo.topology.defaults };
      })
      .toEqual({
        mgmt: [{ network: "clab" }, { network: "mgmt2" }],
        defaults: { "mgmt-net": "clab" }
      });
    await expect(page.locator('[data-id="srl1"] [data-mgmt-net="clab"]')).toHaveCount(1);
  });
});

test.describe("Macvlan management network", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(MULTI_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
  });

  test("switching a network to macvlan swaps the bridge fields for macvlan ones", async ({
    page,
    topoViewerPage
  }) => {
    const modal = await openMgmtTab(page);
    await modal.getByRole("button", { name: "Edit management network lab" }).click();
    await expect(modal.getByRole("textbox", { name: "Bridge Name" })).toHaveValue("br-lab");

    await modal.getByRole("combobox", { name: "Driver" }).click();
    await page.getByRole("option", { name: "Macvlan" }).click();
    await expect(modal.getByRole("textbox", { name: "Bridge Name" })).toHaveCount(0);
    await expect(modal.getByRole("textbox", { name: "MTU" })).toHaveCount(0);
    await expect(modal.getByText("Required for macvlan networks")).toBeVisible();
    await expect(modal.getByTestId("lab-settings-mgmt-network-1")).toContainText(
      "Needs attention"
    );

    await modal.getByRole("textbox", { name: "Parent Interface" }).fill("eth1");
    await expect(modal.getByTestId("lab-settings-mgmt-network-1")).toContainText(
      "macvlan on eth1"
    );
    await modal.getByRole("combobox", { name: "Macvlan Mode" }).click();
    await page.getByRole("option", { name: "Private" }).click();
    // Host access only exists in bridge mode.
    await expect(modal.getByRole("switch", { name: "Host Access" })).toHaveCount(0);
    await modal.getByRole("combobox", { name: "Address Allocation" }).click();
    await page.getByRole("option", { name: "Container runtime" }).click();
    await expect(modal.getByRole("switch", { name: "Duplicate Address Detection" })).toHaveCount(
      0
    );
    await modal.locator(SEL_LAB_SETTINGS_SAVE_BTN).click();
    await expect(modal).toBeVisible();

    await expect
      .poll(async () => (await readTopology(topoViewerPage, MULTI_FILE)).mgmt)
      .toEqual([
        { network: "oob", "ipv4-subnet": "172.31.10.0/24" },
        {
          network: "lab",
          "ipv4-subnet": "172.31.20.0/24",
          driver: "macvlan",
          "macvlan-parent": "eth1",
          "macvlan-mode": "private",
          ipam: { provider: "runtime" }
        }
      ]);
  });

  test("a macvlan network offers no auto subnet", async ({ page }) => {
    const modal = await openMgmtTab(page);
    await modal.getByRole("combobox", { name: "Driver" }).click();
    await page.getByRole("option", { name: "Macvlan" }).click();
    await modal.getByRole("combobox", { name: "IPv4 Subnet" }).click();
    await expect(page.getByRole("option", { name: "Custom" })).toBeVisible();
    await expect(page.getByRole("option", { name: "From parent interface" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Auto-assign" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});
