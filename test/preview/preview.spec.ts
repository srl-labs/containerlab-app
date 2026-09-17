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
  const created = await page.evaluate(async () => {
    const response = await fetch("/api/runtime/topology-file/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: "preview.clab.yml" })
    });
    return response.json();
  });
  expect(created).toHaveProperty("topologyRef");
  await page.reload();
  await expect(page.getByTestId("standalone-settings-button")).toBeVisible();
  const files = await page.evaluate(async () => (await fetch("/files")).json());
  expect(JSON.stringify(files)).toContain("preview.clab.yml");
  expect(failures).toEqual([]);
});
