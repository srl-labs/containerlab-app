import type { ContextMenuParams } from "electron";

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const TERMINAL_PATH = "/terminal.html";
const WIRESHARK_PATH = "/wireshark.html";

export function parsePortEnv(value: string | undefined, defaultValue: number): number {
  const trimmed = value?.trim() ?? "";
  if (!/^\d+$/.test(trimmed)) {
    return defaultValue;
  }
  const port = Number(trimmed);
  return port > 0 && port <= 65535 ? port : defaultValue;
}

// Only these schemes may leave the app; file:, javascript:, smb: and custom
// protocol handlers are refused.
export function isAllowedExternalUrl(rawUrl: string): boolean {
  const url = URL.parse(rawUrl);
  return url !== null && EXTERNAL_PROTOCOLS.has(url.protocol);
}

export type NavigationDecision = "allow" | "external" | "block";

// Electron reports absolute URLs; anything that does not parse is refused.
export function decideNavigation(rawUrl: string, serverOrigin: string): NavigationDecision {
  const url = URL.parse(rawUrl);
  if (!url) {
    return "block";
  }
  if (url.origin === serverOrigin) {
    return "allow";
  }
  return EXTERNAL_PROTOCOLS.has(url.protocol) ? "external" : "block";
}

export type WindowOpenDecision = "terminal" | "wireshark" | "external" | "block";

export function decideWindowOpen(rawUrl: string, serverOrigin: string): WindowOpenDecision {
  const url = URL.parse(rawUrl);
  if (!url) {
    return "block";
  }
  if (url.origin === serverOrigin) {
    if (url.pathname === TERMINAL_PATH) {
      return "terminal";
    }
    if (url.pathname === WIRESHARK_PATH) {
      return "wireshark";
    }
  }
  return EXTERNAL_PROTOCOLS.has(url.protocol) ? "external" : "block";
}

export type EditMenuAction =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "delete"
  | "selectAll"
  | "openLink"
  | "copyLink";

export type EditMenuEntry =
  | { type: "separator" }
  | { id: EditMenuAction; label: string; enabled: boolean };

export type EditMenuRequest = Pick<
  ContextMenuParams,
  "isEditable" | "selectionText" | "linkURL" | "editFlags"
>;

const SEPARATOR: EditMenuEntry = { type: "separator" };

// overSelectableText marks a right-click on a selectable text surface (pre, code)
// that Chromium did not report as a selection.
export function buildEditMenu(
  request: EditMenuRequest,
  overSelectableText = false
): EditMenuEntry[] {
  const { editFlags, selectionText, linkURL } = request;
  const entries: EditMenuEntry[] = [];

  if (request.isEditable) {
    entries.push(
      { id: "undo", label: "Undo", enabled: editFlags.canUndo },
      { id: "redo", label: "Redo", enabled: editFlags.canRedo },
      SEPARATOR,
      { id: "cut", label: "Cut", enabled: editFlags.canCut },
      { id: "copy", label: "Copy", enabled: editFlags.canCopy },
      { id: "paste", label: "Paste", enabled: editFlags.canPaste },
      { id: "delete", label: "Delete", enabled: editFlags.canDelete },
      SEPARATOR,
      { id: "selectAll", label: "Select All", enabled: editFlags.canSelectAll }
    );
  } else if (selectionText !== "" || editFlags.canCopy || overSelectableText) {
    entries.push(
      { id: "copy", label: "Copy", enabled: selectionText !== "" || editFlags.canCopy },
      { id: "selectAll", label: "Select All", enabled: true }
    );
  }

  if (linkURL !== "") {
    if (entries.length > 0) {
      entries.push(SEPARATOR);
    }
    entries.push(
      { id: "openLink", label: "Open Link", enabled: isAllowedExternalUrl(linkURL) },
      { id: "copyLink", label: "Copy Link", enabled: true }
    );
  }
  return entries;
}

// Height of the toolbar the web UI draws at the top of every window; it doubles as
// the title bar, so the native window-control overlay must match it.
export const TITLEBAR_HEIGHT = 40;

export interface TitleBarOverlay {
  color: string;
  symbolColor: string;
  height: number;
}

const HEX_COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const MIN_TITLEBAR_HEIGHT = 24;
const MAX_TITLEBAR_HEIGHT = 80;

// The renderer is untrusted input: accept only well-formed hex colors and a sane height.
export function parseTitleBarOverlay(value: unknown): TitleBarOverlay | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const color: unknown = Reflect.get(value, "color");
  const symbolColor: unknown = Reflect.get(value, "symbolColor");
  const height: unknown = Reflect.get(value, "height");
  if (
    typeof color !== "string" ||
    typeof symbolColor !== "string" ||
    !HEX_COLOR.test(color) ||
    !HEX_COLOR.test(symbolColor) ||
    typeof height !== "number" ||
    !Number.isFinite(height) ||
    height < MIN_TITLEBAR_HEIGHT ||
    height > MAX_TITLEBAR_HEIGHT
  ) {
    return null;
  }
  return { color, symbolColor, height: Math.round(height) };
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

const DEFAULT_WINDOW_SIZE = { width: 1280, height: 900 };

// Saved state comes from disk and may predate a monitor change: keep the size when it is
// sane, and the position only when the window would still be reachable on a display.
export function sanitizeWindowState(
  value: unknown,
  displays: readonly WindowBounds[]
): WindowState {
  const state: WindowState = { ...DEFAULT_WINDOW_SIZE, maximized: false };
  if (typeof value !== "object" || value === null) {
    return state;
  }
  const int = (key: string): number | undefined => {
    const entry: unknown = Reflect.get(value, key);
    return typeof entry === "number" && Number.isFinite(entry) ? Math.round(entry) : undefined;
  };
  const width = int("width");
  const height = int("height");
  if (width !== undefined && height !== undefined && width >= 640 && height >= 480) {
    state.width = width;
    state.height = height;
  }
  state.maximized = Reflect.get(value, "maximized") === true;

  const x = int("x");
  const y = int("y");
  if (x !== undefined && y !== undefined && isReachable({ x, y, width: state.width, height: state.height }, displays)) {
    state.x = x;
    state.y = y;
  }
  return state;
}

// The title bar sits at the top edge, so require a usable slice of it inside some display.
function isReachable(bounds: WindowBounds, displays: readonly WindowBounds[]): boolean {
  const grab = 120;
  return displays.some(
    (display) =>
      bounds.x + bounds.width - grab >= display.x &&
      bounds.x + grab <= display.x + display.width &&
      bounds.y >= display.y &&
      bounds.y + TITLEBAR_HEIGHT <= display.y + display.height
  );
}
