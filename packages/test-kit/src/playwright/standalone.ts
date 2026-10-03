import type { Locator, Page } from "@playwright/test";

import { expect } from "./browserErrors";

export interface EndpointProfile {
  id: string;
  url: string;
  label: string;
  username: string;
  sessionDuration: string;
}

export interface ConnectedEndpoint extends EndpointProfile {
  status: "connected";
  connected: true;
}

export const TEST_ENDPOINT: EndpointProfile = {
  id: "test-endpoint",
  url: "https://localhost:8090",
  label: "Test Endpoint",
  username: "admin",
  sessionDuration: "24h"
};

export function connected(endpoint: EndpointProfile): ConnectedEndpoint {
  return { ...endpoint, status: "connected", connected: true };
}

/** Keeps live event streams closed; tests drive state through routes instead. */
export async function stubEventSource(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class StubEventSource extends EventTarget {
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      readyState = 0;

      constructor(readonly url: string) {
        super();
        window.setTimeout(() => {
          this.readyState = 1;
          this.onopen?.(new Event("open"));
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      close(): void {
        this.readyState = 2;
      }
    }
    window.EventSource = StubEventSource as unknown as typeof EventSource;
  });
}

/** Stores endpoint profiles the way the login form does, before the page loads. */
export async function seedEndpoints(page: Page, endpoints: EndpointProfile[]): Promise<void> {
  const profiles = endpoints.map(({ id, url, label, username, sessionDuration }) => ({
    id, url, label, username, sessionDuration
  }));
  await page.addInitScript((value) => localStorage.setItem("clab-standalone-endpoints", value), JSON.stringify(profiles));
}

/**
 * Serves the app-server routes the standalone workspace needs to start. Register
 * test-specific routes afterwards; Playwright uses the most recently added match.
 */
export async function mockStandaloneApi(
  page: Page,
  { endpoints = [] as ConnectedEndpoint[], defaultClabApiUrl = TEST_ENDPOINT.url } = {}
): Promise<void> {
  await stubEventSource(page);
  await page.route("**/api/config", (route) => route.fulfill({ json: { defaultClabApiUrl, endpoints: [] } }));
  await page.route("**/auth/me**", (route) =>
    route.fulfill({ json: { authenticated: endpoints.length > 0, endpoints } })
  );
  await page.route("**/files**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/runtime/inspect/all**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/runtime/ui/custom-nodes**", (route) =>
    route.fulfill({ json: { customNodes: [], defaultNode: "" } })
  );
  await page.route("**/api/runtime/ui/icons/list**", (route) => route.fulfill({ json: { icons: [] } }));
  await page.route("**/auth/endpoints/*/metrics", (route) =>
    route.fulfill({
      json: {
        serverInfo: { version: "test", uptime: "1s", startTime: "now" },
        metrics: {
          cpu: { usagePercent: 0, numCPU: 1 },
          mem: { totalMem: 1, usedMem: 0, availableMem: 1, usagePercent: 0 },
          disk: { path: "/", totalDisk: 1, usedDisk: 0, freeDisk: 1, usagePercent: 0 }
        }
      }
    })
  );
}

export async function waitForWorkspace(page: Page): Promise<void> {
  await expect(page.getByTestId("workspace-rail")).toBeVisible({ timeout: 30_000 });
}

/** Creates a topology file through the shared dialog and waits for its document tab. */
export async function createTopologyFile(
  page: Page,
  name: string,
  { fromEmptyState = false } = {}
): Promise<Locator> {
  if (fromEmptyState) {
    await page.getByRole("button", { name: "Create a lab", exact: true }).click();
  } else {
    const labs = page.getByTestId("workspace-rail").getByRole("button", { name: "Labs", exact: true });
    if ((await labs.getAttribute("aria-expanded")) !== "true") await labs.click();
    await page.getByTestId("workspace-sidebar").getByRole("button", { name: "New Topology File", exact: true }).first().click();
  }
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Topology file name" }).fill(`${name}.clab.yml`);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();
  const tab = page.getByRole("tab", { name, exact: true });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  return tab;
}

export async function openSettings(page: Page): Promise<Locator> {
  await page.getByTestId("standalone-settings-button").click();
  const dialog = page.getByTestId("standalone-settings-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}
