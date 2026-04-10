import path from "node:path";

import { app, BrowserWindow, ipcMain, shell } from "electron";

import {
  startStandaloneServer,
  type StandaloneServerHandle,
  type StartStandaloneServerOptions
} from "../server/index.js";

interface DesktopAppInfo {
  platform: NodeJS.Platform;
  version: string;
}

const DEFAULT_VITE_DEV_URL = "http://localhost:5173";
const PRELOAD_FILENAME = "preload.cjs";

let mainWindow: BrowserWindow | null = null;
let serverHandle: StandaloneServerHandle | null = null;
let closingServer = false;

function resolveNodeEnv(): "development" | "production" {
  if (process.env.NODE_ENV === "production") {
    return "production";
  }
  if (process.env.NODE_ENV === "development") {
    return "development";
  }
  return app.isPackaged ? "production" : "development";
}

function resolveDesktopPort(): number {
  const rawPort = process.env.CLAB_DESKTOP_PORT;
  if (!rawPort || rawPort.trim().length === 0) {
    return 0;
  }

  const parsed = Number.parseInt(rawPort, 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }

  return 0;
}

function resolveDesktopServerOptions(): StartStandaloneServerOptions {
  const nodeEnv = resolveNodeEnv();

  return {
    clientRoot: path.resolve(app.getAppPath(), "dist/client"),
    host: "127.0.0.1",
    logStartup: false,
    nodeEnv,
    port: resolveDesktopPort(),
    viteDevUrl: process.env.VITE_DEV_URL ?? DEFAULT_VITE_DEV_URL
  };
}

function resolvePreloadPath(): string {
  return path.resolve(app.getAppPath(), "dist/electron", PRELOAD_FILENAME);
}

function parseHttpUrl(rawUrl: string, baseUrl?: string): URL | null {
  try {
    const parsed = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function resolveInternalUrl(rawUrl: string, appOrigin: string): URL | null {
  const parsed = parseHttpUrl(rawUrl, appOrigin);
  if (!parsed) {
    return null;
  }
  return parsed.origin === appOrigin ? parsed : null;
}

async function openExternalUrl(rawUrl: string): Promise<void> {
  const parsed = parseHttpUrl(rawUrl);
  if (!parsed) {
    throw new Error("Only http(s) URLs are allowed");
  }

  await shell.openExternal(parsed.toString());
}

function registerIpcHandlers(): void {
  ipcMain.handle("desktop:get-app-info", (): DesktopAppInfo => ({
    platform: process.platform,
    version: app.getVersion()
  }));

  ipcMain.handle("desktop:open-external", async (_event, rawUrl: unknown): Promise<void> => {
    if (typeof rawUrl !== "string") {
      throw new Error("A URL string is required");
    }
    await openExternalUrl(rawUrl);
  });
}

function configureWindowNavigation(window: BrowserWindow, appUrl: string): void {
  const appOrigin = new URL(appUrl).origin;

  window.webContents.setWindowOpenHandler(({ url }) => {
    const internalUrl = resolveInternalUrl(url, appOrigin);
    if (internalUrl) {
      createBrowserWindow(internalUrl.toString());
      return { action: "deny" };
    }

    void openExternalUrl(url).catch(() => {});
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (resolveInternalUrl(url, appOrigin)) {
      return;
    }

    event.preventDefault();
    void openExternalUrl(url).catch(() => {});
  });
}

function createBrowserWindow(appUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolvePreloadPath(),
      sandbox: true
    }
  });

  configureWindowNavigation(window, appUrl);
  void window.loadURL(appUrl);
  return window;
}

async function ensureServerStarted(): Promise<StandaloneServerHandle> {
  if (serverHandle) {
    return serverHandle;
  }

  serverHandle = await startStandaloneServer(resolveDesktopServerOptions());
  return serverHandle;
}

async function createMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return;
  }

  const server = await ensureServerStarted();
  mainWindow = createBrowserWindow(server.origin);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function closeServer(): Promise<void> {
  if (!serverHandle) {
    return;
  }

  const activeServer = serverHandle;
  serverHandle = null;
  await activeServer.close();
}

app.whenReady()
  .then(async () => {
    registerIpcHandlers();
    await createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow();
      }
    });
  })
  .catch((error) => {
    console.error("Failed to launch desktop app:", error);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", (event) => {
  if (closingServer || !serverHandle) {
    return;
  }

  event.preventDefault();
  closingServer = true;

  void closeServer()
    .catch((error) => {
      console.error("Failed to stop standalone server:", error);
    })
    .finally(() => {
      app.quit();
    });
});
