import { test, expect } from "../fixtures/topoviewer";

test.describe("Validate topology", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile("spine-leaf.clab.yml");
    await topoViewerPage.waitForCanvasReady();
  });

  test("the deploy menu asks the host to validate the topology", async ({ page }) => {
    await page.getByTestId("navbar-deploy-menu").click();
    await page.getByTestId("navbar-deploy-item-validate").click();
    await expect(page.getByTestId("navbar-deploy-item-validate")).toBeHidden();

    const commands = await page.evaluate(() =>
      ((window as { __CLAB_UI_HARNESS_MESSAGES__?: Array<{ command: string }> })
        .__CLAB_UI_HARNESS_MESSAGES__ ?? []).map((message) => message.command)
    );
    expect(commands).toContain("topo-validate");
  });
});
