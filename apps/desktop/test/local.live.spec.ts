import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

// Runs a real lab through the desktop app's "This computer" endpoint. Opt-in:
// it needs Linux, containerlab and Docker, so run with CLAB_E2E_LIVE=1.
test.skip(process.env.CLAB_E2E_LIVE !== "1", "set CLAB_E2E_LIVE=1 to run labs on this machine");

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const labName = `desktop-e2e-${process.pid}`;
const topology = `name: ${labName}
topology:
  nodes:
    n1: { kind: linux, image: alpine:3 }
    n2: { kind: linux, image: alpine:3 }
  links:
    - endpoints: ["n1:eth1", "n2:eth1"]
`;

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
  await page
    .evaluate(async (labName) => {
      const { endpoints } = (await (await fetch("/auth/endpoints")).json()) as {
        endpoints: Array<{ id: string; kind: string }>;
      };
      const endpoint = endpoints.find((entry) => entry.kind === "local");
      if (!endpoint) return;
      const headers = { "Content-Type": "application/json", "x-endpoint-id": endpoint.id };
      const files = (await (await fetch("/files", { headers })).json()) as Array<{ labName: string; topologyRef: unknown }>;
      const topologyRef = files.find((entry) => entry.labName === labName)?.topologyRef;
      const labs = (await (await fetch("/api/runtime/inspect/all", { headers })).json()) as Record<string, unknown>;
      if (topologyRef && labName in labs) {
        await fetch("/api/lab/destroy", { method: "POST", headers, body: JSON.stringify({ topologyRef, cleanup: true }) });
      }
    }, labName)
    .catch(() => {});
  await app.close();
  await rm(userData, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

test("runs a lab on this computer without clab-api-server", async () => {
  test.setTimeout(300_000);
  const testInfo = test.info();
  const useLocal = page.getByRole("button", { name: "Use This Computer" });
  await expect(useLocal).toBeEnabled({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("1-add-endpoint.png") });
  await useLocal.click();
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
  // The labs explorer shows the local endpoint as its own root.
  const localRoot = page.getByText("This computer", { exact: true }).first();
  if (!(await localRoot.isVisible())) {
    await page.getByRole("button", { name: "Labs" }).click();
  }
  await expect(localRoot).toBeVisible({ timeout: 30_000 });

  // Each step runs in the app's page, with its session cookie.
  const api = <T>(step: string, args: Record<string, unknown> = {}) =>
    page.evaluate(
      async ({ step, args }) => {
        const json = async (response: Response) => {
          if (!response.ok) throw new Error(`${response.url}: ${response.status} ${await response.text()}`);
          return response.json() as Promise<any>;
        };
        const { endpoints } = await json(await fetch("/auth/endpoints"));
        const endpoint = endpoints.find((entry: { kind: string }) => entry.kind === "local");
        const headers = { "Content-Type": "application/json", "x-endpoint-id": endpoint.id };
        const labName = String(args.labName);
        const topologyRef = async () => {
          const files = await json(await fetch("/files", { headers }));
          return files.find((entry: { labName: string }) => entry.labName === labName)?.topologyRef;
        };
        const lifecycle = async (action: string, extra: Record<string, unknown> = {}) => {
          const response = await fetch(`/api/lab/${action}/stream`, {
            method: "POST",
            headers,
            body: JSON.stringify({ topologyRef: await topologyRef(), ...extra })
          });
          const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
          return { status: response.status, logLines: lines.length - 1, last: lines.at(-1) };
        };
        switch (step) {
          case "create":
            await json(
              await fetch("/api/runtime/file-explorer/directory", {
                method: "POST",
                headers,
                body: JSON.stringify({ path: labName })
              })
            );
            await json(
              await fetch(`/api/runtime/file-explorer/file?path=${labName}/${labName}.clab.yml`, {
                method: "PUT",
                headers,
                body: JSON.stringify({ content: args.topology })
              })
            );
            return Boolean(await topologyRef());
          case "deploy":
            return lifecycle("deploy");
          case "nodes": {
            const labs = await json(await fetch("/api/runtime/inspect/all", { headers }));
            return (labs[labName] ?? []).map((container: { nodeName: string }) => container.nodeName).sort();
          }
          case "terminal": {
            const session = await json(
              await fetch("/api/runtime/terminal-sessions", {
                method: "POST",
                headers,
                body: JSON.stringify({
                  topologyRef: await topologyRef(),
                  nodeName: "n1",
                  protocol: "shell",
                  cols: 100,
                  rows: 30
                })
              })
            );
            return new Promise<boolean>((resolve, reject) => {
              const socket = new WebSocket(
                `${location.origin.replace("http", "ws")}/api/runtime/terminal-sessions/${session.sessionId}/stream?endpointId=${endpoint.id}`
              );
              let output = "";
              const timer = setTimeout(() => reject(new Error(`no terminal output: ${output}`)), 30_000);
              socket.onmessage = (event) => {
                const message = JSON.parse(String(event.data));
                if (message.type === "ready") {
                  socket.send(JSON.stringify({ type: "input", data: "echo desktop-$((40+2))\r" }));
                }
                if (message.type === "output") {
                  output += atob(message.data);
                  if (output.includes("desktop-42")) {
                    clearTimeout(timer);
                    socket.send(JSON.stringify({ type: "input", data: "exit\r" }));
                    resolve(true);
                  }
                }
              };
            });
          }
          case "plan": {
            const plan = await json(
              await fetch("/api/lab/apply", {
                method: "POST",
                headers,
                body: JSON.stringify({ topologyRef: await topologyRef(), dryRun: true })
              })
            );
            return plan.changesPending;
          }
          case "destroy":
            return lifecycle("destroy", { cleanup: true });
          case "running": {
            const labs = await json(await fetch("/api/runtime/inspect/all", { headers }));
            return Object.keys(labs).includes(labName);
          }
        }
        throw new Error(`unknown step ${step}`);
      },
      { step, args: { labName, topology, ...args } }
    ) as Promise<T>;

  expect(await api<boolean>("create")).toBe(true);
  const deploy = await api<{ status: number; logLines: number; last: unknown }>("deploy");
  expect(deploy.status).toBe(200);
  expect(deploy.last).toEqual({ type: "done" });
  expect(deploy.logLines).toBeGreaterThan(0);
  expect(await api<string[]>("nodes")).toEqual(["n1", "n2"]);
  // Expand the endpoint and its running labs.
  const expandEndpoint = page.getByRole("button", { name: "Expand This computer" });
  if (await expandEndpoint.isVisible()) await expandEndpoint.click();
  const expandRunning = page.getByRole("button", { name: "Expand Running Labs" });
  if (await expandRunning.isVisible()) await expandRunning.click();
  // Running labs read "<lab> (<owner>)".
  await expect(page.getByText(`${labName} (`).first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("2-running-lab.png") });

  expect(await api<boolean>("terminal")).toBe(true);
  expect(await api<boolean>("plan")).toBe(false);
  const destroy = await api<{ last: unknown }>("destroy");
  expect(destroy.last).toEqual({ type: "done" });
  expect(await api<boolean>("running")).toBe(false);
});
