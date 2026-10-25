import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

// The harness host reports branch "main", the topology directory
// /home/clab/labs and SRL_IMAGE in its environment.
const TOPOLOGY = `name: dc-__gitBranch__
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
      image: \${SRL_IMAGE:=ghcr.io/nokia/srlinux}
      startup-config: __clabNodeDir__/startup.cfg
      binds:
        - \${CFG_DIR:=./configs}/__clabNodeName__:/cfg
      exec:
        - echo $UNSET_VAR
  links: []
`;

async function openNodeTab(page: Page, nodeId: string, tab: string): Promise<void> {
  const node = page.locator(`[data-id="${nodeId}"]`);
  await expect(node).toBeVisible({ timeout: 3000 });
  const box = await node.boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText("Node Editor", { exact: true })).toBeVisible();
  await page.locator(`[data-testid="panel-tab-${tab}"]`).click();
}

test.describe("Topology variables in the node editor", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.writeYamlFile("simple.clab.yml", TOPOLOGY);
    await topoViewerPage.gotoFile("simple.clab.yml");
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
  });

  test("previews what containerlab expands in node fields", async ({ page }) => {
    await openNodeTab(page, "srl1", "config");

    // The lab name comes from the host with its Git branch expanded.
    await expect(page.getByTestId("node-startup-config-variables")).toHaveText(
      "Resolves to: /home/clab/labs/clab-dc-main/srl1/startup.cfg"
    );
    await expect(page.getByTestId("node-binds-0-variables")).toHaveText(
      "Resolves to: ./configs/srl1:/cfg"
    );

    await page.locator('[data-testid="panel-tab-runtime"]').click();
    await expect(page.getByTestId("node-exec-0-variables")).toHaveText(
      "Resolves to: echo $UNSET_VAR ($UNSET_VAR not set)"
    );
  });

  test("suggests magic variables while one is typed", async ({ page }) => {
    await openNodeTab(page, "srl1", "config");
    const field = page.locator("#node-startup-config");
    await field.fill("");
    await field.pressSequentially("cfg/__clabN");

    const suggestions = page.getByTestId("node-startup-config-magic-variables");
    await expect(suggestions).toBeVisible();
    await expect(suggestions.getByRole("menuitem")).toHaveCount(2);
    await expect(suggestions).toContainText("__clabNodeName__");
    await expect(suggestions).toContainText("/home/clab/labs/clab-dc-main/srl1");

    await field.press("ArrowDown");
    await field.press("Enter");
    await expect(field).toHaveValue("cfg/__clabNodeDir__");
    await expect(suggestions).toHaveCount(0);
    await expect(page.getByTestId("node-startup-config-variables")).toHaveText(
      "Resolves to: cfg//home/clab/labs/clab-dc-main/srl1"
    );

    // Escape closes the list without inserting anything.
    await field.pressSequentially(" __clab");
    await expect(suggestions.getByRole("menuitem")).toHaveCount(4);
    await field.press("Escape");
    await expect(suggestions).toHaveCount(0);
    await expect(field).toHaveValue("cfg/__clabNodeDir__ __clab");
  });
});
