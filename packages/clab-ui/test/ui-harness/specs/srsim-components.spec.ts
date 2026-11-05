import type { Page } from "@playwright/test";
import * as YAML from "yaml";

import { test, expect } from "../fixtures/topoviewer";

const FILE = "simple.clab.yml";
const IMAGE = "registry.srlinux.dev/pub/nokia_srsim:26.3.R1";
const SEL_APPLY_BTN = '[data-testid="panel-apply-btn"]';
const SEL_COMPONENTS_TAB = '[data-testid="panel-tab-components"]';
const KIND_SRSIM = "nokia_srsim";
const SLOT_A = "chassis-slot-A";
const SLOT_1 = "chassis-slot-1";
const SLOT_3 = "chassis-slot-3";

interface HarnessPage {
  resetFiles: () => Promise<void>;
  writeYamlFile: (file: string, content: string) => Promise<void>;
  gotoFile: (file: string) => Promise<void>;
  waitForCanvasReady: () => Promise<void>;
  setEditMode: () => Promise<void>;
  unlock: () => Promise<void>;
  lock: () => Promise<void>;
  fit: () => Promise<void>;
  getYamlFromFile: (file: string) => Promise<string>;
}

function topology(node: Record<string, unknown>): string {
  return YAML.stringify({
    name: "simple",
    topology: {
      nodes: { router: node, peer: { kind: "linux", image: "alpine:3" } },
      links: [{ endpoints: ["router:e1-1", "peer:eth1"] }]
    }
  });
}

async function openComponents(
  page: Page,
  topoViewerPage: HarnessPage,
  node: Record<string, unknown>
): Promise<void> {
  await topoViewerPage.resetFiles();
  await topoViewerPage.writeYamlFile(FILE, topology(node));
  await topoViewerPage.gotoFile(FILE);
  await topoViewerPage.waitForCanvasReady();
  await topoViewerPage.setEditMode();
  await topoViewerPage.unlock();
  await topoViewerPage.fit();

  const handle = page.locator('[data-id="router"]');
  await expect(handle).toBeVisible({ timeout: 3000 });
  const box = await handle.boundingBox();
  if (!box) throw new Error("router has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator(SEL_COMPONENTS_TAB).click();
  await expect(page.getByTestId("components-tab")).toBeVisible();
}

async function readRouter(topoViewerPage: HarnessPage): Promise<Record<string, unknown>> {
  const parsed = YAML.parse(await topoViewerPage.getYamlFromFile(FILE)) as {
    topology: { nodes: Record<string, Record<string, unknown>> };
  };
  return parsed.topology.nodes.router;
}

async function expectSaved(
  page: Page,
  topoViewerPage: HarnessPage,
  expected: Record<string, unknown>
): Promise<void> {
  await page.locator(SEL_APPLY_BTN).click();
  await expect.poll(async () => readRouter(topoViewerPage)).toEqual(expected);
}

async function optionsOf(page: Page, fieldId: string): Promise<string[]> {
  await page.locator(`#${fieldId}`).click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const options = await listbox.getByRole("option").allTextContents();
  await page.keyboard.press("Escape");
  return options;
}

test.describe("SR-SIM chassis builder", () => {
  test("offers only the hardware the chassis takes", async ({ page, topoViewerPage }) => {
    await openComponents(page, topoViewerPage, {
      kind: KIND_SRSIM,
      type: "sr-7",
      image: IMAGE,
      components: [{ slot: 1, type: "iom5-e" }]
    });

    await expect(page.getByTestId("chassis-name")).toHaveText("SR-7");
    await expect(page.locator('[data-testid^="chassis-slot-"]')).toHaveCount(8);

    expect(await optionsOf(page, "slot-1-type")).toEqual([
      "iom5-e",
      "imm-2pac-fp3",
      "imm48-1gb-sfp-c",
      "iom4-e",
      "iom4-e-b",
      "iom4-e-hs"
    ]);

    await page.getByRole("button", { name: "Add MDA" }).click();
    await expect(page.locator("#slot-1-mda-0-type")).toHaveValue("me6-100gb-qsfp28");
    expect(await optionsOf(page, "slot-1-mda-0-type")).toEqual(["me6-100gb-qsfp28"]);
    await expect(page.getByRole("button", { name: "Add XIOM" })).toHaveCount(0);
  });

  test("builds a chassis from the starter and writes it to the node", async ({ page, topoViewerPage }) => {
    await openComponents(page, topoViewerPage, { kind: KIND_SRSIM, type: "sr-7", image: IMAGE });

    await page.getByTestId("chassis-starter").click();
    await expect(page.getByTestId("chassis-status")).toHaveText("Fits SR-7");
    await expect(page.getByTestId("chassis-starter")).toHaveCount(0);

    await expectSaved(page, topoViewerPage, {
      kind: KIND_SRSIM,
      type: "sr-7",
      image: IMAGE,
      sfm: "m-sfm6-7/12",
      components: [
        { slot: "A", type: "cpm5" },
        { slot: 1, type: "iom5-e", mda: [{ slot: 1, type: "me6-100gb-qsfp28" }] }
      ]
    });
  });

  test("installs, copies, moves and removes cards", async ({ page, topoViewerPage }) => {
    await openComponents(page, topoViewerPage, {
      kind: KIND_SRSIM,
      type: "sr-7",
      image: IMAGE,
      components: [
        { slot: "A", type: "cpm5" },
        { slot: 1, type: "iom4-e", env: { KEEP: "me" }, mda: [{ slot: 1, type: "me6-100gb-qsfp28" }] }
      ]
    });

    // Another CPM follows the one already there
    await page.getByTestId("chassis-slot-B").click();
    await expect(page.getByTestId("chassis-slot-B")).toContainText("cpm5");

    // A copy keeps everything on the card, including keys the form does not show
    await page.getByTestId(SLOT_1).click();
    await page.getByRole("button", { name: "Copy to the next free slot" }).click();
    await expect(page.getByTestId("chassis-slot-2")).toContainText("iom4-e");

    // Moving the copy frees its slot and follows it
    await page.locator("#slot-2-position").click();
    await page.getByRole("option", { name: "4", exact: true }).click();
    await expect(page.getByTestId("chassis-slot-4")).toHaveAttribute("aria-pressed", "true");

    // A new card takes its neighbor's type
    await page.getByTestId(SLOT_3).click();
    await expect(page.getByTestId(SLOT_3)).toContainText("iom4-e");
    await page.getByRole("button", { name: "Remove from chassis" }).click();
    await expect(page.getByTestId(SLOT_3)).toContainText("Install");

    const card = { type: "iom4-e", env: { KEEP: "me" }, mda: [{ slot: 1, type: "me6-100gb-qsfp28" }] };
    await expectSaved(page, topoViewerPage, {
      kind: KIND_SRSIM,
      type: "sr-7",
      image: IMAGE,
      components: [
        { slot: "A", type: "cpm5" },
        { slot: "B", type: "cpm5" },
        { slot: 1, ...card },
        { slot: 4, ...card }
      ]
    });
  });

  test("flags what does not fit a new chassis and fixes it in one go", async ({ page, topoViewerPage }) => {
    await openComponents(page, topoViewerPage, {
      kind: KIND_SRSIM,
      type: "sr-7s",
      image: IMAGE,
      sfm: "sfm-s",
      components: [
        { slot: "A", type: "cpm2-s" },
        {
          slot: 1,
          type: "xcm-7s",
          xiom: [{ slot: 1, type: "iom-s-1.5t", mda: [{ slot: 1, type: "ms2-400gb-qsfpdd+2-100gb-qsfp28" }] }]
        },
        { slot: 6, type: "xcm-7s" }
      ]
    });
    await expect(page.getByTestId("chassis-status")).toHaveAttribute("data-status", "ok");

    const chassis = page.locator("#node-chassis");
    await chassis.clear();
    await chassis.fill("sr-2s");
    await page.getByRole("option", { name: /^sr-2s / }).click();

    // The chassis redraws around what the node holds, and marks what no longer fits
    const status = page.getByTestId("chassis-status");
    await expect(status).toHaveAttribute("data-status", "issues");
    await expect(page.getByTestId("chassis-slot-2")).toContainText("Install");
    await expect(page.getByTestId(SLOT_3)).toHaveCount(0);
    await expect(page.getByTestId("chassis-slot-6")).toContainText("xcm-7s");
    await expect(page.getByTestId("chassis-frame")).toContainText("1 of 2");
    await expect(page.locator("#slot-1-type")).toHaveValue("xcm-7s");
    await expect(page.locator("#slot-1-type-helper-text")).toHaveText("xcm-7s is not listed for SR-2s");

    // A value the chassis does not list still opens on what it does
    expect(await optionsOf(page, "slot-1-type")).toEqual(["xcm-2s"]);

    await page.getByTestId("chassis-fit").click();
    await expect(status).toHaveAttribute("data-status", "ok");
    await expect(page.getByTestId("chassis-slot-6")).toHaveCount(0);

    await expectSaved(page, topoViewerPage, {
      kind: KIND_SRSIM,
      type: "sr-2s",
      image: IMAGE,
      sfm: "sfm-2s",
      components: [
        { slot: "A", type: "cpm-2s" },
        {
          slot: 1,
          type: "xcm-2s",
          xiom: [{ slot: 1, type: "iom-s-3.0t", mda: [{ slot: 1, type: "ms2-400gb-qsfpdd+2-100gb-qsfp28" }] }]
        }
      ]
    });
  });

  test("keeps a type the catalog does not list when it is typed on purpose", async ({ page, topoViewerPage }) => {
    await openComponents(page, topoViewerPage, {
      kind: KIND_SRSIM,
      type: "sr-7",
      image: IMAGE,
      components: [{ slot: "A", type: "cpm5" }, { slot: 1, type: "iom5-e" }]
    });

    await page.locator("#slot-1-type").fill("iom-from-the-future");
    await expect(page.getByTestId("chassis-status")).toContainText(
      "Slot 1: iom-from-the-future is not listed for SR-7"
    );

    await expectSaved(page, topoViewerPage, {
      kind: KIND_SRSIM,
      type: "sr-7",
      image: IMAGE,
      components: [{ slot: "A", type: "cpm5" }, { slot: 1, type: "iom-from-the-future" }]
    });
  });

  test("overrides an integrated chassis without touching what is fixed", async ({ page, topoViewerPage }) => {
    await openComponents(page, topoViewerPage, { kind: KIND_SRSIM, type: "sar-hx", image: IMAGE });

    await expect(page.locator('[data-testid^="chassis-slot-"]')).toHaveCount(0);
    await expect(page.getByTestId("fixed-mda-2")).toContainText("m4-1g-rj+6-10g-sfp++2-25g-sfp28");
    await expect(page.getByTestId("fixed-mda-3")).toContainText("isa-ms-v");

    await page.getByRole("button", { name: "Add MDA" }).click();
    await expect(page.locator("#slot-A-mda-0-slot")).toHaveValue("1");
    await expect(page.locator("#slot-A-mda-0-type")).toHaveValue("m2-1g-sfp+2-10g-sfp+");

    await expectSaved(page, topoViewerPage, {
      kind: KIND_SRSIM,
      type: "sar-hx",
      image: IMAGE,
      components: [{ mda: [{ slot: 1, type: "m2-1g-sfp+2-10g-sfp+" }] }]
    });

    await page.getByRole("button", { name: "Reset to defaults" }).click();
    await expectSaved(page, topoViewerPage, { kind: KIND_SRSIM, type: "sar-hx", image: IMAGE });
  });

  test("names both slots when an integrated chassis gets a second CPM", async ({ page, topoViewerPage }) => {
    await openComponents(page, topoViewerPage, {
      kind: KIND_SRSIM,
      type: "ixr-r6",
      image: IMAGE,
      components: [{ mda: [{ slot: 1, type: "m6-10g-sfp++1-100g-qsfp28" }] }]
    });

    await page.getByTestId("chassis-slot-B").click();

    await expectSaved(page, topoViewerPage, {
      kind: KIND_SRSIM,
      type: "ixr-r6",
      image: IMAGE,
      components: [{ slot: "A", mda: [{ slot: 1, type: "m6-10g-sfp++1-100g-qsfp28" }] }, { slot: "B" }]
    });
  });

  test("shows fixed hardware with nothing to install", async ({ page, topoViewerPage }) => {
    await openComponents(page, topoViewerPage, { kind: KIND_SRSIM, type: "ixr-e2n", image: IMAGE });

    await expect(page.getByTestId("chassis-frame")).toContainText("cpm-ixr-e2n");
    await expect(page.getByTestId("chassis-frame")).toContainText("imm4-sfp+4-sfp+");
    await expect(page.locator('[data-testid^="chassis-slot-"]')).toHaveCount(0);
    await expect(page.getByTestId("chassis-starter")).toHaveCount(0);
    await expect(page.getByTestId("chassis-status")).toHaveCount(0);
  });

  test("lays everything out while the lab is locked", async ({ page, topoViewerPage }) => {
    await openComponents(page, topoViewerPage, {
      kind: KIND_SRSIM,
      type: "sr-7",
      image: IMAGE,
      sfm: "m-sfm6-7/12",
      components: [{ slot: "A", type: "cpm5" }, { slot: 1, type: "iom5-e" }, { slot: 2, type: "iom4-e" }]
    });

    await topoViewerPage.lock();

    await expect(page.getByTestId("slot-inspector")).toHaveCount(3);
    await expect(page.getByTestId("sfm-inspector")).toBeVisible();
    await expect(page.getByTestId(SLOT_3)).toContainText("Empty");
    await expect(page.getByTestId(SLOT_1)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("chassis-starter")).toHaveCount(0);
  });

  test("leaves an unknown type open, and keeps nokia_sros VM resources", async ({ page, topoViewerPage }) => {
    await openComponents(page, topoViewerPage, {
      kind: KIND_SRSIM,
      type: "ixr-e2sc",
      image: IMAGE,
      components: [{ slot: 1, type: "any-card" }]
    });
    await expect(page.getByTestId("chassis-notes")).toContainText("not in the hardware list");
    await expect(page.getByTestId("chassis-status")).toHaveCount(0);
    expect((await optionsOf(page, "slot-1-type")).length).toBeGreaterThan(10);
    await page.getByTestId("chassis-slot-2").click();
    await expect(page.getByTestId("chassis-slot-3")).toBeVisible();

    await openComponents(page, topoViewerPage, {
      kind: "nokia_sros",
      type: "sr-7",
      image: "vrnetlab/nokia_sros:25.10",
      components: [{ slot: 1, type: "iom5-e", cpu: 2 }]
    });
    await expect(page.locator("#slot-1-cpu")).toHaveValue("2");
    await page.locator("#slot-1-ram").fill("8");

    await expectSaved(page, topoViewerPage, {
      kind: "nokia_sros",
      type: "sr-7",
      image: "vrnetlab/nokia_sros:25.10",
      components: [{ slot: 1, type: "iom5-e", cpu: 2, ram: 8 }]
    });
    await expect(page.getByTestId(SLOT_A)).toContainText("Install");
  });
});
