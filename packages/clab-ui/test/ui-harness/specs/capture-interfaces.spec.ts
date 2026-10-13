import type { Page } from "@playwright/test";

import type { BrowserDevApi } from "../devApi";
import { test, expect } from "../fixtures/topoviewer";

const SPINE_LEAF_FILE = "spine-leaf.clab.yml";
const SEL_PANEL = '[data-testid="capture-interfaces-panel"]';
const SEL_SUBMIT = '[data-testid="capture-interfaces-submit"]';
const SEL_MODE = '[data-testid="capture-interfaces-mode"]';

interface CaptureMessage {
  command: string;
  nodeName?: string;
  interfaceName?: string;
  interfaceNames?: string[];
  nodeNamespace?: boolean;
  targets?: Array<{ nodeName: string; interfaceName: string }>;
  captureLabel?: string;
}

const LEAF1_INTERFACES = [
  { name: "eth0", state: "up" },
  { name: "e1-1", alias: "ethernet-1/1", state: "up" },
  { name: "e1-49", alias: "ethernet-1/49", state: "up" },
  { name: "e1-50", alias: "ethernet-1/50", state: "down" },
  { name: "e1-51", alias: "ethernet-1/51", state: "down" }
];

/** Mark the lab deployed and running, as a host refresh would. */
async function deployLab(page: Page): Promise<void> {
  await page.evaluate((interfaces) => {
    const dev = (window as { __DEV__?: BrowserDevApi }).__DEV__;
    if (!dev) throw new Error("__DEV__ API not available");
    dev.setDeploymentState?.("deployed");
    const nodeUpdates = ["spine1", "spine2", "leaf1", "leaf2", "client1", "client2"].map((node) => ({
      containerLongName: `clab-spine-leaf-${node}`,
      containerShortName: node,
      state: "running",
      ...(node === "leaf1" ? { interfaces } : {})
    }));
    dev.emitHostMessage({ type: "node-data-updated", data: { nodeUpdates } });
  }, LEAF1_INTERFACES);
}

async function openNodeMenu(page: Page, nodeId: string): Promise<void> {
  const box = await page.locator(`[data-id="${nodeId}"]`).boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
}

/** Right-click the node and rest on Capture: the checklist opens beside the menu. */
async function openCapturePanel(page: Page, nodeId: string): Promise<void> {
  await openNodeMenu(page, nodeId);
  await page.locator('[data-testid="context-menu-item-capture-node"]').hover();
  await expect(page.locator(SEL_PANEL)).toBeVisible();
}

/** Right-click the middle of the link between two nodes. */
async function openLinkMenu(page: Page, source: string, target: string): Promise<void> {
  const point = await page.evaluate(
    ([a, b]) => {
      const rf = (window as { __DEV__?: BrowserDevApi }).__DEV__?.rfInstance;
      if (!rf) throw new Error("React Flow instance not available");
      const center = (id: string) => {
        const node = rf.getInternalNode(id);
        if (!node) throw new Error(`Node ${id} not found`);
        const { x, y } = node.internals.positionAbsolute;
        return { x: x + (node.measured.width ?? 0) / 2, y: y + (node.measured.height ?? 0) / 2 };
      };
      const from = center(a);
      const to = center(b);
      return rf.flowToScreenPosition({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    },
    [source, target]
  );
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(page.locator('[data-testid="context-menu-item-capture-link"]')).toBeVisible();
}

function row(page: Page, interfaceName: string) {
  return page.locator(`[data-testid="capture-interface-row"][data-interface="${interfaceName}"]`);
}

function checkbox(page: Page, interfaceName: string) {
  return row(page, interfaceName).locator('input[type="checkbox"]');
}

async function captureMessages(page: Page): Promise<CaptureMessage[]> {
  return page.evaluate(() => {
    const messages = (window as { __CLAB_UI_HARNESS_MESSAGES__?: CaptureMessage[] })
      .__CLAB_UI_HARNESS_MESSAGES__;
    return (messages ?? []).filter((message) => message.command === "clab-interface-capture");
  });
}

test.describe("Capture submenu of a node", () => {
  test.beforeEach(async ({ page, topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SPINE_LEAF_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.fit();
    await deployLab(page);
  });

  test("lists every interface and preselects the linked ones", async ({ page }) => {
    await openCapturePanel(page, "leaf1");

    await expect(page.locator('[data-testid="capture-interface-row"]')).toHaveCount(5);
    await expect(row(page, "e1-49")).toContainText("spine1");
    await expect(row(page, "eth0")).toContainText("mgmt");
    await expect(row(page, "e1-50")).toContainText("down");
    for (const name of ["e1-1", "e1-49", "e1-50"]) {
      await expect(checkbox(page, name)).toBeChecked();
    }
    await expect(checkbox(page, "eth0")).not.toBeChecked();
    await expect(page.locator('[data-testid="capture-interfaces-select-linked"]')).toBeDisabled();
    await expect(page.locator(SEL_MODE)).toBeVisible();
    await expect(page.locator(SEL_SUBMIT)).toHaveText("Capture 3 interfaces");
  });

  test("captures all interfaces of the node in one Wireshark", async ({ page }) => {
    await openCapturePanel(page, "leaf1");

    await page.locator('[data-testid="capture-interfaces-select-all"]').click();
    await page.locator(SEL_SUBMIT).click();

    await expect(page.locator(SEL_PANEL)).toBeHidden();
    await expect(page.locator('[data-testid="context-menu"]')).toBeHidden();
    expect(await captureMessages(page)).toEqual([
      {
        command: "clab-interface-capture",
        nodeName: "clab-spine-leaf-leaf1",
        interfaceName: "eth0",
        interfaceNames: ["eth0", "e1-1", "e1-49", "e1-50", "e1-51"],
        nodeNamespace: true,
        captureLabel: "eth0, e1-1, e1-49, e1-50, e1-51"
      }
    ]);
  });

  test("one interface: no Open as choice, the button names it, and the pick is remembered", async ({
    page
  }) => {
    await openCapturePanel(page, "leaf1");

    await page.locator('[data-testid="capture-interfaces-select-none"]').click();
    await expect(page.locator(SEL_SUBMIT)).toBeDisabled();
    await row(page, "e1-49").click();
    await expect(page.locator(SEL_SUBMIT)).toHaveText("Capture e1-49");
    await expect(page.locator(SEL_MODE)).toBeHidden();
    await page.keyboard.press("Enter");

    await expect(page.locator(SEL_PANEL)).toBeHidden();
    const [message] = await captureMessages(page);
    expect(message.interfaceNames).toEqual(["e1-49"]);

    await openCapturePanel(page, "leaf1");
    await expect(checkbox(page, "e1-49")).toBeChecked();
    await expect(checkbox(page, "e1-1")).not.toBeChecked();
  });

  test("the row button captures just that interface", async ({ page }) => {
    await openCapturePanel(page, "leaf1");

    await row(page, "e1-51").hover();
    await row(page, "e1-51").locator('[data-testid="capture-interface-only"]').click();

    await expect(page.locator(SEL_PANEL)).toBeHidden();
    expect((await captureMessages(page)).map((message) => message.interfaceNames)).toEqual([["e1-51"]]);
  });

  test("stays open off the menu and closes on another row", async ({ page }) => {
    await openCapturePanel(page, "leaf1");
    const panel = await page.locator(SEL_PANEL).boundingBox();
    if (!panel) throw new Error("Capture panel has no bounding box");

    await page.mouse.move(panel.x + panel.width + 60, panel.y + panel.height + 60);
    await page.waitForTimeout(400);
    await expect(page.locator(SEL_PANEL)).toBeVisible();

    await page.locator('[data-testid="context-menu-item-logs-node"]').hover();
    await expect(page.locator(SEL_PANEL)).toBeHidden();
    await expect(page.locator('[data-testid="context-menu"]')).toBeVisible();
  });

  test("works from the keyboard", async ({ page }) => {
    await openNodeMenu(page, "leaf1");
    await page.locator('[data-testid="context-menu-item-capture-node"]').focus();
    await page.keyboard.press("ArrowRight");

    await expect(page.locator(SEL_PANEL)).toBeVisible();
    await expect(checkbox(page, "eth0")).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await expect(checkbox(page, "e1-1")).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("Enter");

    expect((await captureMessages(page)).map((message) => message.interfaceNames)).toEqual([
      ["eth0", "e1-49", "e1-50"]
    ]);
  });

  test("is unavailable while the node is stopped", async ({ page }) => {
    await page.evaluate(() => {
      (window as { __DEV__?: BrowserDevApi }).__DEV__?.emitHostMessage({
        type: "node-data-updated",
        data: {
          nodeUpdates: [
            { containerLongName: "clab-spine-leaf-leaf2", containerShortName: "leaf2", state: "exited" }
          ]
        }
      });
    });
    await openNodeMenu(page, "leaf2");

    await expect(page.locator('[data-testid="context-menu-item-capture-node"]')).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });
});

test.describe("Capture submenu of a link", () => {
  test.beforeEach(async ({ page, topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SPINE_LEAF_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.fit();
    await deployLab(page);
  });

  test("ends inside two nodes: no One Wireshark choice, one Wireshark each", async ({ page }) => {
    await openLinkMenu(page, "leaf1", "spine1");
    await page.locator('[data-testid="context-menu-item-capture-link"]').hover();

    await expect(page.locator(SEL_PANEL)).toContainText("spine1 ↔ leaf1");
    await expect(checkbox(page, "source")).toBeChecked();
    await expect(checkbox(page, "target")).toBeChecked();
    await expect(page.locator(SEL_MODE)).toBeHidden();
    await expect(page.locator('[data-testid="capture-interfaces-hint"]')).toHaveText(
      "The ends are in different network namespaces, so each opens in its own Wireshark."
    );
    await expect(page.locator(SEL_SUBMIT)).toHaveText("Open 2 Wiresharks");
    await page.locator(SEL_SUBMIT).click();

    expect(await captureMessages(page)).toEqual([
      {
        command: "clab-interface-capture",
        nodeName: "clab-spine-leaf-spine1",
        interfaceName: "e1-1",
        captureLabel: "spine1 · e1-1"
      },
      {
        command: "clab-interface-capture",
        nodeName: "clab-spine-leaf-leaf1",
        interfaceName: "e1-49",
        captureLabel: "leaf1 · e1-49"
      }
    ]);
  });

  test("captures one end", async ({ page }) => {
    await openLinkMenu(page, "leaf1", "spine1");
    await page.locator('[data-testid="context-menu-item-capture-link"]').hover();

    await row(page, "source").click();
    await expect(page.locator(SEL_SUBMIT)).toHaveText("Capture leaf1 · e1-49");
    await page.locator(SEL_SUBMIT).click();

    expect((await captureMessages(page)).map((message) => message.nodeName)).toEqual([
      "clab-spine-leaf-leaf1"
    ]);
  });
});

// Recorded from a deployed distributed SR-SIM lab (containerlab 0.81, nokia_srsim 26.3.R1):
// sr1-a reports every port of the chassis, links show up as host-side clab-s-* interfaces.
const SRSIM_FILE = "capture-srsim.clab.yml";
const SRSIM_YAML = `name: capdist
topology:
  nodes:
    sr1:
      kind: nokia_srsim
      type: sr-7
      components:
        - slot: A
        - slot: 1
        - slot: 2
    client1:
      kind: linux
    client2:
      kind: linux
  links:
    - endpoints: ["sr1:1/1/c1/1", "client1:eth1"]
    - endpoints: ["sr1:1/1/c2/1", "client1:eth2"]
    - endpoints: ["sr1:2/1/c1/1", "client2:eth1"]
`;

function runtimeContainer(nodeName: string, kind: string, ports: Array<[string, string, string?]>) {
  return {
    name: `clab-capdist-${nodeName}`,
    nodeName,
    labName: "capdist",
    state: "running",
    kind,
    image: "",
    ipv4Address: "",
    ipv6Address: "",
    interfaces: ports.map(([name, alias, state]) => ({
      name,
      alias,
      mac: "",
      mtu: 9500,
      state: state ?? "up",
      type: "veth"
    }))
  };
}

const SRSIM_RUNTIME = [
  runtimeContainer("client1", "linux", [
    ["clab-s-82b47fe6", "eth2"],
    ["clab-s-d2115f7f", "eth1"],
    ["eth0", ""],
    ["lo", "", "unknown"]
  ]),
  runtimeContainer("client2", "linux", [
    ["clab-s-9d01a3df", "eth1"],
    ["eth0", ""]
  ]),
  runtimeContainer("sr1-a", "nokia_srsim", [
    ["_nokia_fab1_br", ""],
    ["_nokia_fabric", ""],
    ["_nokia_mgmt1", "", "unknown"],
    ["clab-s-6b26d4e7", "1/1/c1/1"],
    ["clab-s-8b54dd8d", "2/1/c1/1"],
    ["clab-s-9ded930f", "1/1/c2/1"],
    ["eth0", ""],
    ["lo", "", "unknown"]
  ])
];

test.describe("Capture submenu of a distributed SR-SIM node", () => {
  test.beforeEach(async ({ page, topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile("simple.clab.yml");
    await page.evaluate(
      ([file, yaml]) => (window as { __DEV__?: BrowserDevApi }).__DEV__?.writeYamlFile(file, yaml),
      [SRSIM_FILE, SRSIM_YAML]
    );
    await topoViewerPage.gotoFile(SRSIM_FILE);
    await topoViewerPage.waitForCanvasReady();
    await page.evaluate(async (containers) => {
      const dev = (window as { __DEV__?: BrowserDevApi }).__DEV__;
      if (!dev) throw new Error("__DEV__ API not available");
      dev.setDeploymentState?.("deployed");
      await dev.applyRuntimeContainers(containers);
    }, SRSIM_RUNTIME);
    await topoViewerPage.fit();
  });

  test("lists the SR OS ports by name and hides simulator internals", async ({ page }) => {
    await openCapturePanel(page, "sr1");

    const rows = page.locator('[data-testid="capture-interface-row"]');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText("eth0");
    await expect(row(page, "e1-1-c1-1")).toContainText("1/1/c1/1");
    await expect(row(page, "e1-1-c1-1")).toContainText("client1");
    await expect(row(page, "e2-1-c1-1")).toContainText("2/1/c1/1");
    await expect(page.locator(SEL_PANEL)).not.toContainText("_nokia_");
    await expect(page.locator(SEL_PANEL)).not.toContainText("clab-s-");
  });

  test("captures eth0 and every port in one capture inside the node", async ({ page }) => {
    await openCapturePanel(page, "sr1");

    await page.locator('[data-testid="capture-interfaces-select-all"]').click();
    await expect(page.locator(SEL_SUBMIT)).toHaveText("Capture 4 interfaces");
    await page.locator(SEL_SUBMIT).click();

    await expect(page.locator(SEL_PANEL)).toBeHidden();
    expect(await captureMessages(page)).toEqual([
      {
        command: "clab-interface-capture",
        nodeName: "clab-capdist-sr1-a",
        interfaceName: "eth0",
        interfaceNames: ["eth0", "e1-1-c1-1", "e1-1-c2-1", "e2-1-c1-1"],
        nodeNamespace: true,
        captureLabel: "eth0, 1/1/c1/1, 1/1/c2/1, 2/1/c1/1"
      }
    ]);
  });

  test("can open one Wireshark per interface, and remembers that choice", async ({ page }) => {
    await openCapturePanel(page, "sr1");

    await page.locator('[data-testid="capture-interfaces-mode-separate"]').click();
    await expect(page.locator(SEL_SUBMIT)).toHaveText("Open 3 Wiresharks");
    await page.locator(SEL_SUBMIT).click();

    await expect(page.locator(SEL_PANEL)).toBeHidden();
    expect((await captureMessages(page)).map((message) => message.captureLabel)).toEqual([
      "1/1/c1/1",
      "1/1/c2/1",
      "2/1/c1/1"
    ]);

    await openCapturePanel(page, "sr1");
    await expect(page.locator('[data-testid="capture-interfaces-mode-separate"]')).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  test("a stitched link opens both ends in one Wireshark, or one per end", async ({ page }) => {
    await openLinkMenu(page, "sr1", "client2");
    await page.locator('[data-testid="context-menu-item-capture-link"]').hover();

    await expect(page.locator(SEL_MODE)).toBeVisible();
    await expect(page.locator('[data-testid="capture-interfaces-mode-separate"]')).toHaveText("One per end");
    await page.locator('[data-testid="capture-interfaces-mode-combined"]').click();
    await expect(page.locator(SEL_SUBMIT)).toHaveText("Capture both ends");
    await page.locator(SEL_SUBMIT).click();

    expect(await captureMessages(page)).toEqual([
      {
        command: "clab-interface-capture",
        nodeName: "clab-capdist-sr1-a",
        interfaceName: "2/1/c1/1",
        targets: [
          { nodeName: "clab-capdist-sr1-a", interfaceName: "2/1/c1/1" },
          { nodeName: "clab-capdist-client2", interfaceName: "eth1" }
        ],
        captureLabel: "sr1 · 2/1/c1/1 ↔ client2 · eth1"
      }
    ]);

    await openLinkMenu(page, "sr1", "client2");
    await page.locator('[data-testid="context-menu-item-capture-link"]').hover();
    await page.locator('[data-testid="capture-interfaces-mode-separate"]').click();
    await expect(page.locator(SEL_SUBMIT)).toHaveText("Open 2 Wiresharks");
  });
});
