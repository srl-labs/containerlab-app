import type { Page } from "@playwright/test";
import { expect, test, waitForWorkspace } from "@srl-labs/containerlab-test-kit/playwright";

const FILES_KEY = "clab-pages-sandbox-files-v1";
const TOPOLOGY = [
  "name: demo",
  "topology:",
  "  nodes:",
  "    r1:",
  "      kind: linux",
  "      image: alpine:latest",
  "      startup-config: configs/__clabNodeName__.cfg",
  "      binds:",
  "        - motd.txt:/etc/motd",
  ""
].join("\n");

function storedFiles(page: Page): Promise<Record<string, string>> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, string>, FILES_KEY);
}

test("a topology's files open in workspace tabs, missing ones created empty", async ({ page }) => {
  await page.addInitScript(
    ({ key, topology }) =>
      localStorage.setItem(key, JSON.stringify({ "demo.clab.yml": topology, "configs/r1.cfg": "hostname r1\n" })),
    { key: FILES_KEY, topology: TOPOLOGY }
  );
  await page.goto("/");
  await waitForWorkspace(page);
  await page.getByTestId("workspace-rail").getByRole("button", { name: "Labs", exact: true }).click();
  await page.getByTestId("workspace-sidebar").getByText("demo.clab.yml", { exact: true }).click();
  await page.getByRole("button", { name: "Close explorer", exact: true }).click();
  const node = page.locator(".react-flow__node");
  await expect(node).toHaveCount(1);

  // The node's startup config, from its context menu.
  await node.click({ button: "right" });
  await page.getByTestId("context-menu-item-files-node").hover();
  await page.getByTestId("context-menu-item-files-node-0").click();
  const editor = page.getByTestId("file-editor-tab-panel");
  await expect(editor).toBeVisible();
  await expect(page.getByRole("tab", { name: /r1\.cfg/ })).toHaveAttribute("aria-selected", "true");
  await expect(editor.getByText("hostname r1")).toBeVisible();

  // A missing bind source, Ctrl+clicked in the topology's YAML tab.
  await page.getByRole("tab", { name: /demo/ }).first().click();
  await page.getByTestId("navbar-split-view").click();
  const link = page.locator(".monaco-editor .detected-link").filter({ hasText: "motd.txt" });
  await expect(link).toBeVisible({ timeout: 15000 });
  await link.click({ modifiers: ["ControlOrMeta"] });

  await expect(page.getByRole("tab", { name: /motd\.txt/ })).toHaveAttribute("aria-selected", "true");
  await expect.poll(async () => (await storedFiles(page))["motd.txt"]).toBe("");
});
