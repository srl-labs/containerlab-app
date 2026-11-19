import { expect, test, waitForWorkspace } from "@srl-labs/containerlab-test-kit/playwright";

const TOPOLOGY =
  "name: pair\ntopology:\n  nodes:\n    r1:\n      kind: linux\n      image: alpine:latest\n    r2:\n      kind: linux\n      image: alpine:latest\n  links:\n    - endpoints: [r1:eth1, r2:eth1]\n";

const GUIDE = [
  "---",
  "title: Ping across",
  "---",
  "",
  "## Look around",
  "",
  "Start on [r1](node:r1):",
  "",
  "```sh exec=r1",
  "ip -br addr",
  "```",
  "",
  "```sh terminal=r2",
  "ping -c 1 r1",
  "```",
  ""
].join("\n");

test("the sandbox shows a lab's guide with blocks to copy and tick", async ({ page }) => {
  await page.addInitScript(
    ([topology, guide]) =>
      localStorage.setItem(
        "clab-pages-sandbox-files-v1",
        JSON.stringify({ "pair.clab.yml": topology, "pair.clab.md": guide })
      ),
    [TOPOLOGY, GUIDE]
  );
  await page.goto("/");
  await waitForWorkspace(page);
  await page.getByTestId("workspace-rail").getByRole("button", { name: "Labs", exact: true }).click();
  const sidebar = page.getByTestId("workspace-sidebar");
  // The guide is no topology of its own.
  await expect(sidebar.getByText("pair.clab.md", { exact: true })).toHaveCount(0);
  await sidebar.getByText("pair.clab.yml", { exact: true }).click();
  await page.getByRole("button", { name: "Close explorer", exact: true }).click();

  const guide = page.getByTestId("guide-tab");
  if (!(await guide.isVisible())) await page.getByTestId("panel-toggle-btn").click();
  await expect(page.getByTestId("guide-title")).toHaveText("Ping across");

  // No lab runs here: nothing to run, send or deploy, but everything to copy.
  const blocks = page.getByTestId("guide-block");
  await expect(blocks).toHaveCount(2);
  await expect(page.getByTestId("guide-block-run")).toHaveCount(0);
  await expect(page.getByTestId("guide-deploy-banner")).toHaveCount(0);
  await expect(page.getByTestId("guide-block-copy")).toHaveCount(2);

  await blocks.nth(0).getByTestId("guide-block-tick").click();
  await blocks.nth(1).getByTestId("guide-block-tick").click();
  await expect(page.getByTestId("guide-step").first()).toHaveAttribute("data-done", "true");
});
