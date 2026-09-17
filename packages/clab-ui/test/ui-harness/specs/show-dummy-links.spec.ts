import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures/topoviewer";

const FILE = "network.clab.yml";
const dummyNodes = (page: Page) => page.locator('.react-flow__node[data-id="dummy0"]');

async function toggleDummyLinks(page: Page, currentlyHidden = false): Promise<void> {
  await page.getByRole("button", { name: "Links", exact: true }).click();
  const toggle = page.getByRole("menuitemcheckbox", { name: "Hide Dummy Links" });
  await expect(toggle).toHaveAttribute("aria-checked", String(currentlyHidden));
  await toggle.click();
}

test.describe("Dummy link visibility", () => {
  test.beforeEach(async ({ topoViewerPage }) => {
    await topoViewerPage.resetFiles();
    await topoViewerPage.gotoFile(FILE);
    await topoViewerPage.waitForCanvasReady();
  });

  test("Links menu hides dummy nodes and their edges without removing graph elements", async ({
    page,
    topoViewerPage
  }) => {
    const initialNodeIds = await topoViewerPage.getNodeIds();
    const initialEdgeCount = await topoViewerPage.getEdgeCount();
    const renderedEdges = await page.locator(".react-flow__edge").count();
    await expect(dummyNodes(page)).toBeVisible();

    await page.getByRole("button", { name: "Links", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("menuitem", { name: "Show All Labels", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Labels on Select", exact: true })
    ).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Hide Labels", exact: true })).toBeVisible();
    await page.getByRole("menuitemcheckbox", { name: "Hide Dummy Links" }).focus();
    await page.keyboard.press("Enter");

    await expect(dummyNodes(page)).toBeHidden();
    await expect(page.locator(".react-flow__edge")).toHaveCount(renderedEdges - 1);
    expect(await topoViewerPage.getNodeIds()).toEqual(initialNodeIds);
    expect(await topoViewerPage.getEdgeCount()).toBe(initialEdgeCount);

    await toggleDummyLinks(page, true);
    await expect(dummyNodes(page)).toBeVisible();
    await expect(page.locator(".react-flow__edge")).toHaveCount(renderedEdges);
  });

  test("preference survives reload and remains scoped to the lab", async ({
    page,
    topoViewerPage
  }) => {
    await toggleDummyLinks(page);
    await expect
      .poll(
        async () =>
          (await topoViewerPage.getAnnotationsFromFile(FILE)).viewerSettings?.showDummyLinks
      )
      .toBe(false);
    await topoViewerPage.gotoFile(FILE);
    await expect(dummyNodes(page)).toBeHidden();

    await topoViewerPage.gotoFile("simple.clab.yml");
    await page.getByRole("button", { name: "Links", exact: true }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: "Hide Dummy Links" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    await page.keyboard.press("Escape");

    await topoViewerPage.gotoFile(FILE);
    await expect(dummyNodes(page)).toBeHidden();
    await toggleDummyLinks(page, true);
    await expect
      .poll(
        async () =>
          (await topoViewerPage.getAnnotationsFromFile(FILE)).viewerSettings?.showDummyLinks
      )
      .toBe(true);
    await topoViewerPage.gotoFile(FILE);
    await expect(dummyNodes(page)).toBeVisible();
  });

  test("hides literal and extended dummy endpoints while keeping dummy-router visible", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.writeYamlFile(
      FILE,
      `name: dummy-test
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
    dummy-router:
      kind: linux
  links:
    - endpoints: ["srl1:e1-1", "dummy1"]
    - type: dummy
      endpoint:
        node: srl1
        interface: e1-2
    - endpoints: ["srl1:e1-3", "dummy-router:eth1"]
`
    );
    await topoViewerPage.gotoFile(FILE);
    await toggleDummyLinks(page);
    await expect(dummyNodes(page)).toBeHidden();
    await expect(page.locator('.react-flow__node[data-id="dummy1"]')).toBeHidden();
    await expect(page.locator('.react-flow__node[data-id="dummy-router"]')).toBeVisible();
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
    expect(await topoViewerPage.getNodeIds()).toEqual(
      expect.arrayContaining(["dummy0", "dummy1", "dummy-router"])
    );
  });

  for (const layout of ["force", "auto", "radial"] as const) {
    test(`hide → ${layout} layout → save → reload → show preserves positions and annotations`, async ({
      page,
      topoViewerPage
    }) => {
      const original = await topoViewerPage.getAnnotationsFromFile(FILE);
      const groupId = "dummy-group";
      await topoViewerPage.writeAnnotationsFile(FILE, {
        ...original,
        nodeAnnotations: [
          ...(original.nodeAnnotations ?? []),
          { id: "dummy0", groupId, group: "Dummy group", level: "1" }
        ],
        networkNodeAnnotations: original.networkNodeAnnotations?.map((node) =>
          node.id === "dummy0" ? { ...node, position: { x: 21.5, y: -21.5 } } : node
        ),
        groupStyleAnnotations: [
          {
            id: groupId,
            name: "Dummy group",
            level: "1",
            position: { x: -100, y: -100 },
            width: 300,
            height: 300
          }
        ],
        freeTextAnnotations: [
          { id: "dummy-note", text: "Keep this note", position: { x: 10, y: 10 }, groupId }
        ],
        freeShapeAnnotations: [
          {
            id: "dummy-shape",
            shapeType: "rectangle",
            position: { x: 10, y: 50 },
            width: 40,
            height: 40,
            groupId
          }
        ],
        trafficRateAnnotations: [
          {
            id: "dummy-rate",
            nodeId: "srl2",
            interfaceName: "eth1",
            position: { x: 10, y: 100 },
            groupId
          }
        ]
      });
      await topoViewerPage.gotoFile(FILE);
      await topoViewerPage.setEditMode();
      await topoViewerPage.unlock();
      const initialIds = await topoViewerPage.getNodeIds();
      const initialEdgeCount = await topoViewerPage.getEdgeCount();
      const initialPosition = await topoViewerPage.getNodePosition("dummy0");
      const before = await topoViewerPage.getAnnotationsFromFile(FILE);
      const initialSrl1Position = before.nodeAnnotations?.find(
        (node) => node.id === "srl1"
      )?.position;

      await toggleDummyLinks(page);
      await expect(dummyNodes(page)).toBeHidden();
      await page.getByTestId("navbar-layout").click();
      await page.getByTestId(`navbar-layout-${layout}`).click();
      await expect
        .poll(
          async () =>
            (await topoViewerPage.getAnnotationsFromFile(FILE)).nodeAnnotations?.find(
              (node) => node.id === "srl1"
            )?.position
        )
        .not.toEqual(initialSrl1Position);

      expect(await topoViewerPage.getNodeIds()).toEqual(expect.arrayContaining(initialIds));
      expect(await topoViewerPage.getEdgeCount()).toBe(initialEdgeCount);
      expect(await topoViewerPage.getNodePosition("dummy0")).toEqual(initialPosition);
      const after = await topoViewerPage.getAnnotationsFromFile(FILE);
      expect(after.networkNodeAnnotations?.find((node) => node.id === "dummy0")).toEqual(
        before.networkNodeAnnotations?.find((node) => node.id === "dummy0")
      );
      expect(after.nodeAnnotations?.find((node) => node.id === "dummy0")).toMatchObject({
        groupId
      });
      expect(after.freeTextAnnotations).toEqual(before.freeTextAnnotations);
      expect(after.freeShapeAnnotations).toEqual(before.freeShapeAnnotations);
      expect(after.trafficRateAnnotations).toEqual(before.trafficRateAnnotations);
      expect(after.groupStyleAnnotations).toEqual(before.groupStyleAnnotations);

      await topoViewerPage.gotoFile(FILE);
      await expect(dummyNodes(page)).toBeHidden();
      await toggleDummyLinks(page, true);
      await expect(dummyNodes(page)).toBeVisible();
      expect(await topoViewerPage.getNodePosition("dummy0")).toEqual(initialPosition);
      expect(await topoViewerPage.getNodeIds()).toEqual(expect.arrayContaining(initialIds));
    });
  }

  test("select-all skips hidden dummy nodes and links and selects them again when shown", async ({
    page,
    topoViewerPage
  }) => {
    await topoViewerPage.setEditMode();
    await topoViewerPage.unlock();
    await toggleDummyLinks(page);
    await expect(dummyNodes(page)).toBeHidden();
    await topoViewerPage.getCanvas().click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("Control+A");
    await expect.poll(() => topoViewerPage.getSelectedNodeIds()).toContain("srl1");
    expect(await topoViewerPage.getSelectedNodeIds()).not.toContain("dummy0");
    expect(await topoViewerPage.getSelectedEdgeIds()).toHaveLength(
      (await topoViewerPage.getEdgeCount()) - 1
    );

    await toggleDummyLinks(page, true);
    await expect(dummyNodes(page)).toBeVisible();
    await topoViewerPage.getCanvas().click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("Control+A");
    await expect.poll(() => topoViewerPage.getSelectedNodeIds()).toContain("dummy0");
    expect(await topoViewerPage.getSelectedEdgeIds()).toHaveLength(
      await topoViewerPage.getEdgeCount()
    );
  });
});
