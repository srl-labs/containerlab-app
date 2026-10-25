import type { Locator, Page } from "@playwright/test";
import * as YAML from "yaml";

import type { BrowserDevApi } from "../devApi";
import { test, expect } from "../fixtures/topoviewer";

const SIMPLE_FILE = "simple.clab.yml";
const SEL_LAB_SETTINGS_BTN = '[data-testid="navbar-lab-settings"]';
const SEL_LAB_SETTINGS_MODAL = '[data-testid="lab-settings-modal"]';
const SEL_TAB_MGMT = '[data-testid="lab-settings-tab-mgmt"]';
const SEL_SAVE_BTN = '[data-testid="lab-settings-save-btn"]';

const WITH_PROXY = `name: simple

mgmt:
  tailscale:
    auth-mode: sso

topology:
  nodes:
    srl1:
      kind: nokia_srlinux
      ports:
        - 8022:22/ts
        - 50080:80
    srl2:
      kind: nokia_srlinux

  links:
    - endpoints: [ "srl1:e1-1", "srl2:e1-1" ]
`;

const PROXY_STATUS = {
  labName: "simple",
  devices: [
    {
      role: "proxy",
      containerName: "clab-simple-tailscale",
      state: "running",
      backendState: "NeedsLogin",
      authUrl: "https://login.tailscale.com/a/0123",
      hostName: "clab-simple",
      online: false,
      forwards: [{ listenPort: 8022, target: "172.20.20.2:22", nodeName: "srl1" }]
    }
  ]
};

interface ParsedTopology {
  mgmt?: unknown;
  topology: { nodes: Record<string, { ports?: string[] }> };
}

async function readTopology(
  topoViewerPage: { getYamlFromFile: (file: string) => Promise<string> }
): Promise<ParsedTopology> {
  return YAML.parse(await topoViewerPage.getYamlFromFile(SIMPLE_FILE)) as ParsedTopology;
}

async function openMgmtTab(page: Page): Promise<Locator> {
  await page.locator(SEL_LAB_SETTINGS_BTN).click();
  const modal = page.locator(SEL_LAB_SETTINGS_MODAL);
  await expect(modal).toBeVisible();
  await modal.locator(SEL_TAB_MGMT).click();
  await expect(modal.getByTestId("lab-settings-mgmt-networks")).toBeVisible();
  return modal;
}

async function chooseTailscale(page: Page, modal: Locator, option: string): Promise<void> {
  await modal.getByRole("combobox", { name: "Tailscale" }).click();
  await page.getByRole("option", { name: option }).click();
}

async function openNetworkTab(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-id="${nodeId}"]`);
  await expect(node).toBeVisible({ timeout: 3000 });
  const box = await node.boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('[data-testid="panel-tab-network"]').click();
}

async function setDeployed(page: Page, status: unknown): Promise<void> {
  await page.evaluate((stub) => {
    (window as { __CLAB_UI_HARNESS_TAILSCALE__?: unknown }).__CLAB_UI_HARNESS_TAILSCALE__ = stub;
    const dev = (window as { __DEV__?: BrowserDevApi }).__DEV__;
    if (!dev) throw new Error("__DEV__ API not available");
    dev.setDeploymentState?.("deployed");
  }, status);
}

test.describe("Tailscale management network", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
  });

  test("the lab proxy joins the management network to the tailnet", async ({
    page,
    topoViewerPage
  }) => {
    const modal = await openMgmtTab(page);
    await chooseTailscale(page, modal, "Lab proxy (SSO login)");
    await expect(modal.getByTestId("lab-settings-mgmt-network-0")).toContainText("Tailscale");
    await modal.locator(SEL_SAVE_BTN).click();
    await expect(modal).toBeVisible();

    await expect
      .poll(async () => (await readTopology(topoViewerPage)).mgmt)
      .toEqual({ tailscale: { "auth-mode": "sso" } });
  });

  test("sidecar mode needs an auth key and replaces the proxy", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.writeYamlFile(SIMPLE_FILE, WITH_PROXY);
    await topoViewerPage.waitForCanvasReady();
    const modal = await openMgmtTab(page);
    await expect(modal.getByRole("combobox", { name: "Tailscale" })).toContainText("Lab proxy");

    await chooseTailscale(page, modal, "Sidecar per node (auth key)");
    await expect(modal.getByText("Required in sidecar mode")).toBeVisible();
    await modal.getByRole("textbox", { name: "Auth Key" }).fill("${TS_AUTHKEY}");
    await modal.locator(SEL_SAVE_BTN).click();
    await expect(modal).toBeVisible();

    await expect
      .poll(() => topoViewerPage.getYamlFromFile(SIMPLE_FILE))
      .toBe(WITH_PROXY.replace("auth-mode: sso", "auth-key: ${TS_AUTHKEY}"));
  });

  test("node ports pick the Tailscale proxy as their protocol", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.writeYamlFile(SIMPLE_FILE, WITH_PROXY);
    await topoViewerPage.waitForCanvasReady();
    await openNetworkTab(page, "srl1");

    const rows = page.getByTestId("node-port-mapping");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByRole("textbox", { name: "Port mapping" })).toHaveValue("8022:22");
    await expect(rows.nth(0).getByRole("combobox", { name: "Protocol" })).toContainText(
      "Tailscale"
    );
    await expect(rows.nth(1).getByRole("combobox", { name: "Protocol" })).toContainText("TCP");

    await rows.nth(1).getByRole("combobox", { name: "Protocol" }).click();
    await page.getByRole("option", { name: "Tailscale" }).click();
    await page.locator('[data-testid="panel-apply-btn"]').click();

    await expect
      .poll(async () => (await readTopology(topoViewerPage)).topology.nodes.srl1.ports)
      .toEqual(["8022:22/ts", "50080:80/ts"]);
  });

  test("a deployed lab shows its Tailscale devices and the login link", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.writeYamlFile(SIMPLE_FILE, WITH_PROXY);
    await topoViewerPage.waitForCanvasReady();
    await setDeployed(page, PROXY_STATUS);
    const modal = await openMgmtTab(page);

    const status = modal.getByTestId("lab-settings-tailscale-status");
    await expect(status).toContainText("clab-simple");
    await expect(status).toContainText("Lab proxy");
    await expect(status).toContainText("Needs login");
    await expect(status).toContainText(":8022 → srl1 (172.20.20.2:22)");
    await expect(status.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "https://login.tailscale.com/a/0123"
    );
  });

  test("no status shows when the lab host cannot report it", async ({ page, topoViewerPage }) => {
    await topoViewerPage.writeYamlFile(SIMPLE_FILE, WITH_PROXY);
    await topoViewerPage.waitForCanvasReady();
    await setDeployed(page, null);
    const modal = await openMgmtTab(page);
    await expect(modal.getByRole("combobox", { name: "Tailscale" })).toBeVisible();
    await expect(modal.getByTestId("lab-settings-tailscale-status")).toHaveCount(0);
  });
});
