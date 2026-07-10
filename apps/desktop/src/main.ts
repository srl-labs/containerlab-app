import { app as electronApp, BrowserWindow, Menu, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";

import {
  createContainerlabAppServer,
  resolveApiTlsConfig
} from "@srl-labs/containerlab-app-server";

const APP_NAME = "Containerlab";
const DEFAULT_CLAB_API_URL = process.env.CLAB_API_URL ?? "https://localhost:8090";
const DEFAULT_DESKTOP_PORT = 32180;
const SHUTDOWN_TIMEOUT_MS = 3_000;

electronApp.setName(APP_NAME);
Menu.setApplicationMenu(null);

function parseBooleanEnv(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePortEnv(value: string | undefined, defaultValue: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return defaultValue;
}

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

function parseAppUrl(rawUrl: string, serverOrigin: string): URL | null {
  try {
    return new URL(rawUrl, serverOrigin);
  } catch {
    return null;
  }
}

function isSameOriginAppUrl(rawUrl: string, serverOrigin: string): boolean {
  return parseAppUrl(rawUrl, serverOrigin)?.origin === serverOrigin;
}

function isWiresharkCaptureUrl(rawUrl: string, serverOrigin: string): boolean {
  const parsed = parseAppUrl(rawUrl, serverOrigin);
  return parsed?.origin === serverOrigin && parsed.pathname === "/wireshark.html";
}

function isTerminalUrl(rawUrl: string, serverOrigin: string): boolean {
  const parsed = parseAppUrl(rawUrl, serverOrigin);
  return parsed?.origin === serverOrigin && parsed.pathname === "/terminal.html";
}

function openExternalUrl(rawUrl: string): void {
  void shell.openExternal(rawUrl);
}

function applyNavigationPolicy(window: BrowserWindow, serverOrigin: string): void {
  window.webContents.on("will-navigate", (event, url) => {
    if (!isSameOriginAppUrl(url, serverOrigin)) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWiresharkCaptureUrl(url, serverOrigin)) {
      openWiresharkCaptureWindow(url, serverOrigin);
    } else if (isTerminalUrl(url, serverOrigin)) {
      openTerminalWindow(url, serverOrigin);
    } else {
      openExternalUrl(url);
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
    apiTls: resolveApiTlsConfig(process.env, true),
    defaultClabApiUrl: DEFAULT_CLAB_API_URL,
    isDev: false,
    logger: parseBooleanEnv(process.env.CONTAINERLAB_DESKTOP_DEBUG),
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
