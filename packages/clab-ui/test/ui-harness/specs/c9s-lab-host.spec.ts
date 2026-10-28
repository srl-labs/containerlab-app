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

  test("hides capture and link impairments, and offers kubectl", async ({ page }) => {
    await setDeploymentState(page, "deployed");
    await openNodeContextMenu(page, "leaf1");
    await expect(page.getByTestId("context-menu-item-info-node")).toBeVisible();
    await expect(page.getByTestId("context-menu-item-capture-node")).toHaveCount(0);
    await expect(page.getByTestId("context-menu-item-copy-kubectl-exec")).toBeVisible();
    await page.getByTestId("context-menu-item-copy-kubectl-exec").click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("kubectl --context kind-harness -n c9s-spine-leaf exec -it spine-leaf-leaf1-6d9f7c-x2k4q -c node-leaf1-1a2b3c -- sh");
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

  test("offers the c9s deploy options and hides the Docker-only ones", async ({ page }) => {
    await openDeployMenuItem(page, "navbar-deploy-item-options");
    const dialog = page.getByTestId("lifecycle-options-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("lifecycle-options-c9s")).toBeVisible();
    await expect(page.getByTestId("lifecycle-options-skip-post-deploy")).toHaveCount(0);
    await expect(page.getByTestId("lifecycle-options-nodes")).toHaveCount(0);
    await expect(page.getByTestId("lifecycle-options-restore")).toHaveCount(0);
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
