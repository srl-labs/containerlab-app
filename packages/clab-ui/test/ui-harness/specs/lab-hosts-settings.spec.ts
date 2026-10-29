import { test, expect, type Page } from "@playwright/test";

/** A lab host's card on its page. */
const hostCard = (page: Page, label: string) =>
  page
    .locator(".MuiPaper-root")
    .filter({ has: page.getByText(label, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: `Remove ${label}` }) });

const menu = (page: Page) => page.getByRole("navigation", { name: "Settings categories" });
/** A lab host's entry in the settings menu. */
const menuEntry = (page: Page, label: string) => menu(page).getByRole("button", { name: label, exact: true });

test("lists This computer first, then the lab hosts, each with its status", async ({ page }) => {
  await page.goto("/settings.html?category=labHosts");
  // The App group, the lab hosts, Add lab host, then About.
  const names = await menu(page)
    .getByRole("button")
    .evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")));
  expect(names).toEqual([
    "General",
    "Appearance",
    "Topology editor",
    "Terminal",
    "Capture",
    "This computer",
    "lab1",
    "Add lab host",
    "About"
  ]);
  await expect(menu(page)).toContainText("Lab hosts");
  await expect(menuEntry(page, "This computer").locator("[data-status]")).toHaveAttribute("data-status", "connected");
  await expect(menuEntry(page, "lab1").locator("[data-status]")).toHaveAttribute("data-status", "saved");
  await expect(menuEntry(page, "lab1")).toContainText("API Server");

  // "Lab Hosts" of earlier builds opens the first lab host's page.
  await expect(menuEntry(page, "This computer")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("lab-host-settings-page")).toHaveAttribute("data-kind", "this-computer");
  // The settings scope and the modified filters belong to the other pages.
  await expect(page.getByRole("combobox", { name: "Save settings to" })).toHaveCount(0);
  await expect(hostCard(page, "This computer")).toContainText("containerlab 0.78.0 is ready.");
  await expect(hostCard(page, "This computer")).toContainText("CPU");

  await menuEntry(page, "lab1").click();
  await expect(page.getByTestId("lab-host-settings-page")).toHaveAttribute("data-kind", "server");
  await expect(hostCard(page, "lab1")).toContainText("Signed Out");
  await expect(hostCard(page, "lab1")).toContainText("https://lab1.example.com:8090");
  await expect(hostCard(page, "This computer")).toHaveCount(0);
});

test("signs in to a lab host after a wrong password, and signs out again", async ({ page }) => {
  await page.goto("/settings.html?category=host:api-lab1");
  await page.getByRole("button", { name: "Sign in to lab1 again" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in to lab1" });
  await expect(dialog.getByLabel("Username")).toHaveValue("alice");
  await dialog.getByLabel("Password").fill("wrong");
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  // A wrong password keeps the dialog open, to try again.
  await expect(dialog.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Password").fill("secret");
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(hostCard(page, "lab1")).toContainText("Connected");
  await expect(menuEntry(page, "lab1").locator("[data-status]")).toHaveAttribute("data-status", "connected");

  await page.getByRole("button", { name: "Sign out of lab1" }).click();
  await expect(hostCard(page, "lab1")).toContainText("Signed Out");
  await expect(menuEntry(page, "lab1").locator("[data-status]")).toHaveAttribute("data-status", "saved");
});

test("reports a wrong password on a lab host's page", async ({ page }) => {
  await page.goto("/settings.html?category=host:api-lab1");
  await page.getByRole("button", { name: "Sign in to lab1 again" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in to lab1" });
  await dialog.getByLabel("Password").fill("wrong");
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Invalid credentials")).toBeVisible({ timeout: 3000 });
});

test("adds a lab host only once its sign-in works", async ({ page }) => {
  await page.goto("/settings.html?category=add");
  await expect(menuEntry(page, "Add lab host")).toHaveAttribute("aria-current", "page");
  // The page's title asks where labs should run; the form shows no heading of its own.
  await expect(page.getByRole("heading", { name: "Add lab host" })).toBeVisible();
  const form = page
    .locator(".MuiPaper-root")
    .filter({ has: page.getByRole("radiogroup", { name: "Where should labs run?" }) });
  await form.getByLabel("Lab host URL", { exact: true }).fill("https://lab2.example.com:8090");
  await form.getByLabel("Name", { exact: true }).fill("lab2");
  await form.getByLabel("Username", { exact: true }).fill("bob");
  await form.getByLabel("Password", { exact: true }).fill("wrong");
  await form.getByRole("button", { name: "Add lab host" }).click();
  await expect(page.getByText("Invalid credentials")).toBeVisible();
  await expect(menuEntry(page, "lab2")).toHaveCount(0);

  await form.getByLabel("Password", { exact: true }).fill("secret");
  await form.getByRole("button", { name: "Add lab host" }).click();
  await expect(menuEntry(page, "lab2").locator("[data-status]")).toHaveAttribute("data-status", "connected");
  await menuEntry(page, "lab2").click();
  await expect(hostCard(page, "lab2")).toContainText("Connected");
});

test("hides This computer and shows it again", async ({ page }) => {
  await page.goto("/settings.html?category=host:local");
  await page.getByRole("button", { name: "Remove This computer" }).click();
  const dialog = page.getByRole("dialog", { name: "Hide This computer" });
  await expect(dialog).toContainText("Show this computer brings them back.");
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(hostCard(page, "This computer")).toHaveCount(0);
  // Its page stays, since its settings still apply to Kubernetes lab hosts.
  const hidden = page.getByRole("alert").filter({ hasText: "This computer is hidden from the explorer." });
  await expect(hidden).toBeVisible();
  await expect(menuEntry(page, "This computer").locator("[data-status]")).toHaveAttribute("data-status", "saved");
  await expect(page.getByTestId("lab-host-setting-runtime")).toBeVisible();

  await hidden.getByRole("button", { name: "Show" }).click();
  await expect(hostCard(page, "This computer")).toContainText("Connected");
  await expect(menuEntry(page, "This computer").locator("[data-status]")).toHaveAttribute("data-status", "connected");
});

test("shows on each lab host's page what applies to its kind", async ({ page }) => {
  await page.goto("/settings.html?hosts=all&category=host:c9s-kind");
  const settings = page.getByTestId("lab-host-settings-page");
  await expect(settings).toHaveAttribute("data-kind", "cluster");

  // Kubernetes runs no Docker or Podman: Container runtime is greyed out with the reason.
  const runtime = settings.getByTestId("lab-host-setting-runtime");
  await expect(runtime).toHaveAttribute("data-access", "unsupported");
  await expect(runtime).toContainText("Container runtime");
  await expect(runtime).toContainText("Not on Kubernetes: the cluster runs the nodes as pods");
  await expect(runtime.getByRole("textbox", { name: "Container runtime" })).toBeDisabled();

  // A Timeout of its own shows as changed for this host, and Reset goes back to the default.
  const timeout = settings.getByTestId("lab-host-setting-timeout");
  await expect(timeout).toHaveAttribute("data-access", "edit");
  await expect(timeout.getByTestId("lab-host-setting-changed")).toHaveCount(0);
  const field = timeout.getByRole("textbox", { name: "Timeout" });
  await expect(field).toHaveAttribute("placeholder", "10m (containerlab default)");
  await field.fill("15m");
  await field.press("Enter");
  await expect(timeout.getByTestId("lab-host-setting-changed")).toHaveText("changed for this host");
  await expect(field).toHaveValue("15m");
  await timeout.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(timeout.getByTestId("lab-host-setting-changed")).toHaveCount(0);
  await expect(field).toHaveValue("");

  // A c9s API Server sets its namespaces; the page shows them read-only.
  await menuEntry(page, "localhost:18190").click();
  await expect(settings).toHaveAttribute("data-kind", "server");
  const namespaces = settings.getByTestId("lab-host-setting-namespaces");
  await expect(namespaces).toHaveAttribute("data-access", "server");
  await expect(namespaces).toContainText("Set by the API Server");
  const value = namespaces.getByTestId("lab-host-setting-namespaces-value").getByRole("textbox");
  await expect(value).toHaveValue("c9s-c9sdemo-{lab}");
  await expect(value).toBeDisabled();
});
