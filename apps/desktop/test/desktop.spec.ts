import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { expectNoBrowserErrors, watchBrowserErrors } from "@srl-labs/containerlab-test-kit/playwright";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("No port"))));
    });
  });
}

// CI sets DESKTOP_EXECUTABLE to the packaged app; locally the built main bundle runs in
// the workspace Electron against the web build.
function launchDesktop(userData: string, port: number): Promise<ElectronApplication> {
  const packaged = process.env.DESKTOP_EXECUTABLE;
  const env = { ...process.env, XDG_CONFIG_HOME: userData, CONTAINERLAB_DESKTOP_PORT: String(port) };
  if (packaged !== undefined) {
    return electron.launch({ executablePath: packaged, args: ["--ozone-platform=x11", "--no-sandbox"], env });
  }
  return electron.launch({
    executablePath: String(createRequire(import.meta.url)("electron")),
    args: [desktopRoot, "--ozone-platform=x11", "--no-sandbox"],
    env: { ...env, CONTAINERLAB_WEB_CLIENT_ROOT: path.resolve(desktopRoot, "../web/dist/client") }
  });
}

test.describe.configure({ mode: "serial" });

let app: ElectronApplication;
let mainWindow: Page;
let origin: string;
let userData: string;
let browserErrors: string[];

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), "clab-desktop-"));
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  app = await launchDesktop(userData, port);
  mainWindow = await app.firstWindow();
  browserErrors = watchBrowserErrors(mainWindow);
});

test.afterAll(async () => {
  await app.close();
  await rm(userData, { recursive: true, force: true });
});

test("serves the shared app from its own server", async () => {
  await expect(mainWindow.getByRole("heading", { name: "Add Endpoint", exact: true })).toBeVisible({ timeout: 30_000 });
  expect(new URL(mainWindow.url()).origin).toBe(origin);
  const logo = await mainWindow.locator(".startup-fallback img").getAttribute("src");
  expect(logo).toBeTruthy();
  expect(await mainWindow.evaluate(async (src) => (await fetch(src)).status, logo ?? "")).toBe(200);
  await expectNoBrowserErrors(browserErrors.splice(0), test.info());
});

test("the window is borderless with the page drawing its own title bar", async () => {
  const titlebar = mainWindow.locator(".clab-desktop-titlebar");
  await expect(titlebar).toContainText("Containerlab");
  await expect(titlebar).toHaveCSS("-webkit-app-region", "drag");
  const { strip, root } = await mainWindow.evaluate(() => ({
    strip: document.querySelector(".clab-desktop-titlebar")?.getBoundingClientRect().height,
    root: document.getElementById("root")?.getBoundingClientRect().top
  }));
  expect(strip).toBe(40);
  expect(root).toBe(40);

  if (process.platform !== "darwin") {
    // The native window controls are overlaid on the strip instead of a title bar.
    const overlay = await mainWindow.evaluate(() => {
      const controls = (navigator as Navigator & {
        windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect };
      }).windowControlsOverlay;
      return { visible: controls?.visible, height: controls?.getTitlebarAreaRect().height };
    });
    expect(overlay).toEqual({ visible: true, height: 40 });
  }
  await expectNoBrowserErrors(browserErrors.splice(0), test.info());
});

test("the main process ignores malformed window control colors", async () => {
  const calls = () =>
    app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const seen = Reflect.get(globalThis, "overlayCalls") as unknown[] | undefined;
      if (!seen) {
        const recorded: unknown[] = [];
        Reflect.set(globalThis, "overlayCalls", recorded);
        const original = win.setTitleBarOverlay.bind(win);
        win.setTitleBarOverlay = (options) => {
          recorded.push(options);
          original(options);
        };
      }
      return Reflect.get(globalThis, "overlayCalls") as unknown[];
    });
  await calls();
  await mainWindow.evaluate(() => {
    const bridge = Reflect.get(window, "containerlabDesktop") as { setTitleBarOverlay(options: unknown): void };
    bridge.setTitleBarOverlay({ color: "red", symbolColor: "#ffffff", height: 40 });
    bridge.setTitleBarOverlay({ color: "#101010", symbolColor: "#fafafa", height: 40 });
  });
  if (process.platform !== "darwin") {
    await expect.poll(calls).toHaveLength(1);
  }
});

test("text fields open the native edit menu", async () => {
  await app.evaluate(({ Menu }) => {
    const shown: string[][] = [];
    Reflect.set(globalThis, "shownMenus", shown);
    Menu.prototype.popup = function popup(this: Electron.Menu) {
      shown.push(this.items.map((item) => item.label || item.type));
    };
  });
  await mainWindow.getByLabel("Username", { exact: true }).click({ button: "right" });
  await expect
    .poll(() => app.evaluate(() => Reflect.get(globalThis, "shownMenus") as string[][]))
    .toEqual([["Undo", "Redo", "separator", "Cut", "Copy", "Paste", "Delete", "separator", "Select All"]]);
  await expectNoBrowserErrors(browserErrors.splice(0), test.info());
});

test("terminals open in app windows and only web links leave the app", async () => {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    Reflect.set(globalThis, "openedExternally", opened);
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
  const openedExternally = () => app.evaluate(() => Reflect.get(globalThis, "openedExternally") as string[]);

  const terminalWindow = app.waitForEvent("window");
  await mainWindow.evaluate(() => window.open("/terminal.html", "_blank"));
  const terminal = await terminalWindow;
  expect(new URL(terminal.url()).pathname).toBe("/terminal.html");
  await terminal.close();

  await mainWindow.evaluate(() => {
    window.open("https://containerlab.dev/", "_blank");
    window.open("smb://fileserver/share", "_blank");
  });
  await expect.poll(openedExternally).toEqual(["https://containerlab.dev/"]);

  await mainWindow.evaluate(() => {
    window.location.href = "https://example.com/";
  });
  await expect.poll(openedExternally).toEqual(["https://containerlab.dev/", "https://example.com/"]);
  expect(new URL(mainWindow.url()).origin).toBe(origin);
  expect(app.windows()).toHaveLength(1);
  await expectNoBrowserErrors(browserErrors.splice(0), test.info());
});
