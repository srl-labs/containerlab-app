import { expect, test } from "@playwright/test";

test("docs, nested guides and the sandbox work in one static preview", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (new URL(response.url()).origin === origin && response.status() >= 400) {
      failures.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The GUI for containerlab.");
  await expect(page.locator("clab-topology")).toHaveAttribute("data-loaded", "true");
  await expect(page.frameLocator("clab-topology iframe").locator(".react-flow__node-topology-node")).toHaveCount(8);
  await expect(page.getByRole("link", { name: "Try the sandbox" })).toHaveJSProperty("href", `${origin}/sandbox/`);

  // Instant navigation must stay on the preview origin and retain working assets.
  await page.getByRole("link", { name: "Build your first lab" }).click();
  await expect(page).toHaveURL(`${origin}/getting-started/first-lab/`);
  await expect(page.locator("clab-topology")).toHaveAttribute("data-loaded", "true");
  await page.reload();
  await expect(page.frameLocator("clab-topology iframe").locator(".react-flow__node-topology-node")).toHaveCount(2);
  await page.getByText("Browser sandbox", { exact: true }).click();
  const sandboxLink = page.getByRole("link", { name: "sandbox", exact: true });
  await expect(sandboxLink).toHaveJSProperty("href", `${origin}/sandbox/`);
  await sandboxLink.click();
  await expect(page).toHaveURL(`${origin}/sandbox/`);
  await expect(page.getByTestId("standalone-settings-button")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("standalone-settings-button")).toBeVisible();

  // The sandbox must create and reopen files without a backend at its new path.
  await page.getByRole("button", { name: "New Topology File", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Topology file name" }).fill("preview.clab.yml");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();
  const tab = page.getByRole("tab", { name: "preview Close preview", exact: true });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(page.getByTestId("standalone-settings-button")).toBeVisible();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  expect(failures).toEqual([]);
});
