import type { Page } from "@playwright/test";
import * as YAML from "yaml";

import { test, expect } from "../fixtures/topoviewer";

const FILE = "simple.clab.yml";
const SEL_APPLY_BTN = '[data-testid="panel-apply-btn"]';
const SEL_KIND_TAB = '[data-testid="panel-tab-kind"]';

const TOPOLOGY = `name: simple

topology:
  kinds:
    nokia_srlinux:
      custom-prompt: false
  nodes:
    srl1:
      kind: nokia_srlinux
      type: ixr-d1
      image: ghcr.io/nokia/srlinux:latest
    srl2:
      kind: frr
      image: quay.io/frrouting/frr:10.2.1

  links:
    - endpoints: [ "srl1:e1-1", "srl2:e1-1" ]
`;

async function readNode(
  topoViewerPage: { getYamlFromFile: (file: string) => Promise<string> },
  nodeId: string
): Promise<Record<string, unknown>> {
  const parsed = YAML.parse(await topoViewerPage.getYamlFromFile(FILE)) as {
    topology: { nodes: Record<string, Record<string, unknown>> };
  };
  return parsed.topology.nodes[nodeId];
}

async function openNode(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-id="${nodeId}"]`);
  await expect(node).toBeVisible({ timeout: 3000 });
  const box = await node.boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function openKindTab(page: Page, nodeId: string): Promise<void> {
  await openNode(page, nodeId);
  const tab = page.locator(SEL_KIND_TAB);
  await expect(tab).toBeVisible({ timeout: 3000 });
  await tab.click();
}

test.describe("Kind-specific config", () => {
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

  test("edits the SR Linux keys and line cards from the schema", async ({ page, topoViewerPage }) => {
    await openKindTab(page, "srl1");

    const customPrompt = page.locator("#kind-config-custom-prompt");
    await expect(customPrompt).toHaveText("Disabled");
    await expect(page.getByText("From kind nokia_srlinux")).toBeVisible();

    await page.locator("#kind-config-eda-default-grpc-server").click();
    await page.getByRole("option", { name: "Enabled", exact: true }).click();

    await page.getByRole("button", { name: "Add" }).click();
    await page.locator("#kind-config-components-0-slot").fill("1");
    await page.locator("#kind-config-components-0-type").fill("imm36-800g-qsfpdd");
    await page.locator(SEL_APPLY_BTN).click();

    await expect
      .poll(async () => readNode(topoViewerPage, "srl1"))
      .toEqual({
        kind: "nokia_srlinux",
        type: "ixr-d1",
        image: "ghcr.io/nokia/srlinux:latest",
        "eda-default-grpc-server": true,
        components: [{ slot: 1, type: "imm36-800g-qsfpdd" }]
      });
  });

  test("picks FRR daemons and drops them when the kind changes", async ({
    page,
    topoViewerPage
  }) => {
    await openKindTab(page, "srl2");

    await page.getByRole("checkbox", { name: "ospfd" }).check();
    await page.getByRole("checkbox", { name: "bgpd" }).check();
    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(async () => (await readNode(topoViewerPage, "srl2")).daemons)
      .toEqual(["bgpd", "ospfd"]);

    await page.locator('[data-testid="panel-tab-basic"]').click();
    const kindField = page.locator("#node-kind");
    await kindField.clear();
    await kindField.fill("linux");
    await kindField.blur();
    await expect(page.locator(SEL_KIND_TAB)).toHaveCount(0);
    await page.locator(SEL_APPLY_BTN).click();

    await expect.poll(async () => (await readNode(topoViewerPage, "srl2")).kind).toBe("linux");
    expect((await readNode(topoViewerPage, "srl2")).daemons).toBeUndefined();
  });

  test("shows no Kind tab for kinds without kind-specific keys", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.writeYamlFile(FILE, TOPOLOGY.replace("kind: frr", "kind: linux"));
    await topoViewerPage.waitForCanvasReady();
    await openNode(page, "srl2");
    await expect(page.locator('[data-testid="panel-tab-basic"]')).toBeVisible();
    await expect(page.locator(SEL_KIND_TAB)).toHaveCount(0);
  });
});
