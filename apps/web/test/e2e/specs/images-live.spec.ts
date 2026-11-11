import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { test, expect, type Locator, type Page } from "@playwright/test";

// Opt-in: runs the Images view against a server that is already running with climg configured
// (WEB_LOCAL_LABS=true, WEB_LOCAL_CLIMG_*), e.g.
//   IMAGES_LIVE_URL=https://localhost:3001 npx playwright test -c <config with testDir=specs> images-live.spec.ts
// IMAGES_LIVE_FULL=1 also runs the real pull and the real upload+build (minutes, needs docker/kvm).
// Env (required when IMAGES_LIVE_URL is set): IMAGES_LIVE_IMAGES_DIR (the server's climg images dir),
//      IMAGES_LIVE_WORKSPACE (the server's WEB_LOCAL_WORKSPACE).
// Optional: IMAGES_LIVE_NODES_FILE (default <workspace>/ui/custom-nodes.json), IMAGES_LIVE_CLIMG (default `climg` on PATH;
//      run with the server's CLIMG_CONFIG/CLIMG_STATE), IMAGES_LIVE_UPLOAD_SOURCE (a real image file for the build test).
const LIVE_URL = process.env.IMAGES_LIVE_URL ?? "";
const FULL = (process.env.IMAGES_LIVE_FULL ?? "") !== "";

function requiredEnv(name: string): string {
  const value = process.env[name] ?? "";
  if (value === "" && LIVE_URL !== "") throw new Error(`${name} must be set when IMAGES_LIVE_URL is set`);
  return value;
}

const IMAGES_DIR = requiredEnv("IMAGES_LIVE_IMAGES_DIR");
const WORKSPACE = requiredEnv("IMAGES_LIVE_WORKSPACE");
const NODES_FILE = process.env.IMAGES_LIVE_NODES_FILE ?? path.join(WORKSPACE, "ui/custom-nodes.json");
const UPLOAD_SOURCE = process.env.IMAGES_LIVE_UPLOAD_SOURCE ?? "";
const CLIMG = process.env.IMAGES_LIVE_CLIMG ?? "climg";
const SHOTS = process.env.IMAGES_LIVE_SHOTS ?? "";

test.skip(LIVE_URL === "", "set IMAGES_LIVE_URL to a running web app started with WEB_LOCAL_LABS=true and climg configured");
test.use({ baseURL: LIVE_URL, ignoreHTTPSErrors: true });
test.describe.configure({ mode: "serial" });

const LAB = `images-live-${process.pid}`;
const CANCEL_KEY = "labhub:asav-9-20-2"; // 363 MB, not cached: still downloading when cancelled
const PULL_KEY = process.env.IMAGES_LIVE_PULL_KEY ?? "labhub:vios-adventerprisek9-m.spa.159-3.m2";
const PULL_TEMPLATE = process.env.IMAGES_LIVE_PULL_TEMPLATE ?? "cisco-vios-159-3.m2";
const BUILT_TEMPLATE = "cisco-vios-L2-20190423"; // built by an earlier pull; removed and added back through the UI

function templateNames(): string[] {
  const raw = JSON.parse(fs.readFileSync(NODES_FILE, "utf8")) as Array<{ name: string }>;
  return raw.map((entry) => entry.name);
}

function resultRow(page: Page, key: string): Locator {
  return page.getByTestId("images-result-row").and(page.locator(`[data-key="${key}"]`));
}

function templateRow(page: Page, name: string): Locator {
  return page.getByTestId("images-template-row").and(page.locator(`[data-name="${name}"]`));
}

async function search(page: Page, text: string) {
  const input = page.locator('input[data-testid="images-search-input"]');
  await input.fill(text);
}

async function openImages(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await page.getByTestId("workspace-images-button").click();
  await expect(page.getByTestId("images-view")).toBeVisible();
  return errors;
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

function logTiming(label: string, started: number) {
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`TIMING ${label}: ${seconds} s`);
}

/** The Lab Palette lists Node Templates in a lab tab; open one so it can be read. */
async function openLabTab(page: Page) {
  await page.getByTestId("workspace-overview-button").click();
  await page.getByRole("button", { name: "New lab", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create topology file", exact: true });
  await dialog.getByLabel("Topology file name", { exact: true }).fill(LAB);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Node Templates", { exact: true }).first()).toBeVisible();
}

/** The text of the Node Template cards in the Lab Palette of the open lab tab. */
async function palette(page: Page): Promise<string> {
  await expect(page.getByText("Node Templates", { exact: true }).first()).toBeVisible();
  return (await page.locator("[draggable='true']").allInnerTexts()).join("\n");
}

async function startCancelPull(page: Page) {
  await search(page, "asav-9-20-2");
  await resultRow(page, CANCEL_KEY).click();
  await page.getByTestId("images-pull-button").click();
  await page.getByTestId("images-pull-confirm-ok").click();
}

test.afterAll(() => {
  // The scratch lab and the 5.2 upload are removed here; templates and images the tests add are removed by each test.
  fs.rmSync(path.join(WORKSPACE, LAB), { recursive: true, force: true });
  for (const name of fs.readdirSync(IMAGES_DIR)) if (name.startsWith("cisco_vios-L2-2019040")) fs.rmSync(path.join(IMAGES_DIR, name), { force: true });
});

test("Images view against the real climg", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openImages(page);

  await test.step("1. rail entry opens the view with the real doctor checks", async () => {
    await expect(page.getByTestId("images-health")).toBeVisible();
    const doctor = JSON.parse(spawnSync(CLIMG, ["doctor", "--json"], { encoding: "utf8" }).stdout) as Array<{ check: string; status: string }>;
    await expect(page.getByTestId("images-health-check")).toHaveCount(doctor.length);
    const shown = await page.getByTestId("images-health-check").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-status")));
    expect(shown.filter((status) => status === "FAIL").length).toBe(doctor.filter((entry) => entry.status === "FAIL").length);
    await shot(page, "live-ready");
  });

  await test.step("2. search finds vios", async () => {
    await search(page, "vios");
    await expect.poll(() => page.getByTestId("images-result-row").count()).toBeGreaterThanOrEqual(8);
    await expect(resultRow(page, "labhub:vios-adventerprisek9-m.SPA.159-3.M3")).toBeVisible();
    await shot(page, "live-search-vios");
  });

  await test.step("3. upload shows progress; the file is then cleaned up", async () => {
    const name = "cisco_vios-L2-20190401.qcow2";
    await page.getByTestId("images-upload-button").click();
    await expect(page.getByTestId("images-upload-dialog")).toBeVisible();
    await page.getByTestId("images-upload-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.alloc(8 * 1024 * 1024, 7) });
    await page.getByTestId("images-upload-start").click();
    await expect(page.getByTestId("images-upload-progress")).toBeVisible();
    await expect(page.getByTestId("images-upload-dialog")).toContainText(`Uploaded ${name}`);
    expect(fs.statSync(path.join(IMAGES_DIR, name)).size).toBe(8 * 1024 * 1024);
    await page.keyboard.press("Escape");
    await search(page, "L2-20190401");
    await expect(resultRow(page, `local:${name}`)).toBeVisible();
    fs.rmSync(path.join(IMAGES_DIR, name));
    await page.getByTestId("images-index-refresh").click().catch(() => {});
  });

  await test.step("4. a started job is cancelled and ends cancelled", async () => {
    await page.reload();
    await page.getByTestId("workspace-images-button").click();
    await expect(page.getByTestId("images-view")).toBeVisible();
    const pulls = page.getByTestId("images-job").and(page.locator('[data-op="pull"]'));
    const before = await pulls.count();
    await startCancelPull(page);
    await expect(pulls).toHaveCount(before + 1);
    const job = pulls.first();
    await expect(job.getByTestId("images-job-cancel")).toBeVisible();
    await expect(job).toHaveAttribute("data-state", /running|queued/);
    await job.getByTestId("images-job-cancel").click();
    await expect(job).toHaveAttribute("data-state", "cancelled", { timeout: 60_000 });
    await shot(page, "live-job-cancelled");
  });

  await test.step("5+6. a template is removed and added back; the Lab Palette shows both", async () => {
    await page.reload();
    await openLabTab(page);
    expect(await palette(page)).toContain(BUILT_TEMPLATE);

    await page.getByTestId("workspace-images-button").click();
    await expect(page.getByTestId("images-view")).toBeVisible();
    expect(templateNames()).toContain(BUILT_TEMPLATE);
    await templateRow(page, BUILT_TEMPLATE).click();
    await page.getByTestId("images-template-remove").click();
    await page.getByTestId("images-remove-confirm").click();
    await expect(templateRow(page, BUILT_TEMPLATE)).toHaveCount(0);
    expect(templateNames()).not.toContain(BUILT_TEMPLATE);
    await shot(page, "live-template-removed");
    await page.getByRole("tab", { name: LAB, exact: true }).click();
    await expect.poll(() => palette(page)).not.toContain(BUILT_TEMPLATE);
    await shot(page, "live-palette-removed");

    await page.getByTestId("workspace-images-button").click();
    await search(page, "viosl2-adventerprisek9-m.ssa.high_iron_20190423");
    await resultRow(page, "labhub:viosl2-adventerprisek9-m.ssa.high_iron_20190423").click();
    await page.getByTestId("images-template-add").click();
    await expect(templateRow(page, BUILT_TEMPLATE)).toBeVisible();
    expect(templateNames()).toContain(BUILT_TEMPLATE);
    await shot(page, "live-template-added");
    await page.getByRole("tab", { name: LAB, exact: true }).click();
    await expect.poll(() => palette(page)).toContain(BUILT_TEMPLATE);
    await shot(page, "live-palette-added");
  });

  expect(errors).toEqual([]);
});

test("5.3a: LabHub pull runs to the end and creates a Node Template", async ({ page }) => {
  test.skip(!FULL, "set IMAGES_LIVE_FULL=1: downloads and builds a real image");
  test.setTimeout(900_000);
  await openImages(page);
  expect(templateNames()).not.toContain(PULL_TEMPLATE);
  await search(page, PULL_KEY.replace("labhub:", ""));
  await resultRow(page, PULL_KEY).click();
  await page.getByTestId("images-pull-button").click();
  await page.getByTestId("images-pull-confirm-ok").click();
  const started = Date.now();
  const job = page.getByTestId("images-job").and(page.locator('[data-op="pull"]')).first();
  await expect(job).toHaveAttribute("data-state", "running");
  await shot(page, "live-pull-running");
  await expect(job).toHaveAttribute("data-state", "succeeded", { timeout: 800_000 });
  logTiming(`pull ${PULL_KEY}`, started);
  await expect(job).toContainText(`Node Template ${PULL_TEMPLATE} written`);
  await expect(templateRow(page, PULL_TEMPLATE)).toBeVisible();
  expect(templateNames()).toContain(PULL_TEMPLATE);
  await shot(page, "live-pull-done");
});

test("5.3b: upload then build ends as a Node Template", async ({ page }) => {
  test.skip(!FULL || UPLOAD_SOURCE === "", "set IMAGES_LIVE_FULL=1 and IMAGES_LIVE_UPLOAD_SOURCE=<real qcow2>");
  test.setTimeout(900_000);
  const name = "cisco_vios-L2-20190501.qcow2";
  const tpl = "cisco-vios-L2-20190501";
  await openImages(page);
  await page.getByTestId("images-upload-button").click();
  const up = Date.now();
  await page.getByTestId("images-upload-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: fs.readFileSync(UPLOAD_SOURCE) });
  await page.getByTestId("images-upload-start").click();
  await expect(page.getByTestId("images-upload-dialog")).toContainText(`Uploaded ${name}`, { timeout: 120_000 });
  logTiming("upload", up);
  await page.getByRole("button", { name: "Register and build…" }).click();
  const dialog = page.getByTestId("images-build-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator('input[data-testid="images-build-kind"], [data-testid="images-build-kind"] input').first()).toHaveValue("cisco_vios");
  await expect(page.locator('input[data-testid="images-build-version"]')).toHaveValue("L2-20190501");
  await shot(page, "live-build-dialog");
  await page.getByTestId("images-build-start").click();
  const started = Date.now();
  const job = page.getByTestId("images-job").and(page.locator('[data-op="build"]')).first();
  await expect(job).toHaveAttribute("data-state", "succeeded", { timeout: 800_000 });
  logTiming("build", started);
  await expect(job).toContainText(`Node Template ${tpl} written`);
  await expect(templateRow(page, tpl)).toBeVisible();
  expect(templateNames()).toContain(tpl);
  await shot(page, "live-build-done");
});
