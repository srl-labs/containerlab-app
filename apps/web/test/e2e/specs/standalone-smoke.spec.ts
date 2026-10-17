import { expect, mockStandaloneApi, test } from "@srl-labs/containerlab-test-kit/playwright";

test.describe("Standalone startup", () => {
  test("renders endpoint login form without a configured session", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByText("Sign in to clab-api-server on the Linux machine that runs your labs.", { exact: false })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in to a lab host" })).toBeVisible();
    await expect(page.getByLabel("Lab host URL")).toHaveValue("https://localhost:8090");
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByLabel("Stay signed in for")).toHaveValue("24h");
    await expect(page.getByRole("button", { name: "Sign In" })).toBeDisabled();
  });

  test("adds an endpoint and persists non-secret metadata", async ({ page }) => {
    await mockStandaloneApi(page);
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
    await page.goto("/");
    await page.getByLabel("Name", { exact: true }).fill("Test Endpoint");
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password").fill("secret");
    await page.getByLabel("Stay signed in for").fill("36h");

    const addButton = page.getByRole("button", { name: "Sign In" });
    await expect(addButton).toBeEnabled();
    await addButton.click();

    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible({ timeout: 30_000 });
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
    await mockStandaloneApi(page);

    await page.goto("/");
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByTestId("standalone-endpoints-import").click();
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

    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible({ timeout: 30_000 });
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
