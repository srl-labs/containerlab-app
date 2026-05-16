import { expect, test } from "../fixtures/browserErrors";

test.describe("Standalone startup", () => {
  test("renders endpoint login form without a configured session", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByText("Connect one or more `clab-api-server` endpoints", { exact: false })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Add Endpoint" })).toBeVisible();
    await expect(page.getByLabel("API Endpoint")).toHaveValue("https://localhost:8090");
    await expect(page.getByLabel("Label")).toBeVisible();
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByLabel("Keep me signed in")).toHaveValue("24h");
    await expect(page.getByRole("button", { name: "Add Endpoint" })).toBeDisabled();
  });

  test("adds an endpoint and persists non-secret metadata", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();

      class MockEventSource extends EventTarget {
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        readyState = 0;
        url: string;

        constructor(url: string) {
          super();
          this.url = url;
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

      window.EventSource = MockEventSource as unknown as typeof EventSource;
    });

    await page.route("**/api/config", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          defaultClabApiUrl: "https://localhost:8090",
          endpoints: []
        })
      });
    });
    await page.route("**/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false, endpoints: [] })
      });
    });
    await page.route("**/auth/endpoints/add", async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        url: "https://localhost:8090",
        label: "Test Endpoint",
        username: "admin",
        password: "secret",
        sessionDuration: "36h"
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "endpoint-e2e",
          url: "https://localhost:8090",
          label: "Test Endpoint",
          username: "admin",
          sessionDuration: "36h",
          status: "connected",
          connected: true
        })
      });
    });
    await page.route("**/files", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route("**/api/runtime/inspect/all", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.route("**/api/runtime/ui/custom-nodes", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ customNodes: [], defaultNode: "" })
      });
    });

    await page.goto("/");
    await page.getByLabel("Label").fill("Test Endpoint");
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password").fill("secret");
    await page.getByLabel("Keep me signed in").fill("36h");

    const addButton = page.getByRole("button", { name: "Add Endpoint" });
    await expect(addButton).toBeEnabled();
    await addButton.click();

    await expect(page.locator('[data-testid="standalone-settings-button"]')).toBeVisible();
    const persisted = await page.evaluate(() => localStorage.getItem("clab-standalone-endpoints"));
    expect(JSON.parse(persisted ?? "[]")).toEqual([
      {
        id: "endpoint-e2e",
        url: "https://localhost:8090",
        label: "Test Endpoint",
        username: "admin",
        sessionDuration: "36h"
      }
    ]);
    expect(persisted).not.toContain("secret");
  });

  test("imports endpoint profiles before login", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });
    await page.route("**/api/config", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          defaultClabApiUrl: "https://localhost:8090",
          endpoints: []
        })
      });
    });
    await page.route("**/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false, endpoints: [] })
      });
    });

    await page.goto("/");
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.locator('[data-testid="standalone-endpoints-import"]').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "endpoints.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          kind: "containerlab-app.endpoints",
          version: 1,
          endpoints: [
            {
              url: "api.imported.test/",
              label: "Imported API",
              username: "operator",
              sessionDuration: "7d"
            }
          ]
        })
      )
    });

    await expect(page.locator('[data-testid="standalone-settings-button"]')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("clab-standalone-endpoints")))
      .not.toBeNull();
    const persisted = await page.evaluate(() => localStorage.getItem("clab-standalone-endpoints"));
    expect(JSON.parse(persisted ?? "[]")).toEqual([
      {
        id: expect.any(String),
        url: "https://api.imported.test",
        label: "Imported API",
        username: "operator",
        sessionDuration: "7d"
      }
    ]);
    expect(persisted).not.toContain("password");
    expect(persisted).not.toContain("token");
  });
});
