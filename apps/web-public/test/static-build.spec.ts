import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createTopologyFile, expect, test, waitForWorkspace } from "@srl-labs/containerlab-test-kit/playwright";
import { build, preview, type PreviewServer } from "vite";

const sandboxRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "/containerlab-app/";

test("the published build works at a subpath without any backend requests", async ({ page }) => {
  const outDir = await mkdtemp(path.join(tmpdir(), "clab-sandbox-build-"));
  let server: PreviewServer | undefined;
  try {
    // Build the current sandbox into a fresh directory; never reuse a prior output.
    await build({
      configFile: path.join(sandboxRoot, "vite.config.ts"),
      base: BASE,
      logLevel: "error",
      build: { outDir, emptyOutDir: true }
    });
    server = await preview({
      configFile: false,
      root: sandboxRoot,
      base: BASE,
      build: { outDir },
      preview: { host: "127.0.0.1", port: 0 }
    });
    const address = server.httpServer.address();
    if (address === null || typeof address === "string") throw new Error("Sandbox preview did not listen");
    const backendRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/(?:api|auth)\/|\/files(?:\?|$)/.test(new URL(request.url()).pathname)) backendRequests.push(request.url());
    });

    await page.goto(`http://127.0.0.1:${address.port}${BASE}`);
    await expect(page.locator(".startup-fallback img")).toHaveAttribute("src", `${BASE}clab-animated-no-logo.svg`);
    await waitForWorkspace(page);
    await createTopologyFile(page, "base-path", { fromEmptyState: true });
    await expect(page.locator(".react-flow")).toBeVisible();
    await page.getByTestId("navbar-split-view").click();
    await expect(page.locator(".monaco-editor .view-lines")).toContainText("name: base-path");
    expect(backendRequests).toEqual([]);
  } finally {
    const httpServer = server?.httpServer;
    if (httpServer) await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await rm(outDir, { recursive: true, force: true });
  }
});
