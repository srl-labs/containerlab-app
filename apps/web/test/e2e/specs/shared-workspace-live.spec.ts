import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { setTimeout } from "node:timers/promises";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

// Opt in against a disposable API server with CLAB_SHARED_LABS_ROOT configured.
const envFile = process.env.CLAB_E2E_TEST_ENV;
const env = envFile ? parseEnv(readFileSync(envFile, "utf8")) : {};
// Authentication requests contain test credentials; do not record them.
test.use({ trace: "off", video: "off", viewport: { width: 1600, height: 1000 } });
test.skip(!envFile, "Set CLAB_E2E_TEST_ENV to the API server's tests_go/.env");

interface TopologyRef {
  topologyId: string;
  labName: string;
  yamlPath: string;
  absoluteYamlPath?: string;
  source: "standalone";
}
interface ConnectedUser { page: Page; endpointId: string }

async function connect(browser: Browser, username: string, password: string): Promise<ConnectedUser> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1000 } });
  context.setDefaultTimeout(20_000);
  await context.addInitScript(() => localStorage.setItem("clab-standalone-show-non-owned-labs", "false"));
  await context.addInitScript(() => {
    const events: unknown[] = [];
    Reflect.set(window, "sharedTestEvents", events);
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        if (!String(url).includes("/api/events")) return;
        this.addEventListener("message", (event) => {
          const payload = JSON.parse(event.data) as { type?: string };
          if (payload.type !== "interface-stats") events.push(payload);
        });
      }
    };
  });
  const page = await context.newPage();
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText;
    if (reason !== "net::ERR_ABORTED") console.warn("Browser request failed:", new URL(request.url()).pathname, reason);
  });
  await page.goto("https://localhost:5173/");
  await page.getByLabel("API Endpoint", { exact: true }).fill(env.API_URL);
  await page.getByLabel("Label", { exact: true }).fill("Lab server");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const added = page.waitForResponse((response) => response.url().endsWith("/auth/endpoints/add"));
  await page.getByRole("button", { name: "Add Endpoint", exact: true }).click();
  const response = await added;
  expect(response.status()).toBe(200);
  const endpoint = await response.json() as { id: string };
  await expect(page.getByTestId("standalone-settings-button")).toBeVisible();
  await page.getByRole("button", { name: "Expand Lab server", exact: true }).first().click();
  await page.getByRole("button", { name: "Expand Lab server", exact: true }).first().click();
  await expect(page.getByText("Shared labs", { exact: true })).toBeVisible();
  return { page, endpointId: endpoint.id };
}

async function appPost<T>(user: ConnectedUser, path: string, data: object): Promise<T> {
  const response = await user.page.request.post(`https://localhost:5173${path}`, {
    headers: { "x-endpoint-id": user.endpointId }, data: { ...data, endpointId: user.endpointId }, timeout: 180_000,
  });
  expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
  return await response.json() as T;
}

async function topologyFiles(user: ConnectedUser): Promise<Array<{ path: string; topologyRef: TopologyRef }>> {
  const response = await user.page.request.get("https://localhost:5173/files", { headers: { "x-endpoint-id": user.endpointId } });
  expect(response.status()).toBe(200);
  return await response.json() as Array<{ path: string; topologyRef: TopologyRef }>;
}

test("two users share the complete lab lifecycle and keep private files isolated", async ({ playwright }, testInfo) => {
  test.setTimeout(360_000);
  const suffix = randomBytes(3).toString("hex");
  const lab = `team-fabric-${suffix}`;
  const collaborator = `shareui${suffix}`;
  const password = randomBytes(20).toString("hex");
  const sharedDir = `@shared/${lab}`;
  const yamlPath = `${sharedDir}/${lab}.clab.yml`;
  const privatePath = `${lab}/${lab}.clab.yml`;
  const sessions: ConnectedUser[] = [];
  let browser: Browser | undefined;
  const clients: APIRequestContext[] = [];
  const login = async (username: string, secret: string) => {
    const client = await playwright.request.newContext({ baseURL: env.API_URL, ignoreHTTPSErrors: true });
    clients.push(client);
    const response = await client.post("/login", { data: { username, password: secret, sessionDuration: "1h" } });
    expect(response.status()).toBe(200);
    const body = await response.json() as { token: string };
    const authenticated = await playwright.request.newContext({ baseURL: env.API_URL, ignoreHTTPSErrors: true, extraHTTPHeaders: { Authorization: `Bearer ${body.token}` } });
    clients.push(authenticated);
    return authenticated;
  };
  const admin = await login(env.SUPERUSER_USER, env.SUPERUSER_PASS);
  const ownerApi = await login(env.APIUSER_USER, env.APIUSER_PASS);
  let collaboratorApi: APIRequestContext | undefined;
  let userCreated = false;
  const topology = [
    `name: ${lab}`, "topology:", "  defaults:", "    kind: linux", "    image: alpine:3", "    cmd: sleep infinity",
    "  nodes:", "    spine: {}", "    leaf1: {}", "    leaf2: {}", "  links:",
    "    - endpoints: [spine:eth1, leaf1:eth1]", "    - endpoints: [spine:eth2, leaf2:eth1]", "",
  ].join("\n");
  try {
    const created = await admin.post("/api/v1/users", { data: { username: collaborator, password, groups: [env.GOTEST_API_USER_GROUP ?? "clab_api"] } });
    expect(created.status()).toBe(201);
    userCreated = true;
    collaboratorApi = await login(collaborator, password);
    for (const [client, folder] of [[ownerApi, sharedDir], [collaboratorApi, lab]] as const) {
      expect((await client.post("/api/v1/labs/workspace/directory", { data: { path: folder } })).status()).toBe(200);
    }
    for (const [client, path] of [[ownerApi, yamlPath], [collaboratorApi, privatePath]] as const) {
      expect((await client.put(`/api/v1/labs/workspace/file?path=${encodeURIComponent(path)}`, { data: topology })).status()).toBe(200);
    }
    const annotations = { nodeAnnotations: [
      { id: "spine", position: { x: 400, y: 140 }, icon: "router" },
      { id: "leaf1", position: { x: 200, y: 380 }, icon: "router" },
      { id: "leaf2", position: { x: 600, y: 380 }, icon: "router" },
    ] };
    expect((await ownerApi.put(`/api/v1/labs/workspace/file?path=${encodeURIComponent(`${yamlPath}.annotations.json`)}`, { data: JSON.stringify(annotations) })).status()).toBe(200);
    const deployed = await ownerApi.post(`/api/v1/labs/${lab}/deploy?path=${encodeURIComponent(yamlPath)}`, { data: {}, timeout: 180_000 });
    expect(deployed.status(), await deployed.text()).toBe(200);
    // The browser and Docker share this test host. Let IPv6 address detection
    // settle before loading Vite's modules; runtime actions are tested live below.
    await setTimeout(5_000);
    browser = await playwright.chromium.launch();
    const owner = await connect(browser, env.APIUSER_USER, env.APIUSER_PASS);
    sessions.push(owner);
    const colleague = await connect(browser, collaborator, password);
    sessions.push(colleague);
    const ownerRef = (await topologyFiles(owner)).find((file) => file.path === yamlPath)!.topologyRef;
    const colleagueFiles = await topologyFiles(colleague);
    const colleagueRef = colleagueFiles.find((file) => file.path === yamlPath)!.topologyRef;
    expect(colleagueRef.absoluteYamlPath).toBeTruthy();
    expect(colleagueFiles.some((file) => file.path === privatePath)).toBe(true);
    expect((await topologyFiles(owner)).some((file) => file.path === privatePath)).toBe(false);

    const { page } = colleague;
    for (const label of ["Running Labs", "Undeployed Labs"]) {
      const expand = page.getByRole("button", { name: `Expand ${label}`, exact: true });
      if (await expand.count()) await expand.click();
    }
    await page.getByRole("button", { name: "Expand Shared labs", exact: true }).click();
    const labFolders = page.getByRole("button", { name: `Expand ${lab}`, exact: true });
    await expect(labFolders).toHaveCount(2);
    await labFolders.first().click();
    await expect(page.getByText(`${lab} (${env.APIUSER_USER})`, { exact: true })).toBeVisible({ timeout: 45_000 });
    const runningRow = page.locator('[data-explorer-node-row="true"]').filter({ hasText: `${lab} (${env.APIUSER_USER})` }).first();
    await expect(runningRow.getByLabel("Shared lab", { exact: true })).toBeVisible();
    await expect(page.getByText(`${lab}.clab.yml`, { exact: true }).first()).toBeVisible();
    const sessionRequest = page.waitForRequest((request) => request.url().endsWith("/api/topology/sessions") && request.method() === "POST");
    await runningRow.getByText(`${lab} (${env.APIUSER_USER})`, { exact: true }).click();
    const opened = (await sessionRequest).postDataJSON() as { mode: string; sourcePreference: string; topologyRef: TopologyRef };
    expect(opened.mode).toBe("edit");
    expect(opened.sourcePreference).toBe("api-file");
    expect(opened.topologyRef.yamlPath).toBe(yamlPath);
    await expect(page.locator('.react-flow__node[data-id="spine"]')).toBeVisible();
    await page.getByTestId("navbar-lock").click();
    await expect(page.getByText("Read-only — unlock lab to edit", { exact: true })).toHaveCount(0);
    const node = page.locator('.react-flow__node[data-id="leaf2"]');
    const bounds = (await node.boundingBox())!;
    const dragSaved = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/topology/command");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 - 40, bounds.y + bounds.height / 2 + 20, { steps: 10 });
    await page.mouse.up();
    expect((await (await dragSaved).json() as { type: string }).type).toBe("topology-host:ack");
    const savedAnnotations = await ownerApi.get(`/api/v1/labs/workspace/file?path=${encodeURIComponent(`${yamlPath}.annotations.json`)}`);
    const savedNodes = (await savedAnnotations.json() as { nodeAnnotations: Array<{ id: string; position: { x: number; y: number } }> }).nodeAnnotations;
    expect(savedNodes.find((entry) => entry.id === "leaf2")!.position.x).not.toBe(600);
    await page.mouse.move(950, 900);
    await page.screenshot({ path: testInfo.outputPath("shared-running-lab.png"), fullPage: true });
    const privateRef = colleagueFiles.find((file) => file.path === privatePath)!.topologyRef;
    const privateStatus = await appPost<{ running: boolean }>(colleague, "/api/lab/status", { topologyRef: privateRef });
    expect(privateStatus.running).toBe(false);
    const wrongSourceAction = await page.request.post("https://localhost:5173/api/lab/destroy", {
      headers: { "x-endpoint-id": colleague.endpointId }, data: { topologyRef: privateRef },
    });
    expect(wrongSourceAction.status()).toBe(409);

    // Reject stale edits even before the second editor consumes file events.
    const sessionA = await appPost<{ sessionId: string }>(owner, "/api/topology/sessions", { topologyRef: ownerRef, mode: "edit", deploymentState: "deployed" });
    const sessionB = await appPost<{ sessionId: string }>(colleague, "/api/topology/sessions", { topologyRef: colleagueRef, mode: "edit", deploymentState: "deployed" });
    const snapshotA = await appPost<{ snapshot: { revision: number } }>(owner, "/api/topology/snapshot", sessionA);
    const snapshotB = await appPost<{ snapshot: { revision: number } }>(colleague, "/api/topology/snapshot", sessionB);
    const command = { command: "savePositions", payload: [{ id: "leaf1", position: { x: 150, y: 400 } }] };
    const saved = await appPost<{ type: string }>(owner, "/api/topology/command", { ...sessionA, baseRevision: snapshotA.snapshot.revision, command });
    expect(saved.type).toBe("topology-host:ack");
    const stale = await appPost<{ type: string; reason: string }>(colleague, "/api/topology/command", { ...sessionB, baseRevision: snapshotB.snapshot.revision, command });
    expect(stale.type).toBe("topology-host:reject");
    expect(stale.reason).toBe("stale");
    await expect(page.locator('.react-flow__node[data-id="leaf1"]')).toHaveAttribute("style", /translate\(150px,\s*400px\)/, { timeout: 15_000 });
    const privateRead = await colleague.page.request.get(`https://localhost:5173/api/runtime/file-explorer/file?path=${encodeURIComponent(privatePath)}`, { headers: { "x-endpoint-id": colleague.endpointId } });
    expect((await privateRead.json() as { content: string }).content).toBe(topology);

    const newPath = `${sharedDir}/draft.clab.yml`;
    await page.locator('[data-explorer-node-row="true"]').filter({ has: page.getByText(lab, { exact: true }) }).first().click({ button: "right" });
    await page.getByTestId("context-menu").last().getByText("New Topology File", { exact: true }).click();
    const nestedDialog = page.getByRole("dialog", { name: "Create Topology File", exact: true });
    await expect(nestedDialog.getByRole("button", { name: "Shared", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(nestedDialog.getByLabel("Topology file name", { exact: true })).toHaveValue(`${lab}/new-lab.clab.yml`);
    await nestedDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByText("Shared labs", { exact: true }).click({ button: "right" });
    const menu = page.getByTestId("context-menu").last();
    await expect(menu.getByText("Delete", { exact: true })).toHaveCount(0);
    await expect(menu.getByText("Rename", { exact: true })).toHaveCount(0);
    await menu.getByText("New Topology File", { exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create Topology File", exact: true });
    await expect(dialog.getByRole("button", { name: "Shared", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByLabel("Topology file name", { exact: true })).toHaveValue("new-lab.clab.yml");
    await dialog.getByLabel("Topology file name", { exact: true }).fill(`${lab}/draft.clab.yml`);
    await expect(dialog).toContainText("Everyone signed in to this API server can edit, deploy, and destroy this lab.");
    await page.screenshot({ path: testInfo.outputPath("shared-create-lab.png"), fullPage: true });
    await dialog.screenshot({ path: testInfo.outputPath("shared-create-dialog.png") });
    const draftCreated = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/runtime/topology-file/create");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    const draftResponse = await draftCreated;
    expect(draftResponse.status()).toBe(200);
    const draft = await draftResponse.json() as { topologyRef: TopologyRef };
    expect(draft.topologyRef.yamlPath).toBe(newPath);
    expect((await ownerApi.get(`/api/v1/labs/workspace/file?path=${encodeURIComponent(newPath)}`)).status()).toBe(200);

    await page.getByRole("button", { name: "New Topology File", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Shared", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Personal", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByLabel("Topology file name", { exact: true })).toHaveValue("new-lab.clab.yml");
    const personalDraftPath = `${lab}/personal-draft.clab.yml`;
    await dialog.getByLabel("Topology file name", { exact: true }).fill(personalDraftPath);
    await expect(dialog).toContainText("Saved in your personal workspace.");
    await page.screenshot({ path: testInfo.outputPath("personal-create-lab.png"), fullPage: true });
    await dialog.screenshot({ path: testInfo.outputPath("personal-create-dialog.png") });
    const personalCreated = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/runtime/topology-file/create");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    const personalResponse = await personalCreated;
    expect(personalResponse.status()).toBe(200);
    expect((await personalResponse.json() as { topologyRef: TopologyRef }).topologyRef.yamlPath).toBe(personalDraftPath);
    expect((await collaboratorApi.get(`/api/v1/labs/workspace/file?path=${encodeURIComponent(personalDraftPath)}`)).status()).toBe(200);
    expect((await ownerApi.get(`/api/v1/labs/workspace/file?path=${encodeURIComponent(personalDraftPath)}`)).status()).toBe(404);

    const notesPath = `${sharedDir}/notes.txt`;
    expect((await ownerApi.put(`/api/v1/labs/workspace/file?path=${encodeURIComponent(notesPath)}`, { data: "Original notes" })).status()).toBe(200);
    const saveNotes = (user: ConnectedUser, content: string) => user.page.request.put(`https://localhost:5173/api/runtime/file-explorer/file?path=${encodeURIComponent(notesPath)}`, {
      headers: { "x-endpoint-id": user.endpointId }, data: { content, originalContent: "Original notes" },
    });
    expect((await saveNotes(owner, "Owner's update")).status()).toBe(200);
    const staleNotes = await saveNotes(colleague, "Colleague's update");
    expect(staleNotes.status()).toBe(409);
    expect(await staleNotes.text()).toContain("Your edits have been kept");

    const archive = await page.request.get(`https://localhost:5173/api/runtime/labs/archive?path=${encodeURIComponent(sharedDir)}&format=zip`, {
      headers: { "x-endpoint-id": colleague.endpointId },
    });
    expect(archive.status(), await archive.text()).toBe(200);
    expect((await archive.body()).readUInt32LE(0)).toBe(0x04034b50);

    await appPost(colleague, "/api/lab/apply", { topologyRef: colleagueRef, dryRun: true });
    await appPost(colleague, "/api/lab/redeploy", { topologyRef: colleagueRef });
    const inspected = await collaboratorApi.get(`/api/v1/labs/${lab}`);
    const containers = await inspected.json() as Array<{ owner: string }>;
    expect(containers).toHaveLength(3);
    expect(containers.every((container) => container.owner === env.APIUSER_USER)).toBe(true);
    await appPost(colleague, "/api/lab/destroy", { topologyRef: colleagueRef, cleanup: true });
    await expect(page.getByText(`${lab} (${env.APIUSER_USER})`, { exact: true })).toHaveCount(0, { timeout: 30_000 });
    expect((await ownerApi.get(`/api/v1/labs/workspace/file?path=${encodeURIComponent(yamlPath)}`)).status()).toBe(200);
    await expect(page.getByLabel("Shared lab", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Reconnect", exact: true })).toHaveCount(0);
    const sharedSourceRow = page.locator('[data-explorer-node-row="true"]')
      .filter({ has: page.getByLabel("Shared lab", { exact: true }) }).filter({ hasText: `${lab}.clab.yml` }).first();
    await sharedSourceRow.getByText(`${lab}.clab.yml`, { exact: true }).click();
    await expect(page.locator('.react-flow__node[data-id="spine"]')).toBeVisible();
    await page.mouse.move(950, 900);
    await page.screenshot({ path: testInfo.outputPath("shared-undeployed-lab.png"), fullPage: true });
  } catch (error) {
    for (const [index, user] of sessions.entries()) {
      await user.page.screenshot({ path: testInfo.outputPath(`shared-failure-${index}.png`), fullPage: true }).catch(() => {});
    }
    throw error;
  } finally {
    for (const [index, user] of sessions.entries()) {
      const events: unknown = await user.page.evaluate(() => Reflect.get(window, "sharedTestEvents")).catch(() => []);
      const eventPath = testInfo.outputPath(`runtime-events-${index}.json`);
      writeFileSync(eventPath, JSON.stringify(events, null, 2));
      await testInfo.attach(`runtime-events-${index}`, { path: eventPath, contentType: "application/json" });
    }
    for (const user of sessions) await user.page.context().close();
    await browser?.close();
    await admin.delete(`/api/v1/labs/${lab}?cleanup=true`, { timeout: 180_000 });
    await ownerApi.delete(`/api/v1/labs/workspace/file?path=${encodeURIComponent(sharedDir)}&recursive=true`);
    await collaboratorApi?.delete(`/api/v1/labs/workspace/file?path=${encodeURIComponent(lab)}&recursive=true`);
    if (userCreated) await admin.delete(`/api/v1/users/${collaborator}`);
    for (const client of clients) await client.dispose();
  }
});
