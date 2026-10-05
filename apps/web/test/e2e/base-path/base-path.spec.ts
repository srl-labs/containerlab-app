import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, stubEventSource, test } from "@srl-labs/containerlab-test-kit/playwright";
import { createServer, type ViteDevServer } from "vite";
import { createContainerlabAppServer } from "@srl-labs/containerlab-app-server";

import { buildDetachedTerminalUrl } from "../../../../../packages/standalone-runtime/src/runtimeDetachedTerminal";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const savedEndpoint = {
  id: "saved-endpoint",
  label: "Saved endpoint",
  url: "http://api.example.test",
  username: "admin",
  sessionDuration: "24h"
};

async function mockRuntime(page: Page, basePath: string): Promise<void> {
  await stubEventSource(page);
  await page.route("**/*", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const relative = pathname.slice(basePath.length);
    if (!relative.startsWith("/auth/") && !relative.startsWith("/api/") && relative !== "/files") {
      await route.continue();
      return;
    }
    let payload: unknown = {};
    if (relative === "/api/config") payload = { defaultClabApiUrl: savedEndpoint.url, endpoints: [] };
    if (relative === "/auth/me") payload = { authenticated: false, endpoints: [] };
    if (relative === "/files") payload = [];
    if (relative === "/api/runtime/ui/custom-nodes") payload = { customNodes: [], defaultNode: "" };
    if (relative === `/auth/endpoints/${savedEndpoint.id}/reconnect`) {
      payload = { ...savedEndpoint, connected: true, status: "connected" };
    }
    await route.fulfill({ json: payload });
  });
}

for (const mode of ["production", "development"] as const) {
  for (const basePath of ["", "/tools/clab"]) {
    test.describe(`${mode} at ${basePath || "/"}`, () => {
      let app: Awaited<ReturnType<typeof createContainerlabAppServer>> | undefined;
      let vite: ViteDevServer | undefined;
      let appUrl: string;

      test.beforeAll(async () => {
        app = await createContainerlabAppServer({
          basePath,
          isDev: mode === "development",
          logger: false,
          staticClientRoot: path.join(webRoot, "dist/client")
        });
        const address = await app.listen({ host: "127.0.0.1", port: 0 });
        appUrl = `${address}${basePath}/`;
        if (mode === "development") {
          const previousEnv = { ...process.env };
          try {
            process.env.PORT = new URL(address).port;
            process.env.WEB_TLS_ENABLE = "false";
            process.env.WEB_BASE_PATH = basePath;
            delete process.env.VITE_PUBLIC_BASE_PATH;
            vite = await createServer({
              configFile: path.join(webRoot, "vite.config.ts"),
              logLevel: "error",
              server: { host: "127.0.0.1", port: 0, warmup: { clientFiles: [] } }
            });
            await vite.listen();
            const viteAddress = vite.httpServer?.address();
            if (viteAddress == null || typeof viteAddress === "string") throw new Error("Vite did not listen");
            appUrl = `http://127.0.0.1:${viteAddress.port}${basePath}/`;
          } finally {
            for (const name of ["PORT", "WEB_TLS_ENABLE", "WEB_BASE_PATH", "VITE_PUBLIC_BASE_PATH"]) {
              if (previousEnv[name] === undefined) delete process.env[name];
              else process.env[name] = previousEnv[name];
            }
          }
        }
      });

      test.afterAll(async () => {
        await vite?.close();
        await app?.close();
      });

      test("login loads with an actual app server and no saved session", async ({ page }) => {
        await page.goto(appUrl);
        await expect(page.getByRole("heading", { name: "Add Endpoint", exact: true })).toBeVisible();
        await expect(page.getByLabel("API Endpoint", { exact: true })).toHaveValue("https://localhost:8090");
      });

      test("saved endpoint reconnection uses the app prefix", async ({ page }) => {
        await mockRuntime(page, basePath);
        await page.addInitScript((endpoint) => {
          localStorage.setItem("clab-standalone-endpoints", JSON.stringify([endpoint]));
        }, savedEndpoint);
        await page.goto(appUrl);
        await expect(page.getByTestId("standalone-settings-button")).toBeVisible();
        await expect(page.locator("base")).toHaveAttribute("href", `${basePath}/`);
        await page.getByTestId("standalone-settings-button").click();
        await page.getByTestId("standalone-settings-nav-endpoints").click();
        await page.getByRole("button", { name: "Reconnect Saved endpoint", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Reconnect Endpoint" });
        await dialog.getByLabel("Password", { exact: true }).fill("test-password");
        const requestPromise = page.waitForRequest((request) => request.url().includes("/reconnect"));
        await dialog.getByRole("button", { name: "Reconnect", exact: true }).click();
        const request = await requestPromise;
        expect(new URL(request.url()).pathname).toBe(`${basePath}/auth/endpoints/${savedEndpoint.id}/reconnect`);
        await expect(dialog).not.toBeVisible();
      });

      test("detached terminal entrypoint sends API requests to the app base", async ({ page }) => {
        await mockRuntime(page, basePath);
        const target = { nodeName: "srl1", title: "srl1 SSH", protocol: "ssh" as const, endpointId: savedEndpoint.id };
        const terminalUrl = buildDetachedTerminalUrl(target, appUrl);
        expect(new URL(terminalUrl).pathname).toBe(`${basePath}/terminal.html`);
        const requestPromise = page.waitForRequest((request) => request.url().includes("/api/runtime/terminal-sessions"));
        await page.goto(terminalUrl);
        const request = await requestPromise;
        expect(new URL(request.url()).pathname).toBe(`${basePath}/api/runtime/terminal-sessions`);
      });

      test("Wireshark viewer and unload cleanup stay under the app base", async ({ page }) => {
        const capturePath = `${basePath}/api/runtime/capture/wireshark-vnc-sessions/capture-1`;
        await page.route("**/api/runtime/capture/**", async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname.endsWith("/ready")) {
            await route.fulfill({ json: { ready: true, url: mode === "production" ? `${capturePath}/vnc/` : undefined } });
          } else if (pathname.endsWith("/vnc/")) {
            await route.fulfill({ contentType: "text/html", body: "<p>Mock Wireshark viewer</p>" });
          } else {
            await route.fulfill({ json: { success: true } });
          }
        });
        const readinessPromise = page.waitForRequest((request) => request.url().includes("/ready"));
        await page.goto(`${appUrl}wireshark.html?sessionId=capture-1&endpointId=${savedEndpoint.id}`);
        expect(new URL((await readinessPromise).url()).pathname).toBe(`${capturePath}/ready`);
        await expect(page.frameLocator("iframe").getByText("Mock Wireshark viewer")).toBeVisible();
        const closePromise = page.waitForRequest((request) => request.url().includes("/close?"));
        await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
        expect(new URL((await closePromise).url()).pathname).toBe(`${capturePath}/close`);
      });
    });
  }
}
