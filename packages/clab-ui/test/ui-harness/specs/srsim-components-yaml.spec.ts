/**
 * The SR-SIM chassis builder and the topology file: what it reads from YAML, how it
 * follows edits made outside the form, and what it leaves alone when saving.
 */
import type { Page } from "@playwright/test";
import * as YAML from "yaml";

import { test, expect } from "../fixtures/topoviewer";

const FILE = "simple.clab.yml";
const IMAGE = "registry.srlinux.dev/pub/nokia_srsim:26.3.R1";
const SEL_APPLY_BTN = '[data-testid="panel-apply-btn"]';
const SEL_COMPONENTS_TAB = '[data-testid="panel-tab-components"]';
const KIND_SRSIM = "nokia_srsim";
const SLOT_1 = "chassis-slot-1";
const SLOT_2 = "chassis-slot-2";
const SLOT_3 = "chassis-slot-3";
const TOGGLE_2 = "chassis-toggle-2";
const NAME = "chassis-name";
const STATUS = "chassis-status";
const CARD_TYPE = "#slot-1-type";

interface HarnessPage {
  resetFiles: () => Promise<void>;
  writeYamlFile: (file: string, content: string) => Promise<void>;
  gotoFile: (file: string) => Promise<void>;
  waitForCanvasReady: () => Promise<void>;
  setEditMode: () => Promise<void>;
  unlock: () => Promise<void>;
  fit: () => Promise<void>;
  getYamlFromFile: (file: string) => Promise<string>;
}

function fileWith(router: Record<string, unknown>, extraTopology: Record<string, unknown> = {}): string {
  return YAML.stringify({
    name: "simple",
    topology: {
      ...extraTopology,
      nodes: { router, peer: { kind: "linux", image: "alpine:3" } },
      links: [{ endpoints: ["router:e1-1", "peer:eth1"] }]
    }
  });
}

async function openRaw(page: Page, topoViewerPage: HarnessPage, yaml: string): Promise<void> {
  await topoViewerPage.resetFiles();
  await topoViewerPage.writeYamlFile(FILE, yaml);
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

const SR7 = { kind: KIND_SRSIM, type: "sr-7", image: IMAGE };

/** A ${NAME} reference, as containerlab expands it before reading the file */
function variable(name: string): string {
  return `\${${name}}`;
}

test.describe("SR-SIM chassis builder and the YAML", () => {
  test.describe("follows outside edits while open", () => {
    test("picks up cards, types and the SFM without reopening", async ({ page, topoViewerPage }) => {
      const components = [{ slot: "A", type: "cpm5" }, { slot: 1, type: "iom5-e" }];
      await openRaw(page, topoViewerPage, fileWith({ ...SR7, components }));
      await expect(page.locator(CARD_TYPE)).toHaveValue("iom5-e");

      await topoViewerPage.writeYamlFile(
        FILE,
        fileWith({
          ...SR7,
          sfm: "m-sfm5-7",
          components: [
            { slot: "A", type: "cpm5" },
            { slot: "B", type: "cpm5" },
            { slot: 1, type: "iom4-e", mda: [{ slot: 1, type: "me6-100gb-qsfp28" }] },
            { slot: 3, type: "iom5-e" }
          ]
        })
      );

      await expect(page.locator("#slot-3-type")).toHaveValue("iom5-e");
      await expect(page.locator("#slot-B-type")).toHaveValue("cpm5");
      await expect(page.locator("#sfm-type")).toHaveValue("m-sfm5-7");
      await expect(page.getByTestId(SLOT_1)).toContainText("1 MDA");
      await expect(page.locator(CARD_TYPE)).toHaveValue("iom4-e");
      await expect(page.locator("#slot-1-mda-0-type")).toHaveValue("me6-100gb-qsfp28");
      await expect(page.locator(SEL_APPLY_BTN)).toHaveCount(0);
    });

    test("redraws the chassis when the YAML changes its type", async ({ page, topoViewerPage }) => {
      const components = [{ slot: "A", type: "cpm5" }, { slot: 1, type: "iom5-e" }];
      await openRaw(page, topoViewerPage, fileWith({ ...SR7, components }));
      await expect(page.getByTestId(NAME)).toHaveText("SR-7");

      await topoViewerPage.writeYamlFile(FILE, fileWith({ ...SR7, type: "sr-14s", components }));

      await expect(page.getByTestId(NAME)).toHaveText("SR-14s");
      await expect(page.getByTestId("chassis-slot-6")).toContainText("Install");
      await expect(page.getByTestId(STATUS)).toHaveAttribute("data-status", "issues");
      await expect(page.locator("#node-chassis")).toHaveValue("sr-14s");
    });

    test("moves on when the YAML removes the slot being looked at", async ({ page, topoViewerPage }) => {
      const cpm = { slot: "A", type: "cpm5" };
      await openRaw(
        page,
        topoViewerPage,
        fileWith({ ...SR7, components: [cpm, { slot: 1, type: "iom5-e" }, { slot: 2, type: "iom4-e" }] })
      );
      await page.getByTestId(TOGGLE_2).click();
      await expect(page.locator("#slot-2-type")).toHaveValue("iom4-e");

      await topoViewerPage.writeYamlFile(
        FILE,
        fileWith({ ...SR7, components: [cpm, { slot: 1, type: "iom5-e" }] })
      );

      await expect(page.getByTestId(SLOT_2)).toContainText("Install");
      await expect(page.locator(CARD_TYPE)).toHaveValue("iom5-e");
      await expect(page.locator("#slot-2-type")).toHaveCount(0);

      await topoViewerPage.writeYamlFile(FILE, fileWith(SR7));
      await expect(page.getByTestId("chassis-starter")).toBeVisible();
      await expect(page.locator(CARD_TYPE)).toHaveCount(0);
    });

    test("keeps the slot being looked at when only other things change", async ({ page, topoViewerPage }) => {
      const cards = [{ slot: 1, type: "iom5-e" }, { slot: 2, type: "iom4-e" }];
      await openRaw(page, topoViewerPage, fileWith({ ...SR7, components: cards }));
      await page.getByTestId(TOGGLE_2).click();

      await topoViewerPage.writeYamlFile(
        FILE,
        fileWith({ ...SR7, components: [{ slot: "A", type: "cpm5" }, ...cards] })
      );

      await expect(page.locator("#slot-A-type")).toHaveValue("cpm5");
      await expect(page.getByTestId(TOGGLE_2)).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("#slot-2-type")).toHaveValue("iom4-e");
    });

    test("picks up an outside edit right after Apply", async ({ page, topoViewerPage }) => {
      const cpm = { slot: "A", type: "cpm5" };
      await openRaw(page, topoViewerPage, fileWith({ ...SR7, components: [cpm, { slot: 1, type: "iom5-e" }] }));

      await page.getByTestId(SLOT_2).click();
      await page.locator(SEL_APPLY_BTN).click();
      await expect
        .poll(async () => readRouter(topoViewerPage))
        .toEqual({ ...SR7, components: [cpm, { slot: 1, type: "iom5-e" }, { slot: 2, type: "iom5-e" }] });

      await topoViewerPage.writeYamlFile(
        FILE,
        fileWith({ ...SR7, components: [cpm, { slot: 1, type: "iom4-e" }, { slot: 2, type: "iom5-e" }] })
      );
      await expect(page.locator(CARD_TYPE)).toHaveValue("iom4-e");

      // Applying the same thing twice writes nothing, so nothing echoes back
      await topoViewerPage.writeYamlFile(
        FILE,
        fileWith({ ...SR7, components: [cpm, { slot: 1, type: "iom5-e" }, { slot: 2, type: "iom4-e" }] })
      );
      await expect(page.locator("#slot-2-type")).toHaveValue("iom4-e");
    });

    test("keeps unsaved edits, and saving them leaves other outside edits in place", async ({ page, topoViewerPage }) => {
      const cpm = { slot: "A", type: "cpm5" };
      await openRaw(page, topoViewerPage, fileWith({ ...SR7, components: [cpm, { slot: 1, type: "iom5-e" }] }));

      await page.getByTestId(SLOT_2).click();
      await expect(page.locator("#slot-2-type")).toHaveValue("iom5-e");

      await topoViewerPage.writeYamlFile(
        FILE,
        fileWith({
          ...SR7,
          image: "registry.srlinux.dev/pub/nokia_srsim:25.10.R2",
          components: [cpm, { slot: 1, type: "iom5-e" }]
        })
      );
      // The canvas has picked the file up, and the card being added is still there
      await page.waitForTimeout(800);
      await expect(page.locator("#slot-2-type")).toHaveValue("iom5-e");

      await page.locator(SEL_APPLY_BTN).click();
      await expect
        .poll(async () => readRouter(topoViewerPage))
        .toEqual({
          ...SR7,
          image: "registry.srlinux.dev/pub/nokia_srsim:25.10.R2",
          components: [cpm, { slot: 1, type: "iom5-e" }, { slot: 2, type: "iom5-e" }]
        });
    });

    test("shows the latest file after closing with unsaved edits", async ({ page, topoViewerPage }) => {
      const cpm = { slot: "A", type: "cpm5" };
      await openRaw(page, topoViewerPage, fileWith({ ...SR7, components: [cpm, { slot: 1, type: "iom5-e" }] }));

      await page.getByTestId(SLOT_2).click();
      await topoViewerPage.writeYamlFile(
        FILE,
        fileWith({ ...SR7, components: [cpm, { slot: 1, type: "iom4-e" }, { slot: 5, type: "iom5-e" }] })
      );
      await page.waitForTimeout(800);

      const toggle = page.locator('[data-testid="panel-toggle-btn"]');
      await toggle.click();
      await page.waitForTimeout(200);
      await toggle.click();
      await expect(page.getByPlaceholder("Search nodes…")).toBeVisible({ timeout: 5000 });

      const handle = page.locator('[data-id="router"]');
      const box = await handle.boundingBox();
      if (!box) throw new Error("router has no bounding box");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.locator(SEL_COMPONENTS_TAB).click();

      await expect(page.locator(CARD_TYPE)).toHaveValue("iom4-e");
      await expect(page.locator("#slot-5-type")).toHaveValue("iom5-e");
      await expect(page.getByTestId(SLOT_2)).toContainText("Install");
    });

    test("follows the YAML pane next to it", async ({ page, topoViewerPage }) => {
      const cpm = { slot: "A", type: "cpm5" };
      await openRaw(page, topoViewerPage, fileWith({ ...SR7, components: [cpm, { slot: 1, type: "iom5-e" }] }));

      await page.getByTestId("navbar-split-view").click();
      await page.locator('[data-testid="panel-tab-yaml"]').click();
      await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 15000 });
      await page.waitForFunction(() =>
        Boolean((window as { __clabMonacoDebug?: unknown }).__clabMonacoDebug)
      );
      const edited = fileWith({ ...SR7, components: [cpm, { slot: 1, type: "iom4-e" }, { slot: 4, type: "iom5-e" }] });
      await page.evaluate((content) => {
        (window as unknown as { __clabMonacoDebug: { setValue: (value: string) => void } }).__clabMonacoDebug.setValue(content);
      }, edited);
      await page.getByTitle("Save").click();
      await expect.poll(async () => topoViewerPage.getYamlFromFile(FILE), { timeout: 8000 }).toBe(edited);

      await page.locator('[data-testid="panel-tab-edit"]').click();
      await page.locator(SEL_COMPONENTS_TAB).click();
      await expect(page.locator(CARD_TYPE)).toHaveValue("iom4-e");
      await expect(page.locator("#slot-4-type")).toHaveValue("iom5-e");
    });
  });

  test.describe("reads every shape containerlab accepts", () => {
    test("slots in any case or quoting land where containerlab puts them", async ({ page, topoViewerPage }) => {
      await openRaw(
        page,
        topoViewerPage,
        `name: simple
topology:
  nodes:
    router:
      kind: nokia_srsim
      type: SR-7
      image: ${IMAGE}
      components:
        - slot: a
          type: cpm5
        - slot: "b"
          type: cpm5
        - slot: "2"
          type: iom5-e
    peer:
      kind: linux
      image: alpine:3
  links:
    - endpoints: ["router:e1-1", "peer:eth1"]
`
      );

      await expect(page.getByTestId(NAME)).toHaveText("SR-7");
      await expect(page.locator("#slot-A-type")).toHaveValue("cpm5");
      await expect(page.locator("#slot-B-type")).toHaveValue("cpm5");
      await expect(page.locator("#slot-2-type")).toHaveValue("iom5-e");
      await expect(page.getByTestId(STATUS)).toHaveAttribute("data-status", "ok");
    });

    test("reads a hand-written distributed chassis, with an SFM per component from older files", async ({
      page,
      topoViewerPage
    }) => {
      await openRaw(
        page,
        topoViewerPage,
        `name: srsimtest
topology:
  nodes:
    router:
      kind: nokia_srsim
      type: sr-7s
      image: ${IMAGE}
      components:
        - slot: A
          type: cpm2-s
          sfm: sfm-s
        - slot: 1
          type: xcm-7s
          sfm: sfm-s
          xiom:
            - slot: 1
              type: iom-s-1.5t
              mda:
                - slot: 1
                  type: ms2-400gb-qsfpdd+2-100gb-qsfp28
    peer:
      kind: linux
      image: alpine:3
  links:
    - endpoints: ["router:e1-1", "peer:eth1"]
`
      );

      await expect(page.getByTestId(STATUS)).toHaveAttribute("data-status", "ok");
      await expect(page.locator("#sfm-type")).toHaveValue("sfm-s");
      await expect(page.getByTestId(SLOT_1)).toContainText("1 XIOM · 1 MDA");
      await expect(page.locator("#slot-1-xiom-0-type")).toHaveValue("iom-s-1.5t");
      await expect(page.locator("#slot-1-xiom-0-mda-0-slot")).toHaveValue("1");
      await expect(page.locator("#slot-1-xiom-0-mda-0-type")).toHaveValue("ms2-400gb-qsfpdd+2-100gb-qsfp28");
    });

    test("an integrated entry without a slot is the chassis' own", async ({ page, topoViewerPage }) => {
      await openRaw(
        page,
        topoViewerPage,
        fileWith({
          kind: KIND_SRSIM,
          type: "sr-1",
          image: IMAGE,
          components: [{ mda: [{ slot: 1, type: "me12-100gb-qsfp28" }] }]
        })
      );

      await expect(page.locator("#slot-A-mda-0-type")).toHaveValue("me12-100gb-qsfp28");
      await expect(page.getByTestId(STATUS)).toHaveAttribute("data-status", "ok");
      await expect(page.getByRole("button", { name: "Reset to defaults" })).toBeVisible();
    });

    test("no type means the SR-1 default", async ({ page, topoViewerPage }) => {
      await openRaw(page, topoViewerPage, fileWith({ kind: KIND_SRSIM, image: IMAGE }));
      await expect(page.getByTestId(NAME)).toHaveText("SR-1");
      await expect(page.locator("#node-chassis")).toHaveAttribute("placeholder", "SR-1 (default)");
    });

    test("shows the chassis a kind defines, without copying it to the node", async ({ page, topoViewerPage }) => {
      const yaml = fileWith(
        { kind: KIND_SRSIM },
        {
          kinds: {
            [KIND_SRSIM]: {
              type: "sr-7",
              image: IMAGE,
              sfm: "m-sfm5-7",
              components: [{ slot: "A", type: "cpm5" }, { slot: 1, type: "iom5-e" }]
            }
          }
        }
      );
      await openRaw(page, topoViewerPage, yaml);

      await expect(page.getByTestId(NAME)).toHaveText("SR-7");
      await expect(page.locator("#slot-A-type")).toHaveValue("cpm5");
      await expect(page.locator(CARD_TYPE)).toHaveValue("iom5-e");
      await expect(page.locator("#sfm-type")).toHaveValue("m-sfm5-7");
      await expect(page.getByTestId("chassis-inherited")).toContainText("kind nokia_srsim");

      // Nothing edited: nothing to save, and the node stays as short as it was
      await expect(page.locator(SEL_APPLY_BTN)).toHaveCount(0);
      expect(await topoViewerPage.getYamlFromFile(FILE)).toBe(yaml);

      // Editing makes the list the node's own, the way containerlab reads an override
      await page.getByTestId(SLOT_2).click();
      await expect(page.getByTestId("chassis-inherited")).toContainText("Overrides kind nokia_srsim");
      await page.locator(SEL_APPLY_BTN).click();
      await expect
        .poll(async () => readRouter(topoViewerPage))
        .toEqual({
          kind: KIND_SRSIM,
          components: [
            { slot: "A", type: "cpm5" },
            { slot: 1, type: "iom5-e" },
            { slot: 2, type: "iom5-e" }
          ]
        });
    });

    test("a node's own components win over its group's and kind's", async ({ page, topoViewerPage }) => {
      await openRaw(
        page,
        topoViewerPage,
        fileWith(
          { kind: KIND_SRSIM, group: "core", components: [{ slot: 2, type: "iom4-e" }] },
          {
            kinds: { [KIND_SRSIM]: { type: "sr-7", image: IMAGE, components: [{ slot: 1, type: "iom5-e" }] } },
            groups: { core: { sfm: "m-sfm5-7", components: [{ slot: 3, type: "iom5-e" }] } }
          }
        )
      );

      await expect(page.locator("#slot-2-type")).toHaveValue("iom4-e");
      await expect(page.getByTestId(SLOT_1)).toContainText("Install");
      await expect(page.getByTestId(SLOT_3)).toContainText("Install");
      await expect(page.locator("#sfm-type")).toHaveValue("m-sfm5-7");
    });

    test("NOKIA_SROS_CHASSIS in env is the chassis, as at deploy", async ({ page, topoViewerPage }) => {
      await openRaw(
        page,
        topoViewerPage,
        fileWith({ ...SR7, env: { NOKIA_SROS_CHASSIS: "sr-14s", NOKIA_SROS_MDA_1: "x" } })
      );
      await expect(page.getByTestId(NAME)).toHaveText("SR-14s");
      await expect(page.getByTestId("chassis-notes")).toContainText("NOKIA_SROS_CHASSIS");
      await expect(page.getByTestId("chassis-notes")).toContainText("NOKIA_SROS_MDA_1");
    });

    test("does not judge values set through variables", async ({ page, topoViewerPage }) => {
      await openRaw(
        page,
        topoViewerPage,
        fileWith({
          ...SR7,
          sfm: variable("FABRIC:=m-sfm5-7"),
          components: [
            { slot: "A", type: variable("CPM") },
            { slot: 1, type: variable("CARD:=iom5-e"), mda: [{ slot: 1, type: variable("MDA") }] }
          ]
        })
      );
      await expect(page.getByTestId(STATUS)).toHaveAttribute("data-status", "ok");
      await expect(page.locator(CARD_TYPE)).toHaveValue(/CARD/);
    });

    test("flags what containerlab refuses to parse", async ({ page, topoViewerPage }) => {
      await openRaw(
        page,
        topoViewerPage,
        fileWith({
          ...SR7,
          components: [
            { slot: "A", type: "cpm5" },
            {
              slot: 1,
              type: "iom5-e",
              mda: [
                { slot: 1, type: "me6-100gb-qsfp28" },
                { slot: 1, type: "me6-100gb-qsfp28" }
              ]
            }
          ]
        })
      );
      await expect(page.getByTestId(STATUS)).toContainText("MDA slot 1 is used twice");
    });
  });

  test.describe("leaves the file alone unless asked", () => {
    const COMMENTED = `name: simple # the lab
topology:
  nodes:
    router:
      kind: nokia_srsim
      type: sr-7
      image: ${IMAGE}
      # the fabric
      sfm: m-sfm5-7
      components:
        # both CPMs
        - slot: a
          type: cpm5 # keep me
        - slot: "2"
          type: iom5-e
          env:
            KEEP: "1"
          mda:
            - {slot: 1, type: me6-100gb-qsfp28}
    peer:
      kind: linux
      image: alpine:3
  links:
    - endpoints: ["router:e1-1", "peer:eth1"]
`;

    test("looking around changes nothing", async ({ page, topoViewerPage }) => {
      await openRaw(page, topoViewerPage, COMMENTED);

      await page.getByTestId(TOGGLE_2).click();
      await page.getByTestId(TOGGLE_2).click();

      await expect(page.locator(SEL_APPLY_BTN)).toHaveCount(0);
      expect(await topoViewerPage.getYamlFromFile(FILE)).toBe(COMMENTED);
    });

    test("an edit keeps what it did not touch", async ({ page, topoViewerPage }) => {
      await openRaw(page, topoViewerPage, COMMENTED);

      await page.locator("#slot-2-type").fill("iom4-e");
      await page.locator(SEL_APPLY_BTN).click();

      await expect
        .poll(async () => readRouter(topoViewerPage))
        .toEqual({
          kind: KIND_SRSIM,
          type: "sr-7",
          image: IMAGE,
          sfm: "m-sfm5-7",
          components: [
            { slot: "a", type: "cpm5" },
            { slot: "2", type: "iom4-e", env: { KEEP: "1" }, mda: [{ slot: 1, type: "me6-100gb-qsfp28" }] }
          ]
        });
      const saved = await topoViewerPage.getYamlFromFile(FILE);
      expect(saved).toContain("# the lab");
      expect(saved).toContain("# the fabric");
    });

    test("removing the last entry removes the keys", async ({ page, topoViewerPage }) => {
      await openRaw(
        page,
        topoViewerPage,
        fileWith({ ...SR7, sfm: "m-sfm5-7", components: [{ slot: 1, type: "iom5-e" }] })
      );

      await page.getByRole("button", { name: "Remove from chassis" }).click();
      await page.getByRole("button", { name: "Remove SFM" }).click();
      await page.locator(SEL_APPLY_BTN).click();

      await expect.poll(async () => readRouter(topoViewerPage)).toEqual(SR7);
    });
  });
});
