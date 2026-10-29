import type { Page } from "@playwright/test";

import type { BrowserDevApi } from "../devApi";
import { test, expect } from "../fixtures/topoviewer";
import { openNodeContextMenu } from "../helpers/react-flow-helpers";

const SPINE_LEAF_FILE = "spine-leaf.clab.yml";

async function setDeploymentState(page: Page, state: "deployed" | "undeployed"): Promise<void> {
  await page.evaluate((next) => {
    const dev = (window as { __DEV__?: BrowserDevApi }).__DEV__;
    if (!dev) throw new Error("__DEV__ API not available");
    dev.setDeploymentState?.(next);
  }, state);
}

async function openDeployMenuItem(page: Page, testId: string): Promise<void> {
  await page.getByTestId("navbar-deploy-menu").click();
  await page.getByTestId(testId).click();
}

const C9S_PLAN = {
  dryRun: true,
  deployedLab: false,
  "lab-name": "spine-leaf",
  namespace: "c9s-spine-leaf",
  addedNodes: ["client3"],
  recreatedNodes: ["spine1"],
  changes: [
    { action: "create", kind: "Node", namespace: "c9s-spine-leaf", name: "client3" },
    { action: "recreate", kind: "Node", namespace: "c9s-spine-leaf", name: "spine1" },
    { action: "update", kind: "Topology", namespace: "c9s-spine-leaf", name: "spine-leaf" }
  ]
};

test.describe("A lab on a Kubernetes cluster (c9s)", () => {
  test.beforeEach(async ({ page, topoViewerPage }) => {
    await page.addInitScript(() => {
      (window as { __CLAB_UI_HARNESS_LAB_HOST__?: unknown }).__CLAB_UI_HARNESS_LAB_HOST__ = "c9s";
    });
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SPINE_LEAF_FILE);
    await topoViewerPage.waitForCanvasReady();
  });

  test("hides link impairments, and offers capture and kubectl", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await openNodeContextMenu(page, "leaf1");
    await expect(page.getByTestId("context-menu-item-info-node")).toBeVisible();
    await expect(page.getByTestId("context-menu-item-capture-node")).toBeVisible();
    await expect(page.getByTestId("context-menu-item-copy-kubectl-exec")).toBeVisible();
    await page.getByTestId("context-menu-item-copy-kubectl-exec").click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("kubectl --context kind-harness -n c9s-spine-leaf exec -it spine-leaf-leaf1-6d9f7c-x2k4q -c node-leaf1-1a2b3c -- sh");
  });

  test("captures lab links only: eth0 and lo are not offered", async ({ page }) => {
    await page.evaluate(() => {
      const dev = (window as { __DEV__?: BrowserDevApi }).__DEV__;
      if (!dev) throw new Error("__DEV__ API not available");
      dev.setDeploymentState?.("deployed");
      // containerlab reports a c9s node's interfaces as Docker does: eth0, the lab links and lo.
      const interfaces = [
        { name: "eth0", state: "up" },
        { name: "e1-49", alias: "ethernet-1/49", state: "up" },
        { name: "lo", state: "unknown" }
      ];
      dev.emitHostMessage({
        type: "node-data-updated",
        data: { nodeUpdates: [{ containerLongName: "spine-leaf-leaf1", containerShortName: "leaf1", state: "running", interfaces }] }
      });
    });
    await openNodeContextMenu(page, "leaf1");
    await page.getByTestId("context-menu-item-capture-node").hover();
    const rows = page.locator('[data-testid="capture-interface-row"]');
    await expect(rows.first()).toBeVisible();
    const names = await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-interface")));
    expect(names).not.toContain("eth0");
    expect(names).not.toContain("lo");
    expect(names.length).toBeGreaterThan(0);
    // Every row is a link end with its peer.
    for (const name of names) {
      await expect(page.locator(`[data-testid="capture-interface-row"][data-interface="${name}"]`)).toContainText(/spine|client/);
    }
  });

  test("shows where a node runs in its info", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await openNodeContextMenu(page, "leaf1");
    await page.getByTestId("context-menu-item-info-node").click();
    const section = page.getByTestId("node-kubernetes");
    await expect(section).toBeVisible();
    await expect(section.getByLabel("Namespace")).toHaveValue("c9s-spine-leaf");
    await expect(page.getByLabel("Pod")).toHaveValue("spine-leaf-leaf1-6d9f7c-x2k4q");
    await expect(page.getByLabel("Exposed ports")).toHaveValue("22/tcp");
    await expect(page.getByTestId("node-kubernetes-persistence")).toContainText("persistent volume");
  });

  test("offers the c9s deploy options and greys out the Docker-only ones", async ({ page }) => {
    await openDeployMenuItem(page, "navbar-deploy-item-options");
    const dialog = page.getByTestId("lifecycle-options-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("lifecycle-options-c9s")).toBeVisible();
    // Shown, not hidden, so users see they exist; disabled with why.
    await expect(page.getByTestId("lifecycle-options-skip-post-deploy").locator("input")).toBeDisabled();
    await expect(page.getByTestId("lifecycle-options-skip-post-deploy")).toContainText("Not supported on Kubernetes (c9s)");
    await expect(page.getByTestId("lifecycle-options-nodes")).toBeDisabled();
    await expect(page.getByTestId("lifecycle-options-restore").locator("input")).toBeDisabled();
    await expect(page.getByTestId("lifecycle-options-restore")).toContainText("no VM snapshots");
    await page.locator("#lifecycle-options-namespace").fill("team-a");
    await page.getByTestId("lifecycle-options-no-persistence").locator('input[type="checkbox"]').check();
    await expect(page.getByTestId("lifecycle-options-command")).toHaveText(
      "containerlab deploy -r c9s --namespace team-a --no-persistence"
    );
    await page.locator("#lifecycle-options-namespace").fill("Team_A");
    await expect(page.getByTestId("lifecycle-options-run")).toBeDisabled();
  });

  test("shows the apply plan's resource changes and which nodes restart", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await page.evaluate((value) => {
      (window as { __CLAB_UI_HARNESS_APPLY_PLAN__?: unknown }).__CLAB_UI_HARNESS_APPLY_PLAN__ = value;
    }, C9S_PLAN);
    await page.getByTestId("navbar-deploy").click();
    await expect(page.getByTestId("apply-plan-dialog")).toBeVisible();
    await expect(page.getByTestId("apply-plan-changes")).toContainText("Kubernetes resources in c9s-spine-leaf");
    const recreate = page.getByTestId("apply-plan-change-recreate");
    await expect(recreate).toHaveAttribute("data-recreate", "true");
    await expect(recreate).toContainText("spine1");
    await expect(page.getByTestId("apply-plan-recreate-warning")).toContainText("These nodes restart: spine1");
  });

  test("shows what containerlab validate -r c9s rejects in the source editor", async ({ page, topoViewerPage }) => {
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await page.getByTestId("navbar-split-view").click();
    await page.locator('[data-testid="panel-tab-yaml"]').click();
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 15000 });
    await page.waitForFunction(() =>
      Boolean((window as { __clabMonacoDebug?: unknown }).__clabMonacoDebug)
    );
    await page.evaluate(() => {
      (window as { __CLAB_UI_HARNESS_VALIDATE_ERROR__?: unknown }).__CLAB_UI_HARNESS_VALIDATE_ERROR__ =
        "yaml: line 3: macvlan endpoints are not supported by the c9s runtime";
      const debug = (
        window as {
          __clabMonacoDebug?: { model: { getValue: () => string }; setValue: (value: string) => void };
        }
      ).__clabMonacoDebug;
      if (!debug) throw new Error("Monaco debug API is not available");
      // An edit makes the lab host validate again.
      debug.setValue(`${debug.model.getValue()}\n# edited\n`);
    });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const debug = (window as { __clabMonacoDebug?: { getMarkers: () => Array<{ message: string }> } })
              .__clabMonacoDebug;
            return debug?.getMarkers().map((marker) => marker.message) ?? [];
          }),
        { timeout: 10000 }
      )
      .toContain("containerlab validate -r c9s: yaml: line 3: macvlan endpoints are not supported by the c9s runtime");
  });

  test("exports the Kubernetes manifests", async ({ page }) => {
    await openDeployMenuItem(page, "navbar-deploy-item-export-manifests");
    await expect(page.getByTestId("manifest-export-yaml")).toContainText("kind: Topology");
    await expect(page.getByTestId("manifest-export-yaml")).toContainText("namespace: c9s-spine-leaf");
  });

  test("Lab settings > Deploy shows the cluster's options and greys out what it refuses", async ({ page }) => {
    await page.locator('[data-testid="navbar-lab-settings"]').click();
    const modal = page.getByTestId("lab-settings-modal");
    await modal.getByTestId("lab-settings-tab-deploy").click();
    await expect(modal.getByTestId("lab-deploy-storage")).toContainText("Kubernetes · kind-harness");
    await expect(modal.locator("#lab-deploy-namespace")).toHaveAttribute("placeholder", "c9s-<lab>");
    await expect(modal.locator("#lab-deploy-export-template")).toBeDisabled();
    await expect(modal.getByTestId("lab-deploy-skip-post-deploy").locator("input")).toBeDisabled();
    await modal.locator("#lab-deploy-namespace").fill("team-a");
    await modal.getByTestId("lab-settings-save-btn").click();
    await page.getByTestId("lab-settings-close-btn").click();
    await openDeployMenuItem(page, "navbar-deploy-item-options");
    await expect(page.locator("#lifecycle-options-namespace")).toHaveValue("team-a");
  });

  test("Lab settings grey out the management and CA options the cluster lacks, with why", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await page.locator('[data-testid="navbar-lab-settings"]').click();
    const modal = page.getByTestId("lab-settings-modal");
    await modal.getByTestId("lab-settings-tab-mgmt").click();
    await expect(modal.getByTestId("lab-mgmt-runtime-limit")).toContainText("Ignored on Kubernetes (c9s)");
    await expect(modal.getByTestId("lab-settings-mgmt-add-network")).toBeDisabled();
    await modal.getByTestId("lab-settings-tab-certificates").click();
    await expect(modal.getByTestId("runtime-limit-note").first()).toContainText("Not supported on Kubernetes (c9s)");
  });
});

test.describe("A lab on Docker", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(SPINE_LEAF_FILE);
    await topoViewerPage.waitForCanvasReady();
  });

  test("keeps capture, and has no Kubernetes actions", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await openNodeContextMenu(page, "leaf1");
    await expect(page.getByTestId("context-menu-item-capture-node")).toBeVisible();
    await expect(page.getByTestId("context-menu-item-copy-kubectl-exec")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByTestId("navbar-deploy-menu").click();
    await expect(page.getByTestId("navbar-deploy-item-export-manifests")).toHaveCount(0);
  });

});
