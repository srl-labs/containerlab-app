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
