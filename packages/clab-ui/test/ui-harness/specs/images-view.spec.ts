import fs from "node:fs";
import path from "node:path";

import { test, expect, type Locator, type Page } from "@playwright/test";

interface ImagesProbe {
  calls: string[];
  templatesChanged: number;
  uploaded: string[];
}

async function openImages(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/images.html?${query}`);
  await expect(page.getByTestId("images-view")).toBeVisible();
  return errors;
}

function calls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __IMAGES__: ImagesProbe }).__IMAGES__.calls);
}

function templatesChanged(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __IMAGES__: ImagesProbe }).__IMAGES__.templatesChanged);
}

/** The text input of a TextField whose test id sits on the input or on its wrapper. */
function field(page: Page, testId: string): Locator {
  return page.locator(`input[data-testid="${testId}"], [data-testid="${testId}"] input`).first();
}

function resultRow(page: Page, key: string): Locator {
  return page.getByTestId("images-result-row").and(page.locator(`[data-key="${key}"]`));
}

function templateRow(page: Page, name: string): Locator {
  return page.getByTestId("images-template-row").and(page.locator(`[data-name="${name}"]`));
}

async function search(page: Page, text: string) {
  await page.getByTestId("images-search-input").locator("input").or(page.locator('input[data-testid="images-search-input"]')).first().fill(text);
}

async function chooseOption(page: Page, selectTestId: string, option: string) {
  await page.getByTestId(selectTestId).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function openUpload(page: Page, fileName: string) {
  await page.getByTestId("images-upload-button").click();
  await expect(page.getByTestId("images-upload-dialog")).toBeVisible();
  await page.getByTestId("images-upload-input").setInputFiles({ name: fileName, mimeType: "application/octet-stream", buffer: Buffer.alloc(4096, 1) });
  await page.getByTestId("images-upload-start").click();
}

test.describe("Images view", () => {
  test("unavailable lists the settings that turn it on", async ({ page }) => {
    const errors = await openImages(page, "state=unavailable");
    const panel = page.getByTestId("images-unavailable");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("WEB_LOCAL_CLIMG_PATH");
    await expect(page.getByTestId("images-config-key")).toHaveText([
      "WEB_LOCAL_CLIMG_PATH",
      "WEB_LOCAL_CLIMG_CONFIG",
      "WEB_LOCAL_CLIMG_STATE",
      "WEB_LOCAL_CLIMG_USER",
      "WEB_LOCAL_CLIMG_HOME",
      "WEB_LOCAL_IMAGES_UPLOAD_MAX",
      "WEB_LOCAL_IMAGES_MAX_RUNNING",
      "WEB_LOCAL_IMAGES_MAX_QUEUED"
    ]);
    await expect(page.getByTestId("images-search-input")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a lab host without images offers no actions", async ({ page }) => {
    await openImages(page, "state=labhost");
    await expect(page.getByTestId("images-unavailable")).toContainText("needs a local lab host");
    await expect(page.getByTestId("images-config-key")).toHaveCount(0);
    for (const id of ["images-search-input", "images-pull-button", "images-upload-button", "images-sync-button", "images-results"]) {
      await expect(page.getByTestId(id)).toHaveCount(0);
    }
  });

  test("unavailable is discovered from the status error", async ({ page }) => {
    await openImages(page, "state=error-unavailable");
    await expect(page.getByTestId("images-unavailable")).toBeVisible();
    await expect(page.getByTestId("images-config-key")).toHaveCount(8);
    await expect(page.getByTestId("images-search-input")).toHaveCount(0);
    expect((await calls(page)).some((entry) => entry.startsWith("status"))).toBe(true);
  });

  test("ready shows health, templates, index and jobs", async ({ page }) => {
    const errors = await openImages(page);
    await expect(page.getByTestId("images-health-check")).toHaveCount(7);
    await expect(page.getByTestId("images-health-check").and(page.locator('[data-status="ok"]'))).toHaveCount(7);
    await expect(page.getByTestId("images-template-row")).toHaveCount(3);
    await expect(templateRow(page, "cisco-vios-159-3.M3")).toHaveAttribute("data-present", "true");
    await expect(templateRow(page, "arista-veos-4.32.0F")).toHaveAttribute("data-present", "false");
    await expect(templateRow(page, "srl")).toHaveAttribute("data-present", "unknown");
    await expect(templateRow(page, "srl")).toHaveAttribute("data-managed", "false");
    await expect(page.getByTestId("images-index-age")).toContainText("3h12m");
    await expect(page.getByTestId("images-job")).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test("search narrows the results and a space-named record is shown by #id", async ({ page }) => {
    await openImages(page);
    await expect(page.getByTestId("images-result-row")).toHaveCount(10);
    await search(page, "vios");
    await expect(page.getByTestId("images-result-row")).toHaveCount(3);
    await expect(resultRow(page, "labhub:vios-159-3.M3")).toBeVisible();
    await expect(resultRow(page, "labhub:vEOS-lab-4.32.0F")).toHaveCount(0);

    await resultRow(page, "labhub:Cisco IOSv L2 2020").click();
    await expect(page.getByTestId("images-details")).toContainText("Cisco IOSv L2 2020");
    await expect.poll(async () => (await calls(page)).some((entry) => entry.startsWith("show") && entry.includes("#77"))).toBe(true);
  });

  test("a filter narrows the results", async ({ page }) => {
    await openImages(page);
    await expect(page.getByTestId("images-result-row")).toHaveCount(10);
    await chooseOption(page, "images-filter-status", "built");
    await expect(page.getByTestId("images-result-row")).toHaveCount(1);
    await expect(resultRow(page, "labhub:vjunos-router-23.4R1")).toBeVisible();
  });

  test("empty search shows the empty state", async ({ page }) => {
    await openImages(page, "state=empty");
    await expect(page.getByTestId("images-empty")).toBeVisible();
    await expect(page.getByTestId("images-result-row")).toHaveCount(0);
  });

  test("pull asks for confirmation, then a job runs and succeeds", async ({ page }) => {
    await openImages(page);
    await search(page, "vios-159-3.M2");
    await resultRow(page, "labhub:vios-159-3.M2").click();
    await expect(page.getByTestId("images-details")).toBeVisible();
    await page.getByTestId("images-pull-button").click();
    await expect(page.getByTestId("images-pull-confirm")).toBeVisible();
    expect((await calls(page)).some((entry) => entry.startsWith("startJob"))).toBe(false);
    await page.getByTestId("images-pull-confirm-ok").click();

    await expect(page.getByTestId("images-job")).toHaveCount(4);
    const job = page.getByTestId("images-job").and(page.locator('[aria-label="Pull labhub:vios-159-3.M2"]'));
    await expect(job).toHaveAttribute("data-state", "running");
    await expect(job).toHaveAttribute("data-state", "succeeded", { timeout: 15000 });
    expect((await calls(page)).some((entry) => entry.startsWith("startJob") && entry.includes("vios-159-3.M2"))).toBe(true);
  });

  test("cancelling a running job ends it as cancelled", async ({ page }) => {
    await openImages(page);
    const running = page.getByTestId("images-job").and(page.locator('[data-state="running"]'));
    await expect(running).toHaveCount(1);
    await running.getByTestId("images-job-cancel").click();
    await expect(page.getByTestId("images-job").and(page.locator('[data-state="cancelled"]'))).toHaveCount(1);
    expect((await calls(page)).some((entry) => entry.startsWith("cancelJob"))).toBe(true);
  });

  test("every LabHub entry is listed with its vendor and folder; not buildable ones come last and cannot be pulled", async ({ page }) => {
    await openImages(page);
    const rows = page.getByTestId("images-result-row");
    await expect(rows).toHaveCount(10);
    const h3c = resultRow(page, "labhub:h3cvsr1k-7.1.064-R1362P12");
    await expect(h3c).toHaveAttribute("data-buildable", "false");
    await expect(h3c.getByTestId("images-result-vendor")).toHaveText("H3C");
    await expect(h3c.getByTestId("images-result-folder")).toHaveText("H3C/vSR");
    await expect(h3c).toContainText("Not buildable");
    await expect(rows.nth(8)).toHaveAttribute("data-buildable", "false");
    await expect(rows.nth(9)).toHaveAttribute("data-buildable", "false");
    await expect(rows.nth(7)).toHaveAttribute("data-buildable", "true");
    await h3c.click();
    await expect(page.getByTestId("images-pull-button")).toBeDisabled();
    expect((await calls(page)).some((entry) => entry.startsWith("search") && entry.includes('"all":true'))).toBe(true);
  });

  test("the vendor filter lists the index vendors, and the switch hides not buildable entries", async ({ page }) => {
    await openImages(page);
    await page.getByTestId("images-filter-vendor").click();
    await expect(page.getByRole("option")).toHaveText(["All", "Arista", "Cisco", "H3C", "Juniper", "Nokia"]);
    await page.getByRole("option", { name: "H3C", exact: true }).click();
    await expect(page.getByTestId("images-result-row")).toHaveCount(2);
    await page.getByTestId("images-include-unbuildable").click();
    await expect(page.getByTestId("images-empty")).toBeVisible();
    await page.getByTestId("images-include-unbuildable").click();
    await expect(page.getByTestId("images-result-row")).toHaveCount(2);
  });

  test("the running job is first and a queued job shows its place and can be cancelled", async ({ page }) => {
    await openImages(page);
    const jobs = page.getByTestId("images-job");
    await expect(jobs.first()).toHaveAttribute("data-state", "running");
    await expect(jobs.first().getByTestId("images-job-log")).toBeVisible();
    const queued = jobs.and(page.locator('[data-state="queued"]'));
    await expect(queued).toHaveCount(1);
    await expect(queued).toContainText("Queued · Next");
    await expect(queued.getByTestId("images-job-cancel")).toBeEnabled();
    await queued.getByTestId("images-job-cancel").click();
    await expect(jobs.and(page.locator('[data-state="cancelled"]'))).toHaveCount(1);
    await expect(jobs.first()).toHaveAttribute("data-state", "running");
  });

  test("upload shows progress, adds a local record and leads to build", async ({ page }) => {
    await openImages(page);
    await openUpload(page, "vEOS64-lab-4.32.1F.qcow2");
    const progress = page.getByTestId("images-upload-progress");
    await expect(progress).toBeVisible();
    await expect.poll(async () => Number(await progress.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(100);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __IMAGES__: ImagesProbe }).__IMAGES__.uploaded)).toEqual(["vEOS64-lab-4.32.1F.qcow2"]);
    if (await page.getByTestId("images-upload-dialog").isVisible()) await page.keyboard.press("Escape");

    await search(page, "vEOS64-lab-4.32.1F");
    const row = resultRow(page, "local:vEOS64-lab-4.32.1F.qcow2");
    await expect(row).toBeVisible();
    await row.click();
    await page.getByTestId("images-build-button").click();
    await expect(page.getByTestId("images-build-dialog")).toBeVisible();
    await expect(field(page, "images-build-kind")).toHaveValue("arista_veos");
    await expect(field(page, "images-build-version")).toHaveValue("4.32.1F");
  });

  test("build from a local record starts a build job", async ({ page }) => {
    await openImages(page);
    await resultRow(page, "local:vEOS64-lab-4.32.0F.qcow2").click();
    await page.getByTestId("images-build-button").click();
    await expect(page.getByTestId("images-build-dialog")).toBeVisible();
    await page.getByTestId("images-build-start").click();
    await expect(page.getByTestId("images-job").and(page.locator('[data-op="build"]'))).toHaveCount(2);
    expect((await calls(page)).some((entry) => entry.startsWith("startJob") && entry.includes('"op":"build"'))).toBe(true);
  });

  test("template removal is offered only for managed templates", async ({ page }) => {
    await openImages(page);
    await templateRow(page, "srl").click();
    await expect(page.getByTestId("images-details")).toBeVisible();
    await expect(page.getByTestId("images-template-remove")).toHaveCount(0);

    await templateRow(page, "arista-veos-4.32.0F").click();
    await expect(page.getByTestId("images-template-remove")).toBeVisible();
  });

  test("customized templates are marked, and the sync preview names the kept fields and the kept edited template", async ({ page }) => {
    await openImages(page);
    await expect(templateRow(page, "cisco-vios-159-3.M3")).toHaveAttribute("data-customized", "true");
    await expect(templateRow(page, "srl")).toHaveAttribute("data-customized", "false");
    await expect(page.getByTestId("images-template-customized")).toHaveCount(2);
    await expect(page.getByTestId("images-job").and(page.locator('[data-op="build"]'))).toContainText("kept your interfacePattern, icon");
    await page.getByTestId("images-sync-button").click();
    await expect(page.getByTestId("images-sync-change")).toHaveCount(3);
    await expect(page.getByTestId("images-sync-kept")).toHaveText("keeps your interfacePattern");
    const skipped = page.getByTestId("images-sync-skipped");
    await expect(skipped).toHaveCount(1);
    await expect(skipped).toContainText("arista-veos-4.32.0F");
    await expect(skipped).toContainText("image is missing");
  });

  test("sync previews three changes and applying syncs and reloads templates", async ({ page }) => {
    await openImages(page);
    await page.getByTestId("images-sync-button").click();
    const dialog = page.getByTestId("images-sync-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("images-sync-change")).toHaveCount(3);
    expect(await calls(page)).toContain("syncTemplates [true]");
    expect(await calls(page)).not.toContain("syncTemplates [false]");
    await page.getByTestId("images-sync-apply").click();
    await expect.poll(() => calls(page)).toContain("syncTemplates [false]");
    await expect.poll(() => templatesChanged(page)).toBeGreaterThan(0);
  });

  test("without KVM pulling is disabled but search still works", async ({ page }) => {
    await openImages(page, "state=nokvm");
    await expect(page.getByTestId("images-health-check").and(page.locator('[data-status="FAIL"]'))).toHaveCount(1);
    await search(page, "vios");
    await expect(page.getByTestId("images-result-row")).toHaveCount(3);
    await resultRow(page, "labhub:vios-159-3.M3").click();
    await expect(page.getByTestId("images-pull-button")).toBeDisabled();
    await expect(page.getByTestId("images-blocked-reason")).toContainText("/dev/kvm");
  });
});

const EVIDENCE_DIR = process.env.IMAGES_SCREENSHOTS_DIR ?? "";

test("screenshots", async ({ page }) => {
  test.skip(EVIDENCE_DIR === "", "set IMAGES_SCREENSHOTS_DIR to a directory to write the evidence PNGs");
  test.setTimeout(240000);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  // Dialogs fade in; wait for the transition so the capture shows the settled state.
  const shot = async (name: string, theme: string) => {
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}-${theme}.png`), fullPage: true });
  };

  for (const theme of ["light", "dark"]) {
    await openImages(page, `theme=${theme}`);
    await search(page, "vios");
    await expect(page.getByTestId("images-result-row")).toHaveCount(3);
    await resultRow(page, "labhub:vios-159-3.M3").click();
    await expect(page.getByTestId("images-details")).toContainText("vios-159-3.M3");
    await expect(page.getByTestId("images-details")).toContainText("Files (1)");
    await shot("images-ready", theme);

    await page.getByTestId("images-pull-button").click();
    await expect(page.getByTestId("images-pull-confirm")).toBeVisible();
    await shot("images-pull-confirm", theme);
    await page.getByTestId("images-pull-confirm-ok").click();
    await expect(page.getByTestId("images-job")).toHaveCount(4);
    await shot("images-jobs", theme);

    await page.reload();
    await expect(page.getByTestId("images-view")).toBeVisible();
    await page.getByTestId("images-upload-button").click();
    await page.getByTestId("images-upload-input").setInputFiles({ name: "vEOS64-lab-4.32.1F.qcow2", mimeType: "application/octet-stream", buffer: Buffer.alloc(4096, 1) });
    await page.getByTestId("images-upload-start").click();
    await expect.poll(async () => Number(await page.getByTestId("images-upload-progress").getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    await shot("images-upload", theme);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __IMAGES__: ImagesProbe }).__IMAGES__.uploaded.length)).toBe(1);
    if (await page.getByTestId("images-upload-dialog").isVisible()) await page.keyboard.press("Escape");

    await page.reload();
    await expect(page.getByTestId("images-view")).toBeVisible();
    await resultRow(page, "local:vEOS64-lab-4.32.0F.qcow2").click();
    await page.getByTestId("images-build-button").click();
    await expect(page.getByTestId("images-build-dialog")).toBeVisible();
    await shot("images-build", theme);
    await page.keyboard.press("Escape");

    await page.getByTestId("images-sync-button").click();
    await expect(page.getByTestId("images-sync-change")).toHaveCount(3);
    await shot("images-sync-preview", theme);

    await openImages(page, `theme=${theme}&state=unavailable`);
    await expect(page.getByTestId("images-unavailable")).toBeVisible();
    await shot("images-unavailable", theme);

    await openImages(page, `theme=${theme}&state=nokvm`);
    await expect(page.getByTestId("images-health-check").first()).toBeVisible();
    await resultRow(page, "labhub:vios-159-3.M3").click();
    await expect(page.getByTestId("images-blocked-reason")).toBeVisible();
    await shot("images-nokvm", theme);
  }
});
