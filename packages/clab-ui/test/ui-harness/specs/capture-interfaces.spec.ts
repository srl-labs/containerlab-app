import type { Page } from "@playwright/test";

import type { BrowserDevApi } from "../devApi";
import { test, expect } from "../fixtures/topoviewer";

const SPINE_LEAF_FILE = "spine-leaf.clab.yml";
const SEL_DIALOG = '[data-testid="capture-interfaces-dialog"]';
const SEL_SUBMIT = '[data-testid="capture-interfaces-submit"]';

interface CaptureMessage {
  command: string;
  nodeName?: string;
  interfaceName?: string;
  interfaceNames?: string[];
  nodeNamespace?: boolean;
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

async function openCaptureDialog(page: Page, nodeId: string): Promise<void> {
  const box = await page.locator(`[data-id="${nodeId}"]`).boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await page.locator('[data-testid="context-menu-item-capture-node"]').click();
  await expect(page.locator(SEL_DIALOG)).toBeVisible();
}

function row(page: Page, interfaceName: string) {
  return page.locator(`[data-testid="capture-interface-row"][data-interface="${interfaceName}"]`);
}

async function captureMessages(page: Page): Promise<CaptureMessage[]> {
  return page.evaluate(() => {
    const messages = (window as { __CLAB_UI_HARNESS_MESSAGES__?: CaptureMessage[] })
      .__CLAB_UI_HARNESS_MESSAGES__;
    return (messages ?? []).filter((message) => message.command === "clab-interface-capture");
  });
}

test.describe("Capture interfaces dialog", () => {
  test.beforeEach(async ({ page, topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SPINE_LEAF_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.fit();
    await deployLab(page);
  });

  test("lists every interface and preselects the linked ones", async ({ page }) => {
    await openCaptureDialog(page, "leaf1");

    await expect(page.locator('[data-testid="capture-interface-row"]')).toHaveCount(5);
    await expect(row(page, "e1-49")).toContainText("spine1");
    await expect(row(page, "eth0")).toContainText("management");
    await expect(row(page, "e1-51")).toContainText("not linked");
    for (const name of ["e1-1", "e1-49", "e1-50"]) {
      await expect(row(page, name).locator("input")).toBeChecked();
    }
    await expect(row(page, "eth0").locator("input")).not.toBeChecked();
    await expect(page.locator(SEL_SUBMIT)).toHaveText("Open Wireshark");
    await expect(page.locator('[data-testid="capture-interfaces-hint"]')).toHaveText(
      "All 3 interfaces in one Wireshark."
    );
  });

  test("captures all interfaces of the node in one request", async ({ page }) => {
    await openCaptureDialog(page, "leaf1");

    await page.locator('[data-testid="capture-interfaces-select-all"] input').check();
    await page.locator(SEL_SUBMIT).click();

    await expect(page.locator(SEL_DIALOG)).toBeHidden();
    expect(await captureMessages(page)).toEqual([
      {
        command: "clab-interface-capture",
        nodeName: "clab-spine-leaf-leaf1",
        interfaceName: "eth0",
        interfaceNames: ["eth0", "e1-1", "e1-49", "e1-50", "e1-51"],
        nodeNamespace: true
      }
    ]);
  });

  test("filters by peer and remembers the last selection", async ({ page }) => {
    await openCaptureDialog(page, "leaf1");

    await page.locator('[data-testid="capture-interfaces-filter"]').fill("spine2");
    await expect(page.locator('[data-testid="capture-interface-row"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="capture-interfaces-hidden-selected"]')).toHaveText(
      "· 2 more selected"
    );

    await page.locator('[data-testid="capture-interfaces-filter"]').fill("");
    await row(page, "e1-1").click();
    await row(page, "e1-50").click();
    await expect(page.locator(SEL_SUBMIT)).toHaveText("Open Wireshark");
    await expect(page.locator('[data-testid="capture-interfaces-mode-separate"]')).toBeDisabled();
    await page.keyboard.press("Enter");

    await expect(page.locator(SEL_DIALOG)).toBeHidden();
    const [message] = await captureMessages(page);
    expect(message.interfaceNames).toEqual(["e1-49"]);

    await openCaptureDialog(page, "leaf1");
    await expect(row(page, "e1-49").locator("input")).toBeChecked();
    await expect(row(page, "e1-1").locator("input")).not.toBeChecked();
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
    const box = await page.locator('[data-id="leaf2"]').boundingBox();
    if (!box) throw new Error("Node leaf2 has no bounding box");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });

    await expect(page.locator('[data-testid="context-menu-item-capture-node"]')).toHaveAttribute(
      "aria-disabled",
      "true"
    );
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

test.describe("Capture interfaces dialog on a distributed SR-SIM node", () => {
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
    await openCaptureDialog(page, "sr1");

    const rows = page.locator('[data-testid="capture-interface-row"]');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText("eth0");
    await expect(row(page, "e1-1-c1-1")).toContainText("1/1/c1/1");
    await expect(row(page, "e1-1-c1-1")).toContainText("client1");
    await expect(row(page, "e2-1-c1-1")).toContainText("2/1/c1/1");
    await expect(page.locator(SEL_DIALOG)).not.toContainText("_nokia_");
    await expect(page.locator(SEL_DIALOG)).not.toContainText("clab-s-");
  });

  test("captures eth0 and every port in one capture inside the node", async ({ page }) => {
    await openCaptureDialog(page, "sr1");

    await page.locator('[data-testid="capture-interfaces-select-all"] input').check();
    await expect(page.locator('[data-testid="capture-interfaces-hint"]')).toHaveText(
      "All 4 interfaces in one Wireshark."
    );
    await page.locator(SEL_SUBMIT).click();

    await expect(page.locator(SEL_DIALOG)).toBeHidden();
    expect(await captureMessages(page)).toEqual([
      {
        command: "clab-interface-capture",
        nodeName: "clab-capdist-sr1-a",
        interfaceName: "eth0",
        interfaceNames: ["eth0", "e1-1-c1-1", "e1-1-c2-1", "e2-1-c1-1"],
        nodeNamespace: true
      }
    ]);
  });

  test("can open one Wireshark per interface, and remembers that choice", async ({ page }) => {
    await openCaptureDialog(page, "sr1");

    await page.locator('[data-testid="capture-interfaces-mode-separate"]').click();
    await expect(page.locator('[data-testid="capture-interfaces-hint"]')).toHaveText(
      "Each interface in its own Wireshark."
    );
    await expect(page.locator(SEL_SUBMIT)).toHaveText("Open 3 Wiresharks");
    await page.locator(SEL_SUBMIT).click();

    await expect(page.locator(SEL_DIALOG)).toBeHidden();
    expect((await captureMessages(page)).map((message) => message.interfaceNames)).toEqual([
      ["e1-1-c1-1"],
      ["e1-1-c2-1"],
      ["e2-1-c1-1"]
    ]);

    await openCaptureDialog(page, "sr1");
    await expect(page.locator('[data-testid="capture-interfaces-mode-separate"]')).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
