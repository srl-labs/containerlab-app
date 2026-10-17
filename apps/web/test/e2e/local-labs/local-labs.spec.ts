import { expect, localLabSteps, test } from "@srl-labs/containerlab-test-kit/playwright";

// The web app with labs on its own host: no clab-api-server and no sign-in.
// Opt-in: start the app with WEB_LOCAL_LABS=true and set WEB_LOCAL_E2E_URL.
test.skip(
  (process.env.WEB_LOCAL_E2E_URL ?? "") === "",
  "set WEB_LOCAL_E2E_URL to a web app started with WEB_LOCAL_LABS=true"
);

const labName = `web-local-e2e-${process.pid}`;

test.afterEach(async ({ page }) => {
  await localLabSteps(page, labName)
    .cleanup()
    .catch(() => {});
});

test("runs a lab on the web app's host without signing in", async ({ page }) => {
  await page.goto("./");
  const labsButton = page.getByTestId("workspace-rail").getByRole("button", { name: "Labs", exact: true });
  await expect(labsButton).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In", exact: true })).toHaveCount(0);

  const label = await page.evaluate(async () => {
    const config: unknown = await (await fetch("api/config")).json();
    const local: unknown = typeof config === "object" && config !== null ? Reflect.get(config, "localEndpoint") : undefined;
    const value: unknown = typeof local === "object" && local !== null ? Reflect.get(local, "label") : undefined;
    return String(value);
  });
  if ((await labsButton.getAttribute("aria-expanded")) !== "true") await labsButton.click();
  await expect(page.getByText(label, { exact: true }).first()).toBeVisible();

  const lab = localLabSteps(page, labName);
  expect(await lab.create()).toBe(true);
  const deploy = await lab.deploy();
  expect(deploy.last).toEqual({ type: "done" });
  expect(await lab.nodes()).toEqual(["n1", "n2"]);
  const expandHost = page.getByRole("button", { name: `Expand ${label}` });
  if (await expandHost.isVisible()) await expandHost.click();
  const expandRunning = page.getByRole("button", { name: "Expand Running Labs" });
  if (await expandRunning.isVisible()) await expandRunning.click();
  await expect(page.getByRole("button", { name: `Expand ${labName}` })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("running-lab.png") });

  expect(await lab.openShell()).toBe(true);
  expect(await lab.planHasChanges()).toBe(false);
  expect((await lab.destroy()).last).toEqual({ type: "done" });
  expect(await lab.isRunning()).toBe(false);
});
