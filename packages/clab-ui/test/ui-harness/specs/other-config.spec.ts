import type { Locator, Page } from "@playwright/test";
import * as YAML from "yaml";

import { test, expect } from "../fixtures/topoviewer";

const FILE = "simple.clab.yml";
const SEL_APPLY_BTN = '[data-testid="panel-apply-btn"]';
const SEL_OTHER_TAB = '[data-testid="panel-tab-other"]';

const TOPOLOGY = `name: simple

topology:
  defaults:
    tmpfs:
      /run: rw,nosuid
  groups:
    edge:
      hostname: edge-host
  nodes:
    host1:
      kind: linux
      image: alpine:3
      group: edge
    host2:
      kind: linux
      image: alpine:3

  links:
    - endpoints: [ "host1:eth1", "host2:eth1" ]
`;

interface ParsedTopology {
  topology: {
    defaults?: Record<string, unknown>;
    nodes: Record<string, Record<string, unknown>>;
  };
}

async function readTopology(topoViewerPage: {
  getYamlFromFile: (file: string) => Promise<string>;
}): Promise<ParsedTopology> {
  return YAML.parse(await topoViewerPage.getYamlFromFile(FILE)) as ParsedTopology;
}

async function openOtherTab(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-id="${nodeId}"]`);
  await expect(node).toBeVisible({ timeout: 3000 });
  const box = await node.boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const tab = page.locator(SEL_OTHER_TAB);
  await expect(tab).toBeVisible({ timeout: 3000 });
  await tab.click();
}

async function selectOption(page: Page, id: string, name: string): Promise<void> {
  await page.locator(`#${id}`).click();
  await page.getByRole("option", { name, exact: true }).click();
}

function sectionOf(scope: Page | Locator, title: string): Locator {
  return scope.getByText(title, { exact: true }).locator("..");
}

test.describe("Other node settings", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(FILE);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.writeYamlFile(FILE, TOPOLOGY);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
  });

  test("edits node keys from the schema and writes only what is not inherited", async ({
    page,
    topoViewerPage
  }) => {
    await openOtherTab(page, "host1");

    const hostname = page.locator("#other-config-hostname");
    await expect(hostname).toHaveValue("edge-host");
    await expect(page.getByText("From group edge")).toBeVisible();
    const tmpfs = page.getByTestId("other-config-tmpfs-entries");
    await expect(tmpfs.getByLabel("Key").first()).toHaveValue("/run");

    await hostname.fill("web-01");
    await expect(page.getByText("Overrides group edge")).toBeVisible();
    await selectOption(page, "other-config-privileged", "Disabled");
    await selectOption(page, "other-config-link-apply-mode", "live");

    await sectionOf(page, "Volumes").getByRole("button", { name: "Add" }).click();
    await page.getByTestId("other-config-volumes-items").getByRole("textbox").last().fill("data:/data");

    await sectionOf(page, "tmpfs").getByRole("button", { name: "Add" }).click();
    await tmpfs.getByLabel("Key").last().fill("/tmp");
    await tmpfs.getByLabel("Value").last().fill("rw,size=64m");

    const vars = page.getByTestId("other-config-config-vars-entries");
    const varsSection = sectionOf(page, "Startup Config Variables");
    await varsSection.getByRole("button", { name: "Add" }).click();
    await vars.getByLabel("Key").last().fill("asn");
    await vars.getByLabel("Value").last().fill("65001");
    await varsSection.getByRole("button", { name: "Add" }).click();
    await vars.getByLabel("Key").last().fill("ifaces");
    await vars.getByLabel("Value").last().fill("[2, 4]");

    await page.locator(SEL_APPLY_BTN).click();

    await expect
      .poll(async () => (await readTopology(topoViewerPage)).topology.nodes.host1)
      .toEqual({
        kind: "linux",
        image: "alpine:3",
        group: "edge",
        hostname: "web-01",
        privileged: false,
        "link-apply-mode": "live",
        volumes: ["data:/data"],
        tmpfs: { "/tmp": "rw,size=64m" },
        config: { vars: { asn: 65001, ifaces: [2, 4] } }
      });
  });

  test("topology defaults are edited in the same tab", async ({ page, topoViewerPage }) => {
    await page.locator('[data-testid="navbar-lab-settings"]').click();
    const modal = page.locator('[data-testid="lab-settings-modal"]');
    await expect(modal).toBeVisible();
    await modal.getByTestId("lab-settings-tab-inheritance").click();
    await modal.getByRole("button", { name: "Edit Topology defaults" }).click();

    const dialog = page.locator('[data-testid="inheritance-section-dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("panel-tab-other").click();
    await expect(
      dialog.getByTestId("other-config-tmpfs-entries").getByLabel("Value").first()
    ).toHaveValue("rw,nosuid");
    await dialog.locator("#other-config-pid-mode").fill("host");
    await sectionOf(dialog, "Security Options").getByRole("button", { name: "Add" }).click();
    await dialog
      .getByTestId("other-config-security-opts-items")
      .getByRole("textbox")
      .last()
      .fill("seccomp=unconfined");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    await expect
      .poll(async () => (await readTopology(topoViewerPage)).topology.defaults)
      .toEqual({
        tmpfs: { "/run": "rw,nosuid" },
        "pid-mode": "host",
        "security-opts": ["seccomp=unconfined"]
      });
  });
});
