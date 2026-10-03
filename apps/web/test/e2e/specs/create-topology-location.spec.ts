import type { Page } from "@playwright/test";
import {
  connected,
  expect,
  mockStandaloneApi,
  seedEndpoints,
  test,
  waitForWorkspace
} from "@srl-labs/containerlab-test-kit/playwright";

const endpoints = [
  { id: "team", label: "Team server", url: "https://team.example" },
  { id: "personal", label: "Personal server", url: "https://personal.example" }
].map((endpoint) => connected({ ...endpoint, username: "tester", sessionDuration: "24h" }));

// Submissions are answered with 409 so the dialog stays open instead of opening an editor.
test.use({ allowedBrowserErrors: [/status of 409 \(Conflict\)/] });

async function setup(page: Page) {
  await seedEndpoints(page, endpoints);
  await mockStandaloneApi(page, { endpoints });
  await page.route("**/api/runtime/file-explorer/tree**", (route) => route.fulfill({
    json: route.request().headers()["x-endpoint-id"] === "team"
      ? [{ endpointId: "team", name: "@shared", path: "@shared", kind: "directory", hasChildren: false }]
      : []
  }));
  await page.goto("/");
  await waitForWorkspace(page);
}

async function openCreate(page: Page) {
  await page.getByRole("button", { name: "Create a lab", exact: true }).click();
  return page.getByRole("dialog", { name: "Create Topology File", exact: true });
}

test("location controls the submitted path and resets when the dialog is reopened", async ({ page }) => {
  await setup(page);
  const submissions: unknown[] = [];
  await page.route("**/api/runtime/topology-file/create", async (route) => {
    submissions.push(route.request().postDataJSON());
    // Stop before opening an editor; the live test covers successful persistence.
    await route.fulfill({ status: 409, json: { error: "Topology already exists." } });
  });
  let dialog = await openCreate(page);
  await expect(dialog.getByRole("button", { name: "Shared", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Personal", exact: true })).toHaveAttribute("aria-pressed", "true");
  const filename = dialog.getByLabel("Topology file name", { exact: true });
  const create = dialog.getByRole("button", { name: "Create", exact: true });
  for (const invalid of ["@shared/example", "./@shared/example", "../example", "/example"]) {
    await filename.fill(invalid);
    await expect(create).toBeDisabled();
    await filename.press("Enter");
  }
  expect(submissions).toHaveLength(0);
  await filename.fill("my-lab");
  await create.click();
  await expect.poll(() => submissions).toEqual([{ endpointId: "team", fileName: "my-lab.clab.yml" }]);
  dialog = await openCreate(page);
  await dialog.getByRole("button", { name: "Shared", exact: true }).click();
  await expect(dialog).toContainText("Everyone signed in to this API server can edit, deploy, and destroy this lab.");
  await dialog.getByLabel("Topology file name", { exact: true }).fill("team/demo.clab.yaml");
  await dialog.getByLabel("Topology file name", { exact: true }).press("Enter");
  await expect.poll(() => submissions).toEqual([
    { endpointId: "team", fileName: "my-lab.clab.yml" },
    { endpointId: "team", fileName: "@shared/team/demo.clab.yaml" }
  ]);
  dialog = await openCreate(page);
  await expect(dialog.getByRole("button", { name: "Personal", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByLabel("Topology file name", { exact: true })).toHaveValue("new-lab.clab.yml");
});

test("switching endpoints checks availability and resets sharing while retaining the filename", async ({ page }) => {
  await setup(page);
  const dialog = await openCreate(page);
  await dialog.getByRole("button", { name: "Shared", exact: true }).click();
  await dialog.getByLabel("Topology file name", { exact: true }).fill("keep-me.clab.yml");
  await dialog.getByRole("combobox", { name: "Endpoint", exact: true }).click();
  await page.getByRole("option", { name: /Personal server/ }).click();
  await expect(dialog.getByRole("button", { name: "Create", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Shared", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Personal", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByLabel("Topology file name", { exact: true })).toHaveValue("keep-me.clab.yml");
  await dialog.getByRole("combobox", { name: "Endpoint", exact: true }).click();
  await page.getByRole("option", { name: /Team server/ }).click();
  await expect(dialog.getByRole("button", { name: "Shared", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Personal", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("a delayed workspace response cannot enable sharing for a different endpoint", async ({ page }) => {
  await setup(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/runtime/file-explorer/tree**", async (route) => {
    if (route.request().headers()["x-endpoint-id"] !== "team") return route.fulfill({ json: [] });
    await gate;
    await route.fulfill({ json: [{ endpointId: "team", name: "@shared", path: "@shared", kind: "directory" }] });
  });
  try {
    const requested = page.waitForRequest("**/api/runtime/file-explorer/tree");
    const dialog = await openCreate(page);
    await requested;
    await expect(dialog.getByRole("button", { name: "Create", exact: true })).toBeDisabled();
    await dialog.getByRole("combobox", { name: "Endpoint", exact: true }).click();
    await page.getByRole("option", { name: /Personal server/ }).click();
    await expect(dialog.getByRole("button", { name: "Create", exact: true })).toBeEnabled();
    const completed = page.waitForResponse((response) => response.url().includes("file-explorer/tree") && response.request().headers()["x-endpoint-id"] === "team");
    release();
    await completed;
    await expect(dialog.getByRole("button", { name: "Shared", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Create", exact: true })).toBeEnabled();
  } finally {
    release();
  }
});

test("workspace lookup errors prevent creation until availability can be checked", async ({ page }) => {
  await setup(page);
  await page.route("**/api/runtime/file-explorer/tree**", (route) => route.fulfill({ status: 404, json: { error: "Workspace unavailable" } }));
  const dialog = await openCreate(page);
  await expect(dialog.getByRole("alert")).toContainText("Could not check available locations.");
  await expect(dialog.getByRole("button", { name: "Shared", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Create", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("reopening the dialog checks whether the shared workspace is still available", async ({ page }) => {
  await setup(page);
  let dialog = await openCreate(page);
  await dialog.getByRole("button", { name: "Shared", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.route("**/api/runtime/file-explorer/tree**", (route) => route.fulfill({ json: [] }));
  dialog = await openCreate(page);
  await expect(dialog).toContainText("Saved in your personal workspace.");
  await expect(dialog.getByRole("button", { name: "Shared", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Personal", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "Create", exact: true })).toBeEnabled();
});
