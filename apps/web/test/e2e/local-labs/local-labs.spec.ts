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
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);

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
  expect(await lab.resumeShell()).toEqual({ resumable: true, replayed: true, plainEndsOnDisconnect: true });
  expect(await lab.followsLogs()).toBe(true);
  expect(await lab.statsNodes()).toEqual(["n1", "n2"]);
  expect(await lab.planHasChanges()).toBe(false);
  expect((await lab.destroy()).last).toEqual({ type: "done" });
  expect(await lab.isRunning()).toBe(false);
});

test("a shell taken over by another tab can be taken back", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  const lab = localLabSteps(page, labName);
  expect(await lab.create()).toBe(true);
  expect((await lab.deploy()).last).toEqual({ type: "done" });
  const endpointId = await page.evaluate(async () => {
    const { endpoints } = (await (await fetch("auth/endpoints")).json()) as {
      endpoints: Array<{ id: string; kind: string }>;
    };
    return endpoints.find((entry) => entry.kind === "local")?.id ?? "";
  });
  const labUrl = `./?lab=${endpointId}::${labName}/${labName}.clab.yml`;

  await page.goto(labUrl);
  const node = page.locator('[data-id="n1"]');
  await expect(node).toBeAttached();
  // The node menu offers a shell once the canvas shows the node running.
  const shellItem = page.getByText("Shell", { exact: true });
  await expect(async () => {
    await page.keyboard.press("Escape");
    await node.click({ button: "right" });
    await expect(shellItem).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await shellItem.click();
  // The running lab matches its file once the canvas knows it runs.
  await expect(page.getByTestId("navbar-deploy")).toHaveAttribute(
    "aria-label",
    "Topology in sync — nothing to apply"
  );
  const readStoredTerminals = () => page.evaluate(() => sessionStorage.getItem("clab.workspace.terminals.v1") ?? "");
  await expect.poll(readStoredTerminals).toContain("terminalSessionId");

  // A duplicated tab carries the session storage and attaches to the same session.
  const second = await context.newPage();
  second.on("pageerror", (error) => errors.push(error.message));
  await second.addInitScript((value) => sessionStorage.setItem("clab.workspace.terminals.v1", value), await readStoredTerminals());
  await second.goto(labUrl);
  await expect(page.getByTestId("runtime-terminal-detached")).toBeVisible();

  await page.getByRole("button", { name: "Continue here" }).click();
  await expect(second.getByTestId("runtime-terminal-detached")).toBeVisible();
  await expect(page.getByTestId("runtime-terminal-detached")).toBeHidden();
  expect(errors).toEqual([]);
  await second.close();
  expect((await lab.destroy()).last).toEqual({ type: "done" });
});
