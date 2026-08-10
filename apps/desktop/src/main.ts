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

import {
  configureApiTlsVerification,
  createContainerlabAppServer
} from "@srl-labs/containerlab-app-server";

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

type EditMenuAction =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "delete"
  | "selectAll"
  | "openLink"
  | "copyLink";

interface EditMenuItem {
  id: EditMenuAction | "sep";
  label?: string;
  enabled?: boolean;
  separator?: boolean;
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

function buildEditMenuItems(params: ContextMenuParams): EditMenuItem[] {
  const { editFlags } = params;
  const items: EditMenuItem[] = [];

  if (params.isEditable) {
    items.push(
      { id: "undo", label: "Undo", enabled: editFlags.canUndo },
      { id: "redo", label: "Redo", enabled: editFlags.canRedo },
      { id: "sep", separator: true },
      { id: "cut", label: "Cut", enabled: editFlags.canCut },
      { id: "copy", label: "Copy", enabled: editFlags.canCopy },
      { id: "paste", label: "Paste", enabled: editFlags.canPaste },
      { id: "delete", label: "Delete", enabled: editFlags.canDelete },
      { id: "sep", separator: true },
      { id: "selectAll", label: "Select All", enabled: editFlags.canSelectAll }
    );
  } else if (params.selectionText || editFlags.canCopy) {
    items.push({
      id: "copy",
      label: "Copy",
      enabled: Boolean(params.selectionText) || editFlags.canCopy
    });
    items.push({ id: "selectAll", label: "Select All", enabled: true });
  }

  if (params.linkURL) {
    if (items.length) items.push({ id: "sep", separator: true });
    items.push(
      { id: "openLink", label: "Open Link", enabled: true },
      { id: "copyLink", label: "Copy Link", enabled: true }
    );
  }
  return items;
}

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
        .then((ok: unknown) => {
          if (!ok) webContents.selectAll();
        })
        .catch(() => webContents.selectAll());
      break;
    case "openLink":
      openExternalUrl(linkURL);
      break;
    case "copyLink":
      clipboard.writeText(linkURL);
      break;
  }
}

// Runs in the page. Prefer live MuiMenu colours when a menu is already open.
const SHOW_EDIT_CONTEXT_MENU_JS = `function (p) {
  return new Promise(function (resolve) {
    var ROOT_ID = "clab-desktop-edit-context-menu-root";
    var prev = document.getElementById(ROOT_ID);
    if (prev) {
      prev.dispatchEvent(new Event("clab-context-menu-close"));
      if (prev.isConnected) prev.remove();
    }

    var contextTarget = document.elementFromPoint(p.x, p.y);
    var editTarget = p.isEditable && contextTarget
      ? contextTarget.closest("input, textarea, [contenteditable]:not([contenteditable='false'])")
      : null;

    function cssVar(names, fallback) {
      var css = getComputedStyle(document.documentElement);
      for (var i = 0; i < names.length; i++) {
        var v = css.getPropertyValue(names[i]).trim();
        if (v) return v;
      }
      return fallback;
    }
    function isDark(color) {
      color = String(color);
      var r = 255, g = 255, b = 255;
      if (color.charAt(0) === "#" && color.length >= 7) {
        var n = parseInt(color.slice(1, 7), 16);
        r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
      } else {
        var parts = color.replace(/[^0-9,]/g, "").split(",");
        if (parts.length >= 3) { r = +parts[0]; g = +parts[1]; b = +parts[2]; }
      }
      return (r * 299 + g * 587 + b * 114) / 1000 < 140;
    }
    function isTransparent(color) {
      return !color || color === "transparent" || color === "rgba(0, 0, 0, 0)";
    }
    function colorAtPoint(property, fallback) {
      var el = contextTarget;
      while (el) {
        var value = getComputedStyle(el)[property];
        if (!isTransparent(value)) return value;
        el = el.parentElement;
      }
      return fallback;
    }

    var sample = document.querySelector(".MuiMenu-paper");
    var bg, fg, border, hover, hoverFg, sepColor, font;
    if (sample) {
      var s = getComputedStyle(sample);
      bg = s.backgroundColor;
      fg = s.color;
      border = s.borderColor && s.borderColor !== "rgba(0, 0, 0, 0)"
        ? s.borderColor
        : cssVar(["--vscode-panel-border"], "rgba(128,128,128,.35)");
    } else {
      var contextBg = colorAtPoint("backgroundColor", "#ffffff");
      var contextFg = colorAtPoint("color", "#333333");
      var editorBg = cssVar(
        ["--vscode-editor-background", "--clab-ui-editor-background"],
        contextBg
      );
      var dark = isDark(editorBg);
      bg = cssVar(
        ["--vscode-sideBar-background", "--vscode-menu-background", "--vscode-dropdown-background"],
        dark ? "#252526" : "#f3f3f3"
      );
      fg = cssVar(
        ["--vscode-menu-foreground", "--vscode-sideBar-foreground", "--vscode-foreground"],
        dark ? "#cccccc" : contextFg
      );
      border = cssVar(["--vscode-menu-border", "--vscode-panel-border"], "rgba(128,128,128,.35)");
    }
    hover = cssVar(
      ["--vscode-menu-selectionBackground", "--vscode-list-hoverBackground"],
      isDark(bg) ? "#2a2d2e" : "rgba(0,0,0,.06)"
    );
    hoverFg = cssVar(["--vscode-menu-selectionForeground", "--vscode-list-hoverForeground"], fg);
    sepColor = cssVar(["--vscode-menu-separatorBackground", "--vscode-panel-border"], border);
    font = cssVar(["--clab-ui-font-family", "--vscode-font-family"], "Roboto, Helvetica, Arial, sans-serif");

    var root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("data-testid", "context-menu");
    root.style.cssText = "position:fixed;inset:0;z-index:2147483646;background:transparent;font-family:" + font;
    var menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Edit menu");
    menu.style.cssText = "position:fixed;left:" + p.x + "px;top:" + p.y + "px;min-width:180px;max-width:280px;padding:4px 0;margin:0;background:" + bg + ";color:" + fg + ";border:1px solid " + border + ";border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.18);box-sizing:border-box;font-size:13px;line-height:1.4;user-select:none";

    var done = false;
    var enabledButtons = [];
    function consumeKey(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
    function restoreEditFocus() {
      if (!editTarget || !editTarget.isConnected || typeof editTarget.focus !== "function") return;
      try { editTarget.focus({ preventScroll: true }); } catch (_) { editTarget.focus(); }
    }
    function finish(v) {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onWindowBlur);
      root.remove();
      restoreEditFocus();
      resolve(v);
    }
    function focusButton(index) {
      if (!enabledButtons.length) return;
      var next = (index + enabledButtons.length) % enabledButtons.length;
      enabledButtons[next].focus({ preventScroll: true });
    }
    function onKeyDown(e) {
      if (e.key === "Escape") {
        consumeKey(e);
        finish(null);
        return;
      }
      var current = enabledButtons.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
        consumeKey(e);
        focusButton(current + 1);
      } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
        consumeKey(e);
        focusButton(current < 0 ? enabledButtons.length - 1 : current - 1);
      } else if (e.key === "Home") {
        consumeKey(e);
        focusButton(0);
      } else if (e.key === "End") {
        consumeKey(e);
        focusButton(enabledButtons.length - 1);
      } else if ((e.key === "Enter" || e.key === " ") && current >= 0) {
        consumeKey(e);
        enabledButtons[current].click();
      }
    }
    function onWindowBlur() { finish(null); }
    root.addEventListener("clab-context-menu-close", function () { finish(null); });
    root.addEventListener("mousedown", function (e) { e.preventDefault(); if (e.target === root) finish(null); });
    root.addEventListener("contextmenu", function (e) { e.preventDefault(); finish(null); });
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onWindowBlur);

    for (var i = 0; i < p.items.length; i++) {
      var item = p.items[i];
      if (item.separator) {
        var sep = document.createElement("div");
        sep.style.cssText = "height:1px;margin:4px 0;background:" + sepColor;
        menu.appendChild(sep);
        continue;
      }
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = item.label;
      btn.disabled = !item.enabled;
      btn.setAttribute("role", "menuitem");
      btn.tabIndex = -1;
      btn.setAttribute("data-testid", "context-menu-item-" + item.id);
      btn.style.cssText = "display:block;width:100%;border:0;background:transparent;color:inherit;text-align:left;padding:4px 12px;min-height:28px;font:inherit;cursor:" + (item.enabled ? "pointer" : "default") + ";opacity:" + (item.enabled ? "1" : ".4");
      if (item.enabled) {
        enabledButtons.push(btn);
        (function (id, b) {
          b.addEventListener("mouseenter", function () { b.style.background = hover; b.style.color = hoverFg; });
          b.addEventListener("mouseleave", function () { b.style.background = "transparent"; b.style.color = "inherit"; });
          b.addEventListener("focus", function () { b.style.background = hover; b.style.color = hoverFg; });
          b.addEventListener("blur", function () { b.style.background = "transparent"; b.style.color = "inherit"; });
          b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); finish(id); });
        })(item.id, btn);
      }
      menu.appendChild(btn);
    }
    root.appendChild(menu);
    var modalRoot = contextTarget && contextTarget.closest(".MuiModal-root");
    (modalRoot || document.documentElement).appendChild(root);
    if (p.keyboardInvocation) focusButton(0);
    requestAnimationFrame(function () {
      var r = menu.getBoundingClientRect();
      var left = p.x, top = p.y;
      if (left + r.width > window.innerWidth - 4) left = Math.max(4, window.innerWidth - r.width - 4);
      if (top + r.height > window.innerHeight - 4) top = Math.max(4, window.innerHeight - r.height - 4);
      menu.style.left = left + "px";
      menu.style.top = top + "px";
    });
  });
}`;

function showAppStyledContextMenu(
  window: BrowserWindow,
  params: ContextMenuParams,
  items: EditMenuItem[]
): void {
  const payload = {
    x: params.x,
    y: params.y,
    isEditable: params.isEditable,
    keyboardInvocation: params.menuSourceType === "keyboard",
    items: items.map((item, index) => ({
      id: item.id,
      label: item.label ?? "",
      enabled: item.enabled !== false,
      separator: Boolean(item.separator),
      key: index
    }))
  };

  void window.webContents
    .executeJavaScript(`(${SHOW_EDIT_CONTEXT_MENU_JS})(${JSON.stringify(payload)})`, true)
    .then((action: unknown) => {
      if (typeof action !== "string" || action === "sep") return;
      runEditMenuAction(window.webContents, action as EditMenuAction, params.linkURL, {
        x: params.x,
        y: params.y
      });
    })
    .catch(() => undefined);
}

function applyDesktopPageChrome(window: BrowserWindow): void {
  const inject = (): void => {
    void window.webContents.insertCSS(SELECTION_GUARD_CSS).catch(() => undefined);
  };
  window.webContents.on("dom-ready", inject);
  window.webContents.on("did-finish-load", inject);

  window.webContents.on("context-menu", (_event, params) => {
    void (async () => {
      let items = buildEditMenuItems(params);
      if (!items.length) {
        const overText = await window.webContents
          .executeJavaScript(
            `(() => {
              const el = document.elementFromPoint(${params.x}, ${params.y});
              return Boolean(el && el.closest(${JSON.stringify(SELECTABLE_SELECTOR)}));
            })()`,
            true
          )
          .catch(() => false);
        if (!overText) return;
        items = [
          {
            id: "copy",
            label: "Copy",
            enabled: Boolean(params.selectionText) || params.editFlags.canCopy
          },
          { id: "selectAll", label: "Select All", enabled: true }
        ];
      }
      showAppStyledContextMenu(window, params, items);
    })();
  });
}

function applyNavigationPolicy(window: BrowserWindow, serverOrigin: string): void {
  applyDesktopPageChrome(window);
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
  configureApiTlsVerification();

  const server = await createContainerlabAppServer({
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
