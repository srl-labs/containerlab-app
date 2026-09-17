import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { createServer, preview, type ViteDevServer } from "vite";
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
        await expect(page.getByText("Saved endpoint", { exact: true })).toBeVisible();
        await expect(page.getByTestId("standalone-settings-button")).toBeVisible();
        await expect(page.locator("base")).toHaveAttribute("href", `${basePath}/`);
        await page.getByText("Saved endpoint", { exact: true }).click({ button: "right" });
        await page.getByRole("menuitem", { name: "Reconnect Endpoint", exact: true }).click();
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

test("built Pages app handles files and topology requests without a backend", async ({ page }) => {
  const server = await preview({
    configFile: false,
    root: webRoot,
    base: "/containerlab-app/",
    build: { outDir: "dist/pages" },
    preview: { host: "127.0.0.1", port: 0 }
  });
  try {
    const address = server.httpServer.address();
    if (address === null || typeof address === "string") throw new Error("Pages preview did not listen");
    const networkRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/(?:api|auth)\/|\/files(?:\?|$)/.test(new URL(request.url()).pathname)) networkRequests.push(request.url());
    });
    await page.goto(`http://127.0.0.1:${address.port}/containerlab-app/`);
    await expect(page.getByTestId("standalone-settings-button")).toBeVisible();
    const responses = await page.evaluate(async () => {
      const created = await fetch("/api/runtime/topology-file/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: "base-path.clab.yml" })
      });
      const topology: unknown = await created.json();
      if (typeof topology !== "object" || topology === null || !("topologyRef" in topology)) {
        throw new Error("Sandbox did not create a topology");
      }
      const session = await fetch("/api/topology/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topologyRef: topology.topologyRef })
      });
      const sessionPayload: unknown = await session.json();
      const files = await fetch("/files");
      const nodes = await fetch("/api/runtime/ui/custom-nodes");
      const filePayload: unknown = await files.json();
      const nodePayload: unknown = await nodes.json();
      return { files: filePayload, nodes: nodePayload, session: sessionPayload };
    });
    expect(Array.isArray(responses.files)).toBe(true);
    expect(responses.nodes).toHaveProperty("customNodes", expect.any(Array));
    expect(responses.session).toHaveProperty("sessionId", expect.any(String));
    expect(networkRequests).toEqual([]);
  } finally {
    await new Promise<void>((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
  }
});
