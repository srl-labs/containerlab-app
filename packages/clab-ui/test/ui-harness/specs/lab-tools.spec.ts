import { test, expect, type Page } from "@playwright/test";

interface PostedMessage {
  command?: string;
  data?: {
    fileName: string;
    request: { name: string; tiers: Array<{ count: number; kind?: string }>; images: Record<string, string> };
  };
}

async function postedMessages(page: Page): Promise<PostedMessage[]> {
  return page.evaluate(
    () => (window as { __CLAB_UI_HARNESS_MESSAGES__?: PostedMessage[] }).__CLAB_UI_HARNESS_MESSAGES__ ?? []
  );
}

/** Opens a lab tool dialog in the harness; its result lands in `window.__LAB_TOOL_RESULT__`. */
async function openDialog(page: Page, method: string, request: unknown): Promise<void> {
  await page.evaluate(
    ([name, payload]) => {
      const win = window as unknown as {
        __LAB_TOOL_DIALOGS__: Record<string, (request: unknown) => Promise<unknown>>;
        __LAB_TOOL_RESULT__?: unknown;
      };
      void win.__LAB_TOOL_DIALOGS__[name as string](payload).then((result) => {
        win.__LAB_TOOL_RESULT__ = result ?? null;
      });
    },
    [method, request] as const
  );
}

async function dialogResult(page: Page): Promise<unknown> {
  await page.waitForFunction(() => "__LAB_TOOL_RESULT__" in window);
  return page.evaluate(() => (window as { __LAB_TOOL_RESULT__?: unknown }).__LAB_TOOL_RESULT__);
}

test.describe("Clos generator", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/webviews.html?view=clos-generator&theme=dark-modern");
    await expect(page.getByTestId("clos-generator")).toBeVisible();
  });

  test("starts with a two-tier fabric and keeps the file name with the lab name", async ({ page }) => {
    await expect(page.getByTestId("clos-name")).toHaveValue("clos");
    await expect(page.getByTestId("clos-file-name")).toHaveValue("clos.clab.yml");
    await expect(page.getByTestId("clos-summary-nodes")).toHaveText("6 nodes");
    await expect(page.getByTestId("clos-summary-links")).toHaveText("8 links");

    await page.getByTestId("clos-name").fill("dc1");
    await expect(page.getByTestId("clos-file-name")).toHaveValue("dc1.clab.yml");
    await expect(page.getByTestId("clos-command")).toContainText(
      "containerlab generate --name dc1 --nodes 4:nokia_srlinux,2:nokia_srlinux"
    );
  });

  test("adds a tier of another kind with its own image and generates", async ({ page }) => {
    await page.getByTestId("clos-add-tier").click();
    await page.getByTestId("clos-tier-2-count").fill("3");
    await page.getByTestId("clos-tier-2-kind").fill("linux");
    await expect(page.getByTestId("clos-summary-nodes")).toHaveText("9 nodes");
    await expect(page.getByTestId("clos-summary-links")).toHaveText("14 links");
    await expect(page.getByTestId("clos-image-linux")).not.toHaveValue("");

    // A missing image blocks generating and says where.
    await page.getByTestId("clos-image-linux").fill("");
    await page.getByTestId("clos-generator-submit").click();
    await expect(page.getByText("Enter the image for this kind.")).toBeVisible();
    expect((await postedMessages(page)).filter((message) => message.command === "generate")).toHaveLength(0);

    await page.getByTestId("clos-image-linux").fill("alpine:3.20");
    await page.getByTestId("clos-generator-submit").click();
    await expect(page.getByTestId("clos-generator-submit")).toHaveText("Generating…");

    const generate = (await postedMessages(page)).find((message) => message.command === "generate");
    expect(generate?.data?.fileName).toBe("clos.clab.yml");
    expect(generate?.data?.request.tiers).toEqual([
      { count: 4, kind: "nokia_srlinux" },
      { count: 2, kind: "nokia_srlinux" },
      { count: 3, kind: "linux" }
    ]);
    expect(generate?.data?.request.images.linux).toBe("alpine:3.20");
  });

  test("shows the host's error and lets the user try again", async ({ page }) => {
    await page.getByTestId("clos-generator-submit").click();
    await page.evaluate(() =>
      window.postMessage({ command: "status", busy: false, error: "clos.clab.yml already exists." }, "*")
    );
    await expect(page.getByTestId("clos-generator-error")).toHaveText("clos.clab.yml already exists.");
    await expect(page.getByTestId("clos-generator-submit")).toBeEnabled();
  });
});

test.describe("Lab tool dialogs", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/webviews.html?view=lab-tool-dialogs&theme=dark-modern");
    await expect(page.getByTestId("lab-tool-dialogs-ready")).toBeAttached();
  });

  test("sshx can add a read-only link when the lab host offers it", async ({ page }) => {
    await openDialog(page, "promptForShareOptions", {
      tool: "sshx",
      action: "attach",
      labName: "demo",
      readersAvailable: true,
      credentialsAvailable: true
    });
    const dialog = page.getByTestId("share-options-dialog");
    await expect(dialog).toContainText("Share demo with sshx");
    await page.getByRole("checkbox", { name: "Also create a read-only link" }).check();
    await page.getByTestId("share-options-submit").click();
    expect(await dialogResult(page)).toEqual({ enableReaders: true });
  });

  test("sshx explains when the lab host cannot make read-only links", async ({ page }) => {
    await openDialog(page, "promptForShareOptions", {
      tool: "sshx",
      action: "reattach",
      labName: "demo",
      readersAvailable: false,
      credentialsAvailable: false
    });
    await expect(page.getByTestId("share-options-readers-unavailable")).toBeVisible();
    await page.getByTestId("share-options-submit").click();
    expect(await dialogResult(page)).toEqual({});
  });

  test("GoTTY checks credentials before sharing", async ({ page }) => {
    await openDialog(page, "promptForShareOptions", {
      tool: "gotty",
      action: "attach",
      labName: "demo",
      readersAvailable: true,
      credentialsAvailable: true
    });
    await page.getByTestId("share-options-custom-credentials").locator("input").check();
    await page.locator("#share-options-username").fill("lab");
    await page.locator("#share-options-password").fill("bad pass");
    await expect(page.getByTestId("share-options-submit")).toBeDisabled();
    await page.locator("#share-options-password").fill("S3cret!");
    await page.locator("#share-options-shell").fill("sh");
    await page.getByTestId("share-options-submit").click();
    expect(await dialogResult(page)).toEqual({ port: 8080, username: "lab", password: "S3cret!", shell: "sh" });
  });

  test("GoTTY keeps the default sign-in on older lab hosts", async ({ page }) => {
    await openDialog(page, "promptForShareOptions", {
      tool: "gotty",
      action: "attach",
      labName: "demo",
      readersAvailable: false,
      credentialsAvailable: false
    });
    await expect(page.getByTestId("share-options-credentials-unavailable")).toBeVisible();
    await expect(page.locator("#share-options-username")).toHaveCount(0);
  });

  test("share links show the read-only link next to the full one", async ({ page }) => {
    await openDialog(page, "showShareLinks", {
      title: "sshx session started",
      links: [
        { label: "Shared terminal", url: "https://sshx.io/s/abc#read,write" },
        { label: "Read-only link", url: "https://sshx.io/s/abc#read" }
      ],
      note: "Viewers can watch but not type."
    });
    await expect(page.getByTestId("share-link-1-url")).toHaveText("https://sshx.io/s/abc#read");
    await expect(page.getByRole("button", { name: "Copy Read-only link" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    expect(await dialogResult(page)).toBeNull();
  });

  test("an invalid topology shows containerlab's error", async ({ page }) => {
    await openDialog(page, "showValidationResult", {
      labName: "demo",
      valid: false,
      details: 'node "n1" references unknown kind "nope"'
    });
    await expect(page.getByTestId("validation-result-dialog")).toContainText("demo is not valid");
    await expect(page.getByTestId("validation-result-details")).toHaveText(
      'node "n1" references unknown kind "nope"'
    );
  });

  test("the generator dialog returns the lab host and request", async ({ page }) => {
    await page.evaluate(() => {
      const win = window as unknown as {
        __LAB_TOOL_DIALOGS__: {
          defaultClosDraft: (directory: string) => unknown;
          promptForGenerateTopology: (request: unknown) => Promise<unknown>;
        };
        __LAB_TOOL_RESULT__?: unknown;
      };
      const dialogs = win.__LAB_TOOL_DIALOGS__;
      void dialogs
        .promptForGenerateTopology({
          endpointOptions: [
            { value: "local", label: "This computer" },
            { value: "lab-host", label: "lab-host.example" }
          ],
          defaultEndpointId: "lab-host",
          initialDraft: dialogs.defaultClosDraft("labs")
        })
        .then((result) => {
          win.__LAB_TOOL_RESULT__ = result ?? null;
        });
    });
    await expect(page.getByTestId("clos-generator-dialog")).toBeVisible();
    await expect(page.getByTestId("clos-file-name")).toHaveValue("labs/clos.clab.yml");
    await page.getByTestId("clos-generator-submit").click();
    const result = (await dialogResult(page)) as { endpointId: string; fileName: string };
    expect(result.endpointId).toBe("lab-host");
    expect(result.fileName).toBe("labs/clos.clab.yml");
  });
});
