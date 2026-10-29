import { test, expect } from "@playwright/test";

const SCREENSHOTS = process.env.LAB_HOST_SCREENSHOTS;

test("adds a Kubernetes cluster with its kubeconfig context, checks it and edits it", async ({ page }) => {
  await page.goto("/settings.html?category=labHosts");
  const choices = page.getByRole("radiogroup", { name: "Where should labs run?" });
  await expect(choices.getByRole("radio")).toHaveText([/This computer/, /Kubernetes cluster/, /Lab server/]);
  // Local is listed, so a lab server is the first choice; the server form shows.
  await expect(choices.getByRole("radio", { name: "Lab server" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Lab host URL", { exact: true })).toBeVisible();

  await choices.getByRole("radio", { name: "Kubernetes cluster" }).click();
  if (SCREENSHOTS) {
    await page.getByRole("button", { name: "Add Kubernetes cluster…" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SCREENSHOTS}/ux-vscode-add-choices.png` });
  }
  await page.getByRole("button", { name: "Add Kubernetes cluster…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Kubernetes cluster" });
  if (SCREENSHOTS) {
    await expect(dialog.getByRole("combobox", { name: "Context" })).toHaveText(/kind-c9s-app/);
    await dialog.screenshot({ path: `${SCREENSHOTS}/ux-vscode-cluster-form.png` });
  }
  // The default kubeconfig's current context is picked.
  await expect(dialog.getByRole("combobox", { name: "Context" })).toHaveText(/kind-c9s-app/);
  await expect(dialog.getByText("Empty: the default, /home/alice/.kube/config")).toBeVisible();

  await dialog.getByRole("radio", { name: /One fixed namespace/ }).check();
  await dialog.getByLabel("Namespace", { exact: true }).fill("team-a");
  await dialog.getByRole("button", { name: "Check connection" }).click();
  const checks = dialog.getByTestId("lab-host-checks");
  await expect(checks.locator('li[data-status="failed"]')).toHaveCount(1);
  await expect(checks).toContainText(
    "kubectl create rolebinding clab-lab-editor-alice --clusterrole clabernetes-lab-editor --user alice -n team-a"
  );
  if (SCREENSHOTS) {
    await checks.scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: `${SCREENSHOTS}/ux-vscode-cluster-check.png` });
  }

  await dialog.getByRole("radio", { name: /One per lab/ }).check();
  await dialog.getByRole("button", { name: "Check connection" }).click();
  await expect(checks.locator('li[data-status="failed"]')).toHaveCount(0);
  await dialog.getByLabel("Name", { exact: true }).fill("Lab cluster");
  await dialog.getByRole("combobox", { name: "Port exposure" }).click();
  await page.getByRole("option", { name: "LoadBalancer" }).click();
  await expect(dialog.getByText("A load balancer address per node")).toBeVisible();
  await dialog.getByRole("button", { name: "Add cluster" }).click();
  await expect(dialog).toBeHidden();

  const card = page.getByTestId(/^lab-host-c9s-/);
  await expect(card.getByTestId("lab-host-subtitle")).toHaveText("Kubernetes · kind-c9s-app · one namespace per lab");
  if (SCREENSHOTS) {
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `${SCREENSHOTS}/ux-vscode-cluster-card.png` });
  }

  await card.getByRole("button", { name: "Check connection of Lab cluster" }).click();
  const checkDialog = page.getByRole("dialog", { name: "Check Lab cluster" });
  await expect(checkDialog.getByText("Everything is ready: labs can run here.")).toBeVisible();
  await checkDialog.getByRole("button", { name: "Close" }).click();

  await card.getByRole("button", { name: "Edit Lab cluster" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Lab cluster" });
  await expect(edit.getByRole("combobox", { name: "Port exposure" })).toHaveText(/LoadBalancer/);
  await edit.getByRole("button", { name: "Choose file…" }).click();
  await expect(edit.getByLabel("kubeconfig file")).toHaveValue("/home/alice/.kube/lab.yaml");
  await expect(edit.getByRole("combobox", { name: "Context" })).toHaveText(/lab-prod/);
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(card.getByTestId("lab-host-subtitle")).toHaveText("Kubernetes · lab-prod · one namespace per lab");
});
