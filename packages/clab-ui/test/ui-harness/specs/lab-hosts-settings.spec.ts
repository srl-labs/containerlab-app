import { test, expect, type Page } from "@playwright/test";

/** A lab host's card on the Lab Hosts page. */
const hostCard = (page: Page, label: string) =>
  page
    .locator(".MuiPaper-root")
    .filter({ has: page.getByText(label, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: `Remove ${label}` }) });

test("lists Local first, then the lab hosts, each with its status", async ({ page }) => {
  await page.goto("/settings.html?category=labHosts");
  await expect(page.getByRole("heading", { name: "Lab Hosts" })).toBeVisible();
  // The settings scope and the modified filters belong to the other pages.
  await expect(page.getByRole("combobox", { name: "Save settings to" })).toHaveCount(0);
  const labels = page.locator(".MuiPaper-root .MuiTypography-subtitle1");
  await expect(labels.first()).toHaveText("Local");
  await expect(hostCard(page, "Local")).toContainText("containerlab 0.78.0 is ready.");
  await expect(hostCard(page, "Local")).toContainText("CPU");
  await expect(hostCard(page, "lab1")).toContainText("Signed Out");
  await expect(hostCard(page, "lab1")).toContainText("https://lab1.example.com:8090");
});

test("signs in to a lab host, reports a wrong password, and signs out again", async ({ page }) => {
  await page.goto("/settings.html?category=labHosts");
  await page.getByRole("button", { name: "Sign in to lab1 again" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in to lab1" });
  await expect(dialog.getByLabel("Username")).toHaveValue("alice");
  await dialog.getByLabel("Password").fill("wrong");
  await dialog.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page.getByText("Invalid credentials")).toBeVisible();
  await dialog.getByLabel("Password").fill("secret");
  await dialog.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(hostCard(page, "lab1")).toContainText("Connected");

  await page.getByRole("button", { name: "Sign out of lab1" }).click();
  await expect(hostCard(page, "lab1")).toContainText("Signed Out");
});

test("adds a lab host only once its sign-in works", async ({ page }) => {
  await page.goto("/settings.html?category=labHosts");
  const form = page.locator(".MuiPaper-root").filter({ has: page.getByText("Add a lab host", { exact: true }) });
  await form.getByLabel("Lab host URL", { exact: true }).fill("https://lab2.example.com:8090");
  await form.getByLabel("Name", { exact: true }).fill("lab2");
  await form.getByLabel("Username", { exact: true }).fill("bob");
  await form.getByLabel("Password", { exact: true }).fill("wrong");
  await form.getByRole("button", { name: "Add Lab Host" }).click();
  await expect(page.getByText("Invalid credentials")).toBeVisible();
  await expect(hostCard(page, "lab2")).toHaveCount(0);

  await form.getByLabel("Password", { exact: true }).fill("secret");
  await form.getByRole("button", { name: "Add Lab Host" }).click();
  await expect(hostCard(page, "lab2")).toContainText("Connected");
  await expect(page.getByRole("navigation").getByRole("button", { name: /Lab Hosts/ })).toContainText("3");
});

test("hides Local and shows it again", async ({ page }) => {
  await page.goto("/settings.html?category=labHosts");
  await page.getByRole("button", { name: "Remove Local" }).click();
  const dialog = page.getByRole("dialog", { name: "Hide Local" });
  await expect(dialog).toContainText("Show Local brings them back.");
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(hostCard(page, "Local")).toHaveCount(0);

  await page.getByRole("button", { name: "Show Local" }).click();
  await expect(hostCard(page, "Local")).toContainText("Connected");
});
