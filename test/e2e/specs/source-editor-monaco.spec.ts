import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";

const ENDPOINT = {
  id: "endpoint-e2e",
  url: "https://localhost:8080",
  label: "Test Endpoint",
  username: "admin",
  sessionDuration: "24h",
  status: "connected",
  connected: true
};

const TOPOLOGY_REF = {
  topologyId: "standalone:endpoint-e2e::/labs/demo.clab.yml",
  yamlPath: "/labs/demo.clab.yml",
  annotationsPath: "/labs/demo.clab.yml.annotations.json",
  labName: "demo",
  source: "standalone"
};

const YAML_CONTENT = [
  "name: demo",
  "topology:",
  "  nodes:",
  "    srl1:",
  "      kind: nokia_srlinux",
  ""
].join("\n");

const SNAPSHOT = {
  revision: 1,
  documentRevision: "1",
  nodes: [],
  edges: [],
  annotations: {
    nodeAnnotations: [],
    freeTextAnnotations: [],
    freeShapeAnnotations: [],
    groupStyleAnnotations: [],
    edgeAnnotations: [],
    viewerSettings: {}
  },
  yamlFileName: "demo.clab.yml",
  annotationsFileName: "demo.clab.yml.annotations.json",
  yamlContent: YAML_CONTENT,
  annotationsContent: "{}\n",
  labName: "demo",
  mode: "edit",
  deploymentState: "undeployed",
  labSettings: { name: "demo" },
  canUndo: false,
  canRedo: false
};

const HEALTH_METRICS = {
  serverInfo: { version: "test", uptime: "1s", startTime: "now" },
  metrics: {
    cpu: { usagePercent: 0, numCPU: 1 },
    mem: { totalMem: 1, usedMem: 0, availableMem: 1, usagePercent: 0 },
    disk: { path: "/", totalDisk: 1, usedDisk: 0, freeDisk: 1, usagePercent: 0 }
  }
};

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

async function mockStandaloneApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear();
    class MockEventSource extends EventTarget {
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      readyState = 1;
      url: string;

      constructor(url: string) {
        super();
        this.url = url;
        window.setTimeout(() => {
          this.onopen?.(new Event("open"));
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      close(): void {
        this.readyState = 2;
      }
    }

    window.EventSource = MockEventSource as unknown as typeof EventSource;
  });

  await page.route("**/api/config", (route) =>
    fulfillJson(route, { defaultClabApiUrl: "https://localhost:8080", endpoints: [] })
  );
  await page.route("**/auth/me", (route) =>
    fulfillJson(route, { authenticated: true, endpoints: [ENDPOINT] })
  );
  await page.route("**/auth/endpoints", (route) => fulfillJson(route, { endpoints: [ENDPOINT] }));
  await page.route("**/auth/endpoints/*/metrics", (route) => fulfillJson(route, HEALTH_METRICS));
  await page.route("**/files**", (route) =>
    fulfillJson(route, [
      {
        endpointId: ENDPOINT.id,
        filename: "demo.clab.yml",
        path: TOPOLOGY_REF.yamlPath,
        labName: "demo",
        hasAnnotations: false,
        deploymentState: "undeployed",
        topologyRef: TOPOLOGY_REF
      }
    ])
  );
  await page.route("**/api/runtime/inspect/all**", (route) => fulfillJson(route, {}));
  await page.route("**/api/runtime/ui/custom-nodes**", (route) =>
    fulfillJson(route, { customNodes: [], defaultNode: "" })
  );
  await page.route("**/api/runtime/ui/icons/list**", (route) => fulfillJson(route, { icons: [] }));
  await page.route("**/api/topology/sessions", (route) =>
    fulfillJson(route, { sessionId: "topo-session-e2e", topologyRef: TOPOLOGY_REF })
  );
  await page.route("**/api/topology/snapshot", (route) => fulfillJson(route, { snapshot: SNAPSHOT }));
  await page.route("**/api/topology/command", (route) =>
    fulfillJson(route, { type: "topology-host:ack", snapshot: SNAPSHOT })
  );
}

async function openYamlEditor(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('[data-testid="topoviewer-app"]')).toBeVisible({ timeout: 20000 });
  await page.getByLabel(/Expand Test Endpoint|Collapse Test Endpoint/).click({ force: true });

  const localLabsToggle = page.getByLabel(/Expand Local Labs|Collapse Local Labs/);
  if ((await localLabsToggle.count()) > 0) {
    await localLabsToggle.click({ force: true });
  }

  await page.getByText("demo.clab.yml", { exact: true }).click({ force: true });
  await expect(page.locator('[data-testid="panel-tab-yaml"]')).toBeVisible({ timeout: 20000 });
  await page.locator('[data-testid="navbar-lock"]').click();
  await page.locator('[data-testid="panel-tab-yaml"]').click();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 20000 });
  await page.waitForFunction(() => Boolean(window.__clabMonacoDebug));
}

async function setEditorValue(
  page: Page,
  value: string,
  lineNumber: number,
  column: number
): Promise<void> {
  await page.evaluate(
    ({ content, line, col }) => {
      window.__clabMonacoDebug?.setValue(content);
      window.__clabMonacoDebug?.setPosition(line, col);
    },
    { content: value, line: lineNumber, col: column }
  );
}

async function editorValue(page: Page): Promise<string> {
  return page.evaluate(() => window.__clabMonacoDebug?.model.getValue() ?? "");
}

async function triggerSuggest(page: Page): Promise<void> {
  await page.evaluate(() => window.__clabMonacoDebug?.triggerSuggest());
}

async function dispatchEditorPaste(page: Page, text: string): Promise<void> {
  await page.evaluate((pasteText) => {
    const debug = window.__clabMonacoDebug;
    const domNode = debug?.editor.getDomNode();
    if (!debug || !domNode) throw new Error("Monaco debug API is not available");

    const data = new DataTransfer();
    data.setData("text/plain", pasteText);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data
    });

    debug.editor.focus();
    domNode.dispatchEvent(event);
  }, text);
}

async function selectEditorRange(
  page: Page,
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }
): Promise<void> {
  await page.evaluate((selectionRange) => {
    window.__clabMonacoDebug?.editor.setSelection(selectionRange);
    window.__clabMonacoDebug?.editor.focus();
  }, range);
}

async function selectedTextBackgrounds(page: Page): Promise<string[]> {
  return page.locator(".monaco-editor .selected-text").evaluateAll((elements) =>
    elements
      .map((element) => window.getComputedStyle(element).backgroundColor)
      .filter((background) => background !== "" && background !== "rgba(0, 0, 0, 0)")
  );
}

async function markerMessages(page: Page): Promise<string[]> {
  return page.evaluate(
    () => window.__clabMonacoDebug?.getMarkers().map((marker) => marker.message) ?? []
  );
}

function isRedDominant(background: string): boolean {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(background);
  if (!match) return false;
  const red = Number(match[1]);
  const green = Number(match[2]);
  const blue = Number(match[3]);
  return red > 140 && red > green * 1.25 && red > blue * 1.25;
}

test.describe("standalone Monaco YAML editor", () => {
  test("shows schema diagnostics, completion suggestions, and hover help", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    await mockStandaloneApi(page);
    await openYamlEditor(page);

    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: nokia_srlinux\n", 4, 26);
    await selectEditorRange(page, {
      startLineNumber: 4,
      startColumn: 13,
      endLineNumber: 4,
      endColumn: 26
    });
    await expect
      .poll(async () => selectedTextBackgrounds(page), {
        timeout: 5000,
        message: "selected YAML text should render with a visible selection background"
      })
      .not.toEqual([]);
    expect((await selectedTextBackgrounds(page)).some(isRedDominant)).toBe(false);

    await setEditorValue(
      page,
      "name: demo\ntopology:\n  nodes:\n    srl1:\n      kind: does_not_exist\n      unknown-field: true\n",
      6,
      26
    );
    await expect
      .poll(async () => await markerMessages(page), { timeout: 5000 })
      .toEqual(
        expect.arrayContaining([
          'Unknown property "unknown-field"',
          expect.stringContaining("Value is not accepted")
        ])
      );

    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: nok", 4, 16);
    await triggerSuggest(page);
    await expect(page.locator(".suggest-widget")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".suggest-widget")).toContainText("nokia_srlinux");

    await page.keyboard.press("Tab");
    await expect
      .poll(async () => editorValue(page), {
        timeout: 5000,
        message: "Tab should indent instead of accepting the regular suggestion widget"
      })
      .not.toContain("nokia_srlinux");

    await page.keyboard.press("Escape");
    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: nok", 4, 16);
    await triggerSuggest(page);
    await expect(page.locator(".suggest-widget")).toBeVisible({ timeout: 5000 });
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => editorValue(page), {
        timeout: 5000,
        message: "Enter should accept the selected regular suggestion"
      })
      .toContain("kind: nokia_srlinux");

    await page.keyboard.press("Escape");
    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: ", 4, 13);
    await expect(page.locator(".suggest-widget")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".suggest-widget")).toContainText("6wind_vsr");

    await page.keyboard.press("Escape");
    await setEditorValue(page, "topology:\n  nodes:\n    srl1:\n      kind: ", 4, 13);
    await page.keyboard.type("n");
    await expect(page.locator(".suggest-widget")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".suggest-widget")).toContainText("nokia_srlinux");

    await page.keyboard.press("Escape");
    await setEditorValue(
      page,
      "topology:\n  nodes:\n    srl1:\n      kind: nokia_srlinux\n",
      4,
      9
    );
    await page.evaluate(() => window.__clabMonacoDebug?.triggerHover());
    await expect(page.locator(".monaco-hover")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".monaco-hover")).toContainText("Allowed values");

    expect(consoleErrors.filter((entry) => entry.includes("Missing requestHandler"))).toEqual([]);
  });

  test("does not fall back to root suggestions in nested node config", async ({ page }) => {
    await mockStandaloneApi(page);
    await openYamlEditor(page);

    const directNodeBody = [
      "topology:",
      "  nodes:",
      "    srl1:",
      "      kind: nokia_srlinux",
      "      type: ixrd1",
      "      image: ghcr.io/nokia/srlinux:latest",
      "    client1:",
      "      kind: linux",
      "      image: ghcr.io/srl-labs/network-multitool:latest",
      "      type: iasd                  ",
      "    asdasd:",
      "      "
    ].join("\n");

    await setEditorValue(page, directNodeBody, 12, 7);
    await triggerSuggest(page);
    await expect(page.locator(".suggest-widget")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".suggest-widget")).toContainText("kind");
    await expect(page.locator(".suggest-widget")).not.toContainText("topology");

    const nestedUnknown = [
      "topology:",
      "  nodes:",
      "    asdasd:",
      "      below asdad:",
      "        "
    ].join("\n");

    await page.keyboard.press("Escape");
    await setEditorValue(page, nestedUnknown, 5, 9);
    await triggerSuggest(page);
    await expect(page.locator(".suggest-widget")).not.toContainText("topology");
  });

  test("preserves pasted indentation and undoes a paste as one edit", async ({ page }) => {
    await mockStandaloneApi(page);
    await openYamlEditor(page);

    const base = "name: demo\ntopology:\n  nodes:\n";
    const pasted = "    leaf1:\n      kind: nokia_srlinux\n      image: ghcr.io/nokia/srlinux\n";
    await setEditorValue(page, base, 4, 1);
    await dispatchEditorPaste(page, pasted);

    await expect
      .poll(async () => editorValue(page), {
        timeout: 5000,
        message: "paste should preserve the clipboard indentation exactly"
      })
      .toBe(base + pasted);

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z");
    await expect
      .poll(async () => editorValue(page), {
        timeout: 5000,
        message: "one undo should remove the complete pasted block"
      })
      .toBe(base);
  });

  test("does not open empty suggestions for free-form YAML values", async ({ page }) => {
    await mockStandaloneApi(page);
    await openYamlEditor(page);

    await setEditorValue(page, "name:", 1, 6);
    await page.keyboard.press("Space");
    await page.keyboard.type("atest");
    await expect
      .poll(async () => editorValue(page), {
        timeout: 5000,
        message: "typing a free-form topology name should update the model"
      })
      .toBe("name: atest");
    await expect(page.locator(".suggest-widget")).toBeHidden({ timeout: 1000 });

    const text = [
      "name: atest",
      "",
      "topology:",
      "  nodes:",
      "    client2:",
      "      kind: 6wind_vsr",
      "      image:"
    ].join("\n");
    await setEditorValue(page, text, 7, 13);
    await page.keyboard.press("Space");
    await expect
      .poll(async () => editorValue(page), {
        timeout: 5000,
        message: "typing a space after image: should update the model"
      })
      .toBe(`${text} `);
    await expect(page.locator(".suggest-widget")).toBeHidden({ timeout: 1000 });
  });
});
