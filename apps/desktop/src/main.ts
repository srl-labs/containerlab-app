import {
  app as electronApp,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  shell,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents
} from "electron";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";

import { createContainerlabAppServer, parseBooleanEnv } from "@srl-labs/containerlab-app-server";

import {
  buildEditMenu,
  decideNavigation,
  decideWindowOpen,
  isAllowedExternalUrl,
  parsePortEnv,
  type EditMenuAction,
  type EditMenuEntry
} from "./desktopPolicy.ts";

const APP_NAME = "Containerlab";
const DEFAULT_CLAB_API_URL = process.env.CLAB_API_URL ?? "https://localhost:8090";
const DEFAULT_DESKTOP_PORT = 32180;
const SHUTDOWN_TIMEOUT_MS = 3_000;

electronApp.setName(APP_NAME);

// Edit menu roles are what bind Cmd/Ctrl+C/V/X (null menu removes them).
function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [];
  if (process.platform === "darwin") {
    template.push({ role: "appMenu" });
  }
  template.push({ role: "editMenu" });
  if (process.platform === "darwin") {
    template.push({ role: "windowMenu" });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

installApplicationMenu();

function isAddressInUse(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  return (error as { code?: unknown }).code === "EADDRINUSE";
}

function firstExistingDirectory(candidates: string[]): string | undefined {
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
}

function firstExistingFile(candidates: string[]): string | undefined {
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function resolveStaticClientRoot(): string {
  if (process.env.CONTAINERLAB_WEB_CLIENT_ROOT?.trim()) {
    return path.resolve(process.env.CONTAINERLAB_WEB_CLIENT_ROOT.trim());
  }

  const candidates = [
    path.resolve(process.resourcesPath, "web-client"),
    path.resolve(electronApp.getAppPath(), "apps/web/dist/client"),
    path.resolve(process.cwd(), "../web/dist/client"),
    path.resolve(process.cwd(), "apps/web/dist/client")
  ];
  return firstExistingDirectory(candidates) ?? candidates[0];
}

function resolveWindowIcon(): string | undefined {
  const candidates =
    process.platform === "win32"
      ? [
          path.resolve(process.resourcesPath, "containerlab.ico"),
          path.resolve(electronApp.getAppPath(), "resources/containerlab.ico"),
          path.resolve(process.cwd(), "resources/containerlab.ico"),
          path.resolve(process.cwd(), "../desktop/resources/containerlab.ico")
        ]
      : [];

  return firstExistingFile([
    ...candidates,
    path.resolve(process.resourcesPath, "containerlab.png"),
    path.resolve(electronApp.getAppPath(), "apps/web/resources/containerlab.png"),
    path.resolve(process.cwd(), "../web/resources/containerlab.png"),
    path.resolve(process.cwd(), "apps/web/resources/containerlab.png")
  ]);
}

function resolveSessionPersistenceFile(): string {
  return path.join(electronApp.getPath("userData"), "endpoint-sessions.json");
}

let appServer: FastifyInstance | null = null;
let mainWindow: BrowserWindow | null = null;
const captureWindows = new Set<BrowserWindow>();
const terminalWindows = new Set<BrowserWindow>();
let isQuitting = false;

function openExternalUrl(rawUrl: string): void {
  if (isAllowedExternalUrl(rawUrl)) {
    void shell.openExternal(rawUrl);
  }
}

const SELECTABLE_SELECTOR =
  "input, textarea, select, [contenteditable]:not([contenteditable='false']), pre, code";

// Avoid selecting random labels; only real text surfaces.
const SELECTION_GUARD_CSS = `
  body { -webkit-user-select: none !important; user-select: none !important; }
  body :is(${SELECTABLE_SELECTOR}),
  body :is(${SELECTABLE_SELECTOR}) * {
    -webkit-user-select: text !important; user-select: text !important;
  }
`;

function runEditMenuAction(
  webContents: WebContents,
  action: EditMenuAction,
  linkURL: string,
  point: { x: number; y: number }
): void {
  webContents.focus();
  const selectAtPoint = `(() => {
    const el = document.elementFromPoint(${point.x}, ${point.y});
    const block = el && el.closest(${JSON.stringify(SELECTABLE_SELECTOR)});
    if (!block) return false;
    if (block.tagName === "TEXTAREA" || block.tagName === "INPUT") {
      block.focus(); block.select(); return true;
    }
    const range = document.createRange();
    range.selectNodeContents(block);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  })()`;

  switch (action) {
    case "undo":
      webContents.undo();
      break;
    case "redo":
      webContents.redo();
      break;
    case "cut":
      webContents.cut();
      break;
    case "copy":
      webContents.copy();
      break;
    case "paste":
      webContents.paste();
      break;
    case "delete":
      webContents.delete();
      break;
    case "selectAll":
      void webContents
        .executeJavaScript(selectAtPoint, true)
        .then((selected: unknown) => {
          if (selected !== true) webContents.selectAll();
        })
        .catch(() => webContents.selectAll());
      break;
    case "openLink":
      openExternalUrl(linkURL);
      break;
    case "copyLink":
      void clipboard.writeText(linkURL);
      break;
  }
}

function isOverSelectableText(
  webContents: WebContents,
  point: { x: number; y: number }
): Promise<boolean> {
  return webContents
    .executeJavaScript(
      `(() => {
        const el = document.elementFromPoint(${point.x}, ${point.y});
        return Boolean(el && el.closest(${JSON.stringify(SELECTABLE_SELECTOR)}));
      })()`,
      true
    )
    .then((result: unknown) => result === true)
    .catch(() => false);
}

function showEditContextMenu(
  window: BrowserWindow,
  params: ContextMenuParams,
  entries: EditMenuEntry[]
): void {
  const point = { x: params.x, y: params.y };
  const template = entries.map<MenuItemConstructorOptions>((entry) =>
    "id" in entry
      ? {
          ...entry,
          click: () => {
            runEditMenuAction(window.webContents, entry.id, params.linkURL, point);
          }
        }
      : entry
  );
  // Keyboard invocation anchors the menu at the focused element, not the pointer.
  const position = params.menuSourceType === "keyboard" ? point : {};
  Menu.buildFromTemplate(template).popup({
    window,
    frame: params.frame ?? undefined,
    sourceType: params.menuSourceType,
    ...position
  });
}

function applyDesktopPageChrome(window: BrowserWindow): void {
  const inject = (): void => {
    void window.webContents.insertCSS(SELECTION_GUARD_CSS).catch(() => undefined);
  };
  window.webContents.on("dom-ready", inject);
  window.webContents.on("did-finish-load", inject);

  window.webContents.on("context-menu", (_event, params) => {
    void (async () => {
      let entries = buildEditMenu(params);
      if (entries.length === 0 && (await isOverSelectableText(window.webContents, params))) {
        entries = buildEditMenu(params, true);
      }
      if (entries.length > 0 && !window.isDestroyed()) {
        showEditContextMenu(window, params, entries);
      }
    })();
  });
}

function applyNavigationPolicy(window: BrowserWindow, serverOrigin: string): void {
  applyDesktopPageChrome(window);
  window.webContents.on("will-navigate", (event, url) => {
    const decision = decideNavigation(url, serverOrigin);
    if (decision === "allow") {
      return;
    }
    event.preventDefault();
    if (decision === "external") {
      openExternalUrl(url);
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    switch (decideWindowOpen(url, serverOrigin)) {
      case "wireshark":
        openWiresharkCaptureWindow(url, serverOrigin);
        break;
      case "terminal":
        openTerminalWindow(url, serverOrigin);
        break;
      case "external":
        openExternalUrl(url);
        break;
      case "block":
        break;
    }
    return { action: "deny" };
  });
}

function openWiresharkCaptureWindow(url: string, serverOrigin: string): void {
  const icon = resolveWindowIcon();
  const captureWindow = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: "#07111f",
    center: true,
    height: 820,
    icon,
    minHeight: 560,
    minWidth: 860,
    parent: mainWindow ?? undefined,
    show: false,
    title: "Wireshark Capture",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    width: 1180
  });

  captureWindows.add(captureWindow);
  applyNavigationPolicy(captureWindow, serverOrigin);
  captureWindow.once("ready-to-show", () => {
    captureWindow.show();
  });
  captureWindow.on("closed", () => {
    captureWindows.delete(captureWindow);
  });
  captureWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    captureWindow.setTitle("Wireshark Capture");
  });

  void captureWindow.loadURL(url);
}

function openTerminalWindow(url: string, serverOrigin: string): void {
  const icon = resolveWindowIcon();
  const terminalWindow = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: "#07111f",
    center: true,
    height: 720,
    icon,
    minHeight: 360,
    minWidth: 640,
    parent: mainWindow ?? undefined,
    show: false,
    title: "Containerlab Terminal",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    width: 1000
  });

  terminalWindows.add(terminalWindow);
  applyNavigationPolicy(terminalWindow, serverOrigin);
  terminalWindow.once("ready-to-show", () => {
    terminalWindow.show();
  });
  terminalWindow.on("closed", () => {
    terminalWindows.delete(terminalWindow);
  });

  void terminalWindow.loadURL(url);
}

async function startLocalAppServer(): Promise<string> {
  const server = await createContainerlabAppServer({
    defaultClabApiUrl: DEFAULT_CLAB_API_URL,
    isDev: false,
    logger: parseBooleanEnv(process.env.CONTAINERLAB_DESKTOP_DEBUG, false),
    sessionPersistenceFile: resolveSessionPersistenceFile(),
    staticClientRoot: resolveStaticClientRoot()
  });
  const preferredPort = parsePortEnv(process.env.CONTAINERLAB_DESKTOP_PORT, DEFAULT_DESKTOP_PORT);
  try {
    await server.listen({ host: "127.0.0.1", port: preferredPort });
  } catch (error) {
    if (!isAddressInUse(error)) {
      throw error;
    }
    await server.listen({ host: "127.0.0.1", port: 0 });
  }

  appServer = server;
  const address = server.server.address() as AddressInfo | null;
  if (!address || typeof address.port !== "number") {
    throw new Error("Containerlab desktop app server did not expose a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function createMainWindow(): Promise<void> {
  const serverUrl = await startLocalAppServer();
  const serverOrigin = new URL(serverUrl).origin;
  const icon = resolveWindowIcon();

  mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: "#07111f",
    center: true,
    height: 900,
    icon,
    minHeight: 640,
    minWidth: 960,
    show: false,
    title: APP_NAME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    width: 1280
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow?.setTitle(APP_NAME);
  });
  applyNavigationPolicy(mainWindow, serverOrigin);

  await mainWindow.loadURL(serverUrl);
}

async function stopLocalAppServer(): Promise<void> {
  const server = appServer;
  appServer = null;
  if (server) {
    const closePromise = server.close().catch(() => undefined);
    await Promise.race([
      closePromise,
      new Promise<void>((resolve) => {
        setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
      })
    ]);
  }
}

function destroyAllWindows(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
}

function beginGracefulShutdown(exitCode = 0): void {
  if (isQuitting) {
    return;
  }
  isQuitting = true;
  destroyAllWindows();
  void stopLocalAppServer().finally(() => {
    electronApp.exit(exitCode);
  });
}

electronApp.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electronApp.quit();
  }
});

electronApp.on("activate", () => {
  if (!mainWindow) {
    void createMainWindow();
  }
});

electronApp.on("before-quit", (event) => {
  if (!appServer || isQuitting) {
    return;
  }
  event.preventDefault();
  beginGracefulShutdown();
});

process.once("SIGINT", () => {
  beginGracefulShutdown();
});

process.once("SIGTERM", () => {
  beginGracefulShutdown();
});

const singleInstanceLock = electronApp.requestSingleInstanceLock();
if (!singleInstanceLock) {
  electronApp.quit();
} else {
  electronApp.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  void electronApp.whenReady().then(createMainWindow).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(`${APP_NAME} failed to start`, message);
    electronApp.quit();
  });
}
