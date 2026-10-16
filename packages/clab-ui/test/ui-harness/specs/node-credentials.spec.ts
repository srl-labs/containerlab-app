import type { Page } from "@playwright/test";
import * as YAML from "yaml";

import { test, expect } from "../fixtures/topoviewer";

const SIMPLE_FILE = "simple.clab.yml";
const SEL_APPLY_BTN = '[data-testid="panel-apply-btn"]';
const SEL_USERNAME = "#node-credentials-username";
const SEL_PASSWORD = "#node-credentials-password";
const SEL_IDENTITY_FILE = "#node-credentials-identity-file";

const KIND_CREDENTIALS = [
  "  kinds:",
  "    nokia_srlinux:",
  "      credentials:",
  "        username: srl-admin",
  "        password: srl-password",
  "  defaults:",
  "    credentials:",
  "      identity-file: ~/.ssh/lab"
].join("\n");

async function openConfigTab(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-id="${nodeId}"]`);
  await expect(node).toBeVisible({ timeout: 3000 });
  const box = await node.boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const tab = page.locator('[data-testid="panel-tab-config"]');
  await expect(tab).toBeVisible({ timeout: 3000 });
  await tab.click();
  await page.locator(SEL_USERNAME).scrollIntoViewIfNeeded();
}

function nodeCredentials(yaml: string, nodeId: string): unknown {
  const parsed = YAML.parse(yaml) as {
    topology: { nodes: Record<string, { credentials?: unknown }> };
  };
  return parsed.topology.nodes[nodeId].credentials;
}

test.describe("Node credentials", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SIMPLE_FILE);
    await topoViewerPage.waitForCanvasReady();
    const yaml = await topoViewerPage.getYamlFromFile(SIMPLE_FILE);
    await topoViewerPage.writeYamlFile(
      SIMPLE_FILE,
      yaml.replace("topology:\n", `topology:\n${KIND_CREDENTIALS}\n`)
    );
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
  });

  test("shows the inherited login and key as placeholders", async ({ page }) => {
    await openConfigTab(page, "srl1");

    await expect(page.locator(SEL_USERNAME)).toHaveValue("");
    await expect(page.locator(SEL_USERNAME)).toHaveAttribute("placeholder", "srl-admin");
    await expect(page.locator(SEL_PASSWORD)).toHaveAttribute("placeholder", "Inherited password");
    await expect(page.locator(SEL_IDENTITY_FILE)).toHaveAttribute("placeholder", "~/.ssh/lab");
    await expect(page.getByText("Inherited from the kind settings.", { exact: false })).toBeVisible();
    await expect(page.getByText("Inherited from the topology defaults")).toBeVisible();
  });

  test("a node login replaces the inherited one and saves to the node", async ({
    page,
    topoViewerPage
  }) => {
    await openConfigTab(page, "srl1");

    await page.locator(SEL_PASSWORD).fill("secret");
    // Only a password is set now, so the username falls back to the kind default
    await expect(page.locator(SEL_USERNAME)).toHaveAttribute("placeholder", "Kind default");
    await expect(page.getByText("Replaces the login from the kind settings", { exact: false })).toBeVisible();

    await expect(page.locator(SEL_PASSWORD)).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show value" }).click();
    await expect(page.locator(SEL_PASSWORD)).toHaveAttribute("type", "text");

    await page.locator(SEL_USERNAME).fill("lab");
    await page.locator(SEL_IDENTITY_FILE).fill("keys/srl1");
    await page.locator(SEL_APPLY_BTN).click();

    await expect
      .poll(async () => nodeCredentials(await topoViewerPage.getYamlFromFile(SIMPLE_FILE), "srl1"))
      .toEqual({ username: "lab", password: "secret", "identity-file": "keys/srl1" });
    expect(nodeCredentials(await topoViewerPage.getYamlFromFile(SIMPLE_FILE), "srl2")).toBeUndefined();
  });
});
