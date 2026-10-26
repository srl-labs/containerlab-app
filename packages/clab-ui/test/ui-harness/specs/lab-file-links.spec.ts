import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";
import { openNodeContextMenu } from "../helpers/react-flow-helpers";

const FILE = "simple.clab.yml";

const TOPOLOGY = `name: simple

topology:
  kinds:
    nokia_srlinux:
      license: licenses/srl.key
  nodes:
    srl1:
      kind: nokia_srlinux
      type: ixr-d1
      image: ghcr.io/nokia/srlinux:latest
      startup-config: configs/__clabNodeName__.cfg
      binds:
        - certs/ca.pem:/etc/ca.pem:ro
        - /lib/modules:/lib/modules
    srl2:
      kind: nokia_srlinux
      type: ixr-d1
      image: ghcr.io/nokia/srlinux:latest

  links:
    - endpoints: [ "srl1:e1-1", "srl2:e1-1" ]
`;

interface OpenLabFileMessage {
  command: string;
  path?: string;
  create?: boolean;
}

/** The files the editor asked the host to open, in order. */
async function openedFiles(page: Page): Promise<Array<{ path?: string; create?: boolean }>> {
  return page.evaluate(() =>
    ((window as { __CLAB_UI_HARNESS_MESSAGES__?: OpenLabFileMessage[] })
      .__CLAB_UI_HARNESS_MESSAGES__ ?? [])
      .filter((message) => message.command === "openLabFile")
      .map(({ path, create }) => ({ path, create }))
  );
}

test.describe("Lab file links", () => {
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

  test("Ctrl+click on a bind or startup config in the YAML tab opens the file", async ({
    page
  }) => {
    await page.getByTestId("navbar-split-view").click();
    await page.getByTestId("panel-tab-yaml").click();
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 15000 });

    const links = page.locator(".monaco-editor .detected-link");
    // Directory binds such as /lib/modules have no link.
    await expect(links).toHaveText(["licenses/srl.key", "configs/__clabNodeName__.cfg", "certs/ca.pem"], {
      timeout: 10000
    });

    await links.filter({ hasText: "certs/ca.pem" }).click({ modifiers: ["ControlOrMeta"] });
    await links
      .filter({ hasText: "configs/__clabNodeName__.cfg" })
      .click({ modifiers: ["ControlOrMeta"] });

    await expect
      .poll(() => openedFiles(page))
      .toEqual([
        { path: "certs/ca.pem", create: true },
        { path: "configs/srl1.cfg", create: true }
      ]);
  });

  test("the node context menu lists the node's files, inherited ones included", async ({
    page
  }) => {
    await openNodeContextMenu(page, "srl1");
    const files = page.getByTestId("context-menu-item-files-node");
    await expect(files).toBeVisible();
    await files.hover();

    const entries = page.locator('[data-testid^="context-menu-item-files-node-"]');
    await expect(entries).toHaveText(["configs/srl1.cfg", "licenses/srl.key", "certs/ca.pem"]);
    await entries.nth(1).click();

    await expect
      .poll(() => openedFiles(page))
      .toEqual([{ path: "licenses/srl.key", create: true }]);
    await expect(page.getByTestId("context-menu")).toBeHidden();
  });

  test("a node that only inherits a license lists just that file", async ({ page }) => {
    await openNodeContextMenu(page, "srl2");
    await page.getByTestId("context-menu-item-files-node").hover();
    await expect(page.locator('[data-testid^="context-menu-item-files-node-"]')).toHaveText([
      "licenses/srl.key"
    ]);
  });

  test("the Config tab opens the startup config, license and binds", async ({ page }) => {
    const node = page.locator('[data-id="srl1"]');
    const box = await node.boundingBox();
    if (!box) throw new Error("srl1 has no bounding box");
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByTestId("panel-tab-config").click();

    await page.getByTestId("node-startup-config-open").click();
    await page.getByTestId("node-license-open").click();
    // Only the file bind gets a button.
    await expect(page.getByTestId("node-bind-open")).toHaveCount(1);
    await page.getByTestId("node-bind-open").click();

    await expect
      .poll(() => openedFiles(page))
      .toEqual([
        { path: "configs/srl1.cfg", create: true },
        { path: "licenses/srl.key", create: true },
        { path: "certs/ca.pem", create: true }
      ]);
  });
});
