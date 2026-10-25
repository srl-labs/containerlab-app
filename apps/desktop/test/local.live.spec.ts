import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { localLabSteps } from "@srl-labs/containerlab-test-kit/playwright";

// Runs a real lab through the desktop app's "This computer" endpoint. Opt-in:
// it needs Linux, containerlab and Docker, so run with CLAB_E2E_LIVE=1.
test.skip(process.env.CLAB_E2E_LIVE !== "1", "set CLAB_E2E_LIVE=1 to run labs on this machine");

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const labName = `desktop-e2e-${process.pid}`;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("No port"))));
    });
  });
}

test.describe.configure({ mode: "serial" });

let app: ElectronApplication;
let page: Page;
let userData: string;
let workspace: string;

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), "clab-desktop-live-"));
  workspace = await mkdtemp(path.join(tmpdir(), "clab-desktop-workspace-"));
  app = await electron.launch({
    executablePath: String(createRequire(import.meta.url)("electron")),
    args: [desktopRoot, "--ozone-platform=x11", "--no-sandbox"],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: userData,
      CONTAINERLAB_DESKTOP_PORT: String(await freePort()),
      CONTAINERLAB_DESKTOP_WORKSPACE: workspace,
      CONTAINERLAB_WEB_CLIENT_ROOT: path.resolve(desktopRoot, "../web/dist/client")
    }
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  // Leave no lab behind when a step failed.
  await localLabSteps(page, labName)
    .cleanup()
    .catch(() => {});
  await app.close();
  await rm(userData, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

test("runs a lab on this computer without clab-api-server", async () => {
  test.setTimeout(300_000);
  const testInfo = test.info();
  // Like Local in VS Code, this computer is connected from the start: no sign-in page.
  await expect(page.getByTestId("workspace-rail").getByRole("button", { name: "Labs", exact: true })).toBeVisible({
    timeout: 30_000
  });
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("1-start.png") });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const response = await fetch("/auth/endpoints");
          const { endpoints } = (await response.json()) as { endpoints?: Array<{ kind: string; status: string }> };
          return endpoints?.find((endpoint) => endpoint.kind === "local")?.status;
        }),
      { timeout: 30_000 }
    )
    .toBe("connected");
  // The labs explorer shows this computer as its own root.
  const localRoot = page.getByText("This computer", { exact: true }).first();
  const openLabs = async () => {
    // A closed panel keeps its tree in the page, so ask the rail button instead.
    const labsButton = page.getByTestId("workspace-rail").getByRole("button", { name: "Labs", exact: true });
    if ((await labsButton.getAttribute("aria-expanded")) !== "true") await labsButton.click();
    await expect(labsButton).toHaveAttribute("aria-expanded", "true");
    await expect(localRoot).toBeVisible({ timeout: 30_000 });
  };
  await openLabs();

  const lab = localLabSteps(page, labName);
  expect(await lab.create()).toBe(true);
  const deploy = await lab.deploy();
  expect(deploy.status).toBe(200);
  expect(deploy.last).toEqual({ type: "done" });
  expect(deploy.logLines).toBeGreaterThan(0);
  expect(await lab.nodes()).toEqual(["n1", "n2"]);
  // Expand the endpoint and its running labs.
  await openLabs();
  const expandEndpoint = page.getByRole("button", { name: "Expand This computer" });
  if (await expandEndpoint.isVisible()) await expandEndpoint.click();
  const expandRunning = page.getByRole("button", { name: "Expand Running Labs" });
  if (await expandRunning.isVisible()) await expandRunning.click();
  // Running labs read "<lab> (<owner>)".
  await expect(page.getByText(`${labName} (`).first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("2-running-lab.png") });

  expect(await lab.openShell()).toBe(true);
  expect(await lab.planHasChanges()).toBe(false);
  const destroy = await lab.destroy();
  expect(destroy.last).toEqual({ type: "done" });
  expect(await lab.isRunning()).toBe(false);
});
