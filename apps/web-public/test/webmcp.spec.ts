import type { Page } from "@playwright/test";
import { expect, test, waitForWorkspace } from "@srl-labs/containerlab-test-kit/playwright";

const FILES_KEY = "clab-pages-sandbox-files-v1";

type FakeTool = { name: string; execute: (input: unknown) => Promise<unknown> };
type WebMcpWindow = Window & { webMcpTools: Map<string, FakeTool> };

/** A stand-in for Chrome's document.modelContext that keeps the registered tools. */
async function installModelContext(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tools = new Map<string, unknown>();
    (window as unknown as { webMcpTools: Map<string, unknown> }).webMcpTools = tools;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        async registerTool(tool: { name: string }) {
          tools.set(tool.name, tool);
        },
      },
    });
  });
}

async function callTool(page: Page, name: string, input: unknown): Promise<Record<string, unknown>> {
  return await page.evaluate(
    async ([toolName, toolInput]: readonly [string, unknown]) =>
      (await (window as unknown as WebMcpWindow).webMcpTools
        .get(toolName)!
        .execute(toolInput)) as Record<string, unknown>,
    [name, input] as const,
  );
}

async function sandboxFiles(page: Page): Promise<Record<string, string>> {
  return await page.evaluate(
    (key: string) => JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, string>,
    FILES_KEY,
  );
}

test("the sandbox shows no WebMCP mark and registers nothing without WebMCP", async ({ page }) => {
  await page.goto("/");
  await waitForWorkspace(page);
  await expect(page.getByTestId("workspace-rail").getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByTestId("webmcp-status")).toHaveCount(0);
});

test("the sandbox registers the WebMCP tools and replaces a lab in place", async ({ page }) => {
  await installModelContext(page);
  await page.goto("/");
  await waitForWorkspace(page);
  await expect(page.getByTestId("workspace-rail").getByRole("img", { name: "WebMCP available" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => [...(window as unknown as WebMcpWindow).webMcpTools.keys()].sort()))
    .toEqual(["create_clos_topology", "create_lab"]);

  const created = await callTool(page, "create_clos_topology", {
    name: "fabric",
    tiers: [{ count: 2 }, { count: 2 }],
    images: { nokia_srlinux: "ghcr.io/nokia/srlinux:latest" },
  });
  expect(created).toMatchObject({ fileName: "fabric.clab.yml", autoLayout: true, replaced: false });
  await expect(page.getByRole("tab", { name: "fabric", exact: true })).toBeVisible();

  const replaced = await callTool(page, "create_lab", {
    topology: { name: "fabric", topology: { nodes: { r1: { kind: "linux", image: "alpine" } } } },
    annotations: { nodeAnnotations: [{ id: "r1", position: { x: 10, y: 20 } }] },
  });
  expect(replaced).toMatchObject({ fileName: "fabric.clab.yml", autoLayout: false, replaced: true });
  const afterReplace = await sandboxFiles(page);
  expect(afterReplace["fabric.clab.yml"]).toContain("r1:");
  expect(afterReplace["fabric.clab.yml"]).not.toContain("node1-1");
  expect(JSON.parse(afterReplace["fabric.clab.yml.annotations.json"] ?? "{}")).toEqual({
    nodeAnnotations: [{ id: "r1", position: { x: 10, y: 20 } }],
  });
  await expect(page.getByRole("tab", { name: "fabric", exact: true })).toHaveCount(1);
});

test("a failed WebMCP replacement keeps the previous lab files", async ({ page }) => {
  await installModelContext(page);
  await page.goto("/");
  await waitForWorkspace(page);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as WebMcpWindow).webMcpTools.size))
    .toBe(2);

  const topology = { name: "keep", topology: { nodes: { a: { kind: "linux", image: "alpine" } } } };
  await callTool(page, "create_lab", {
    topology,
    annotations: { nodeAnnotations: [{ id: "a", position: { x: 1, y: 2 } }] },
  });
  const before = await sandboxFiles(page);

  const badAnnotations = await callTool(page, "create_lab", {
    topology: { ...topology, topology: { nodes: { b: { kind: "linux", image: "alpine" } } } },
    annotations: { nodeAnnotations: { b: { position: { x: 0, y: 0 } } } },
  });
  expect(String(badAnnotations.error)).toContain("annotations/nodeAnnotations");

  // Storage fills up when the annotations are written, after the YAML was overwritten.
  await page.evaluate((key: string) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name === key && value.includes("quota-marker")) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      setItem.call(this, name, value);
    };
  }, FILES_KEY);
  const quota = await callTool(page, "create_lab", {
    topology: { ...topology, topology: { nodes: { b: { kind: "linux", image: "alpine" } } } },
    annotations: {
      freeTextAnnotations: [{ id: "t1", text: "quota-marker", position: { x: 0, y: 0 } }],
    },
  });
  expect(String(quota.error)).toMatch(/quota/i);

  const after = await sandboxFiles(page);
  expect(after["keep.clab.yml"]).toBe(before["keep.clab.yml"]);
  // The open lab may have rewritten its annotations with defaults; the layout stays.
  const annotations = JSON.parse(after["keep.clab.yml.annotations.json"] ?? "{}") as {
    nodeAnnotations?: unknown[];
    freeTextAnnotations?: unknown[];
  };
  expect(annotations.nodeAnnotations).toEqual([{ id: "a", position: { x: 1, y: 2 } }]);
  expect(annotations.freeTextAnnotations ?? []).toEqual([]);
});
