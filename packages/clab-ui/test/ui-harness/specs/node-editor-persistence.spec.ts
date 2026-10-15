import type { Page } from "@playwright/test";
import * as YAML from "yaml";

import { test, expect } from "../fixtures/topoviewer";

// Test selectors - ContextPanel-based
const SEL_APPLY_BTN = '[data-testid="panel-apply-btn"]';
const SEL_TOGGLE_BTN = '[data-testid="panel-toggle-btn"]';

// Tab identifiers
const TAB = {
  BASIC: "basic",
  CONFIG: "config",
  RUNTIME: "runtime",
  NETWORK: "network",
  ADVANCED: "advanced"
} as const;

type TabName = (typeof TAB)[keyof typeof TAB];

// Test values
const TEST_KIND = "linux";
const TEST_USER = "testuser";
const TEST_TOPOLOGY = "simple.clab.yml";
const SEL_KIND_FIELD = "#node-kind";

/**
 * Click a node to open the editor in the ContextPanel (MUI design)
 */
async function clickNode(page: Page, nodeId: string): Promise<void> {
  const nodeHandle = page.locator(`[data-id="${nodeId}"]`);
  await nodeHandle.scrollIntoViewIfNeeded();
  await expect(nodeHandle).toBeVisible({ timeout: 3000 });
  const box = await nodeHandle.boundingBox();
  if (!box) throw new Error(`Node ${nodeId} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
}

/**
 * Wait for the node editor to appear in the ContextPanel
 */
async function waitForNodeEditor(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="panel-tab-basic"]')).toBeVisible({ timeout: 3000 });
}

/**
 * Navigate to a specific tab in the node editor
 */
async function navigateToTab(page: Page, tabName: TabName): Promise<void> {
  const tab = page.locator(`[data-testid="panel-tab-${tabName}"]`);
  await expect(tab).toBeVisible({ timeout: 2000 });
  await tab.click();
  await page.waitForTimeout(200);
}

/**
 * Fill an input field and blur to commit
 */
async function fillField(page: Page, fieldId: string, value: string): Promise<void> {
  const field = page.locator(`#${fieldId}`);
  await field.clear();
  await field.fill(value);
  await field.blur();
  await page.waitForTimeout(200);
}

async function selectMuiOption(page: Page, fieldId: string, optionName: string): Promise<void> {
  const select = page.locator(`#${fieldId}`);
  await expect(select).toBeVisible({ timeout: 3000 });
  await select.scrollIntoViewIfNeeded();
  await select.click();

  let listbox = page.locator('[role="listbox"]:visible').last();
  const menuOpened = await listbox.isVisible().catch(() => false);
  if (!menuOpened) {
    // Fallback: MUI Select can occasionally focus without opening on click in headless runs.
    await select.focus();
    await select.press("ArrowDown");
    listbox = page.locator('[role="listbox"]:visible').last();
  }

  await expect(listbox).toBeVisible({ timeout: 3000 });
  const option = listbox.getByRole("option", { name: optionName }).first();
  await expect(option).toBeVisible({ timeout: 3000 });
  await option.click();
  await page.waitForTimeout(200);
}

/**
 * Check a checkbox
 */
async function setCheckbox(page: Page, fieldId: string, checked: boolean): Promise<void> {
  const checkbox = page.locator(`#${fieldId}`);
  await expect(checkbox).toBeVisible({ timeout: 3000 });
  await checkbox.scrollIntoViewIfNeeded();
  if (checked) {
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    return;
  }

  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
}

/**
 * Open node editor by clicking the node
 */
async function openNodeEditor(page: Page, nodeId: string): Promise<void> {
  await clickNode(page, nodeId);
  await waitForNodeEditor(page);
}

async function returnToPalette(page: Page): Promise<void> {
  const search = page.getByPlaceholder("Search nodes...");
  if (await search.isVisible().catch(() => false)) return;

  const toggle = page.locator(SEL_TOGGLE_BTN);
  await expect(toggle).toBeVisible({ timeout: 3000 });
  await toggle.click();
  await page.waitForTimeout(200);
  await toggle.click();
  await expect(search).toBeVisible({ timeout: 5000 });
}

/**
 * Node Editor Persistence E2E Tests (MUI ContextPanel version)
 *
 * Tests that node editor changes are properly saved to YAML
 * and reflected after reopening the editor.
 */
test.describe("Node Editor Persistence", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(TEST_TOPOLOGY);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
  });

  test("kind field persists after applying and reopening editor", async ({
    page,
    topoViewerPage
  }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    expect(nodeIds.length).toBeGreaterThan(0);
    const nodeId = nodeIds[0];

    // Open editor and change kind
    await openNodeEditor(page, nodeId);
    await navigateToTab(page, TAB.BASIC);
    await fillField(page, "node-kind", TEST_KIND);

    // Click Apply
    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(async () => topoViewerPage.getYamlFromFile(TEST_TOPOLOGY), { timeout: 5000 })
      .toContain(`kind: ${TEST_KIND}`);

    // Close editor
    await returnToPalette(page);

    // Reopen editor
    await openNodeEditor(page, nodeId);
    await navigateToTab(page, TAB.BASIC);

    // Verify kind is still set
    await expect(page.locator(SEL_KIND_FIELD)).toHaveValue(TEST_KIND);
  });

  test("node label position and direction persist to annotations", async ({
    page,
    topoViewerPage
  }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    expect(nodeIds.length).toBeGreaterThan(0);
    const nodeId = nodeIds[0];

    await openNodeEditor(page, nodeId);
    await navigateToTab(page, TAB.BASIC);

    const labelPosition = page.locator("#node-label-position");
    const direction = page.locator("#node-direction");
    const transparent = page.locator("#node-label-bg-transparent");

    const currentLabelPositionText = await labelPosition.innerText();
    const currentDirectionText = await direction.innerText();
    const currentTransparent = await transparent.isChecked();

    const targetLabelPosition = currentLabelPositionText.includes("Top") ? "Bottom" : "Top";
    const targetDirection = currentDirectionText.includes("Rotate text 90deg")
      ? "Horizontal"
      : "Rotate text 90deg";
    const targetTransparent = !currentTransparent;

    await selectMuiOption(page, "node-label-position", targetLabelPosition);
    await selectMuiOption(page, "node-direction", targetDirection);
    await setCheckbox(page, "node-label-bg-transparent", targetTransparent);

    // Apply is shown only when the editor is dirty. Label defaults can already match
    // across runs, so force a guaranteed non-label edit as the dirty trigger.
    const kindField = page.locator("#node-kind");
    const currentKind = await kindField.inputValue();
    await fillField(page, "node-kind", `${currentKind}-dirty`);

    await expect(page.locator(SEL_APPLY_BTN)).toBeVisible({ timeout: 3000 });
    await page.locator(SEL_APPLY_BTN).click();

    const expectedDirection = targetDirection === "Horizontal" ? "right" : "down";
    await expect
      .poll(
        async () => {
          const annotations = await topoViewerPage.getAnnotationsFromFile(TEST_TOPOLOGY);
          const nodeAnnotation = annotations.nodeAnnotations?.find((entry) => entry.id === nodeId);
          return {
            labelPosition: nodeAnnotation?.labelPosition ?? "",
            direction: nodeAnnotation?.direction ?? "",
            transparent: (nodeAnnotation?.labelBackgroundColor ?? "").toLowerCase() === "transparent"
          };
        },
        { timeout: 5000 }
      )
      .toEqual({
        labelPosition: targetLabelPosition.toLowerCase(),
        direction: expectedDirection,
        transparent: targetTransparent
      });

    await returnToPalette(page);
    await openNodeEditor(page, nodeId);
    await navigateToTab(page, TAB.BASIC);

    await expect(labelPosition).toContainText(targetLabelPosition);
    await expect(direction).toContainText(targetDirection);
    if (targetTransparent) {
      await expect(transparent).toBeChecked();
    } else {
      await expect(transparent).not.toBeChecked();
    }
  });

  test("startup-config field persists to YAML", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    const nodeId = nodeIds[0];

    await openNodeEditor(page, nodeId);
    await navigateToTab(page, TAB.CONFIG);
    await fillField(page, "node-startup-config", "/path/to/config.txt");

    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(async () => topoViewerPage.getYamlFromFile(TEST_TOPOLOGY), { timeout: 5000 })
      .toContain("startup-config: /path/to/config.txt");
  });

  test("user field persists to YAML", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    const nodeId = nodeIds[0];

    await openNodeEditor(page, nodeId);
    await navigateToTab(page, TAB.RUNTIME);
    await fillField(page, "node-user", TEST_USER);

    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(async () => topoViewerPage.getYamlFromFile(TEST_TOPOLOGY), { timeout: 5000 })
      .toContain(`user: ${TEST_USER}`);
  });

  test("multiple fields persist after save", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    const nodeId = nodeIds[0];

    await openNodeEditor(page, nodeId);

    // Set multiple fields across tabs
    await navigateToTab(page, TAB.BASIC);
    await fillField(page, "node-kind", TEST_KIND);
    await fillField(page, "node-image", "alpine:latest");

    await navigateToTab(page, TAB.RUNTIME);
    await fillField(page, "node-user", "root");

    await navigateToTab(page, TAB.NETWORK);
    await fillField(page, "node-mgmt-ipv4", "172.20.20.10");

    await navigateToTab(page, TAB.ADVANCED);
    await fillField(page, "node-memory", "512m");

    // Click Apply
    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(async () => {
        const yaml = await topoViewerPage.getYamlFromFile(TEST_TOPOLOGY);
        return (
          yaml.includes(`kind: ${TEST_KIND}`) &&
          yaml.includes("image: alpine:latest") &&
          yaml.includes("user: root") &&
          yaml.includes("mgmt-ipv4: 172.20.20.10") &&
          yaml.includes("memory: 512m")
        );
      }, { timeout: 5000 })
      .toBe(true);

    // Close and reopen editor to verify all fields
    await returnToPalette(page);
    await openNodeEditor(page, nodeId);

    await navigateToTab(page, TAB.BASIC);
    await expect(page.locator(SEL_KIND_FIELD)).toHaveValue(TEST_KIND);
    await expect(page.locator("#node-image")).toHaveValue("alpine:latest");

    await navigateToTab(page, TAB.RUNTIME);
    await expect(page.locator("#node-user")).toHaveValue("root");

    await navigateToTab(page, TAB.NETWORK);
    await expect(page.locator("#node-mgmt-ipv4")).toHaveValue("172.20.20.10");

    await navigateToTab(page, TAB.ADVANCED);
    await expect(page.locator("#node-memory")).toHaveValue("512m");
  });

  test("enforce-startup-config radio persists", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    const nodeId = nodeIds[0];

    await openNodeEditor(page, nodeId);
    await navigateToTab(page, TAB.CONFIG);

    // Startup config mode is now a select field.
    await selectMuiOption(page, "node-startup-config-mode", "Enforce startup config");
    await page.waitForTimeout(200);

    await page.locator(SEL_APPLY_BTN).click();
    await page.waitForTimeout(500);

    await returnToPalette(page);

    // Reopen and verify
    await openNodeEditor(page, nodeId);
    await navigateToTab(page, TAB.CONFIG);
    await expect(page.locator("#node-startup-config-mode")).toContainText("Enforce startup config");

    const yamlContent = await topoViewerPage.getYamlFromFile(TEST_TOPOLOGY);
    expect(yamlContent).toContain("enforce-startup-config: true");
  });

  test("restart-policy persists to YAML", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    expect(nodeIds.length).toBeGreaterThan(0);
    const nodeId = nodeIds[0];

    await openNodeEditor(page, nodeId);
    await navigateToTab(page, TAB.RUNTIME);

    await selectMuiOption(page, "node-restart-policy", "Always");

    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(
        async () => {
          const yaml = await topoViewerPage.getYamlFromFile(TEST_TOPOLOGY);
          const parsed = YAML.parse(yaml);
          return parsed?.topology?.nodes?.[nodeId]?.["restart-policy"] ?? null;
        },
        { timeout: 5000 }
      )
      .toBe("always");
  });

  test("network-mode persists to YAML", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    expect(nodeIds.length).toBeGreaterThan(0);
    const nodeId = nodeIds[0];

    await openNodeEditor(page, nodeId);
    await navigateToTab(page, TAB.NETWORK);

    await selectMuiOption(page, "node-network-mode", "Host");

    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(async () => topoViewerPage.getYamlFromFile(TEST_TOPOLOGY), { timeout: 5000 })
      .toContain("network-mode: host");
  });

  test("image-pull-policy persists to YAML", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    expect(nodeIds.length).toBeGreaterThan(0);
    const nodeId = nodeIds[0];

    await openNodeEditor(page, nodeId);
    await navigateToTab(page, TAB.ADVANCED);

    await selectMuiOption(page, "node-image-pull-policy", "Always");

    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(async () => topoViewerPage.getYamlFromFile(TEST_TOPOLOGY), { timeout: 5000 })
      .toContain("image-pull-policy: Always");
  });

  test("values persist after page reload", async ({ page, topoViewerPage }) => {
    const nodeIds = await topoViewerPage.getNodeIds();
    const nodeId = nodeIds[0];

    await openNodeEditor(page, nodeId);

    await navigateToTab(page, TAB.BASIC);
    await fillField(page, "node-kind", TEST_KIND);

    await navigateToTab(page, TAB.RUNTIME);
    await fillField(page, "node-user", "admin");

    // Click Apply and close
    await page.locator(SEL_APPLY_BTN).click();
    await page.waitForTimeout(500);
    await returnToPalette(page);

    // Reload the page
    await topoViewerPage.gotoFile(TEST_TOPOLOGY);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
    await page.waitForTimeout(500);

    // Verify node still exists
    const newNodeIds = await topoViewerPage.getNodeIds();
    expect(newNodeIds).toContain(nodeId);

    // Open editor and verify fields persisted
    await openNodeEditor(page, nodeId);

    await navigateToTab(page, TAB.BASIC);
    await expect(page.locator(SEL_KIND_FIELD)).toHaveValue(TEST_KIND);

    await navigateToTab(page, TAB.RUNTIME);
    await expect(page.locator("#node-user")).toHaveValue("admin");
  });
});

/** Load a topology from YAML text and open the editor of one node */
async function openNodeFromYaml(
  page: Page,
  topoViewerPage: {
    writeYamlFile: (file: string, content: string) => Promise<void>;
    gotoFile: (file: string) => Promise<void>;
    waitForCanvasReady: () => Promise<void>;
    setEditMode: () => Promise<void>;
    unlock: () => Promise<void>;
    fit: () => Promise<void>;
  },
  yaml: string,
  nodeId: string
): Promise<void> {
  await topoViewerPage.writeYamlFile(TEST_TOPOLOGY, yaml);
  await topoViewerPage.gotoFile(TEST_TOPOLOGY);
  await topoViewerPage.waitForCanvasReady();
  await topoViewerPage.setEditMode();
  await topoViewerPage.unlock();
  await topoViewerPage.fit();
  await openNodeEditor(page, nodeId);
}

async function readNode(
  topoViewerPage: { getYamlFromFile: (file: string) => Promise<string> },
  nodeId: string
): Promise<Record<string, unknown> | null> {
  const parsed = YAML.parse(await topoViewerPage.getYamlFromFile(TEST_TOPOLOGY)) as {
    topology?: { nodes?: Record<string, Record<string, unknown>> };
  } | null;
  return parsed?.topology?.nodes?.[nodeId] ?? null;
}

const NODE_SHAPES_YAML = `name: simple
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux:latest
      network-mode: container:srl2
      image-pull-policy: IfNotPresent
      restart-policy: Always
      runtime: podman
      auto-remove: false
      startup-delay: 0
      env:
        COUNT: 3
        ENABLED: true
      sysctls:
        net.ipv4.ip_forward: 1
      dns:
        servers:
          - 1.1.1.1
        search:
          - example.com
      certificate:
        issue: true
        key-size: 4096
        sans:
          - srl1.lab
      healthcheck:
        test:
          - CMD-SHELL
          - cat /etc/os-release
        retries: 3
      components:
        - slot: 1
          type: imm36-800g-qsfpdd
    srl2:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux:latest
  links:
    - endpoints: ["srl1:e1-1", "srl2:e1-1"]
`;

/**
 * Dropdowns only offer values containerlab accepts, and existing values in the
 * YAML show up in them.
 */
test.describe("Node Editor Dropdown Values", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
  });

  test("existing values load into the dropdowns", async ({ page, topoViewerPage }) => {
    await openNodeFromYaml(page, topoViewerPage, NODE_SHAPES_YAML, "srl1");

    await navigateToTab(page, TAB.NETWORK);
    await expect(page.locator("#node-network-mode")).toContainText("Container");
    await expect(page.locator("#node-network-mode-container")).toHaveValue("srl2");

    await navigateToTab(page, TAB.RUNTIME);
    await expect(page.locator("#node-restart-policy")).toContainText("Always");

    await navigateToTab(page, TAB.ADVANCED);
    await expect(page.locator("#node-image-pull-policy")).toContainText("If Not Present");
    await expect(page.locator("#node-runtime")).toContainText("podman");
    await expect(page.locator("#node-cert-key-size")).toContainText("4096");
  });

  test("runtime offers only docker and podman", async ({ page, topoViewerPage }) => {
    await topoViewerPage.gotoFile(TEST_TOPOLOGY);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
    await openNodeEditor(page, "srl1");
    await navigateToTab(page, TAB.ADVANCED);

    const select = page.locator("#node-runtime");
    await select.scrollIntoViewIfNeeded();
    await select.click();
    const listbox = page.locator('[role="listbox"]:visible').last();
    await expect(listbox.getByRole("option")).toHaveText(["Default", "docker", "podman"]);
    await listbox.getByRole("option", { name: "podman" }).click();

    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(async () => (await readNode(topoViewerPage, "srl1"))?.runtime ?? null, {
        timeout: 5000
      })
      .toBe("podman");
  });

  test("container network mode writes container:<node>", async ({ page, topoViewerPage }) => {
    await topoViewerPage.gotoFile(TEST_TOPOLOGY);
    await topoViewerPage.waitForCanvasReady();
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await topoViewerPage.fit();
    await openNodeEditor(page, "srl1");
    await navigateToTab(page, TAB.NETWORK);

    await selectMuiOption(page, "node-network-mode", "Container");
    const target = page.locator("#node-network-mode-container");
    await expect(target).toBeVisible();
    await target.click();
    await page.getByRole("option", { name: "srl2", exact: true }).click();

    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(async () => (await readNode(topoViewerPage, "srl1"))?.["network-mode"] ?? null, {
        timeout: 5000
      })
      .toBe("container:srl2");
  });

  test("editing one field keeps every other value and its shape", async ({
    page,
    topoViewerPage
  }) => {
    await openNodeFromYaml(page, topoViewerPage, NODE_SHAPES_YAML, "srl1");
    const before = YAML.parse(NODE_SHAPES_YAML) as {
      topology: { nodes: Record<string, Record<string, unknown>> };
    };

    await navigateToTab(page, TAB.RUNTIME);
    await fillField(page, "node-user", TEST_USER);
    await page.locator(SEL_APPLY_BTN).click();

    await expect
      .poll(async () => readNode(topoViewerPage, "srl1"), { timeout: 5000 })
      .toEqual({ ...before.topology.nodes.srl1, user: TEST_USER });
  });

  test("dns search and healthcheck test are written as lists", async ({
    page,
    topoViewerPage
  }) => {
    await openNodeFromYaml(page, topoViewerPage, NODE_SHAPES_YAML, "srl1");

    await navigateToTab(page, TAB.NETWORK);
    const searchSection = page.getByText("DNS Search Domains", { exact: true }).locator("..");
    await searchSection.getByRole("button", { name: "Add" }).click();
    const searchInputs = page.getByPlaceholder("e.g., example.com");
    await searchInputs.last().fill("lab.local");

    await navigateToTab(page, TAB.ADVANCED);
    const testSection = page.getByText("Health Check Test", { exact: true }).locator("..");
    await testSection.getByRole("button", { name: "Add" }).click();
    await page.getByPlaceholder("e.g., cat /etc/os-release").last().fill("-q");

    await page.locator(SEL_APPLY_BTN).click();
    await expect
      .poll(async () => readNode(topoViewerPage, "srl1"), { timeout: 5000 })
      .toMatchObject({
        dns: { servers: ["1.1.1.1"], search: ["example.com", "lab.local"] },
        healthcheck: { test: ["CMD-SHELL", "cat /etc/os-release", "-q"], retries: 3 }
      });
  });
});
