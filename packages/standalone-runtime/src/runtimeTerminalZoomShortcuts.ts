export type TerminalFontShortcutAction = "increase" | "decrease" | "reset";

interface TerminalFontShortcutInput {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
}

const INCREASE_SHORTCUT_KEYS = new Set(["+", "=", "add"]);
const DECREASE_SHORTCUT_KEYS = new Set(["-", "_", "subtract"]);

function normalizeShortcutKey(key: string): string {
  return key.trim().toLowerCase();
}

export function resolveTerminalFontShortcutAction(
  input: TerminalFontShortcutInput
): TerminalFontShortcutAction | null {
  const normalizedKey = normalizeShortcutKey(input.key);

  // Primary browser-safe shortcuts.
  if (input.altKey && !input.ctrlKey && !input.metaKey) {
    if (normalizedKey === "arrowup") {
      return "increase";
    }
    if (normalizedKey === "arrowdown") {
      return "decrease";
    }
    if (normalizedKey === "0") {
      return "reset";
    }
    return null;
  }

  // Best-effort browser/OS-reserved shortcuts.
  if ((input.ctrlKey || input.metaKey) && !input.altKey) {
    if (INCREASE_SHORTCUT_KEYS.has(normalizedKey)) {
      return "increase";
    }
    if (DECREASE_SHORTCUT_KEYS.has(normalizedKey)) {
      return "decrease";
    }
    if (normalizedKey === "0") {
      return "reset";
    }
  }

  return null;
}

export function resolveTerminalWheelZoomDelta(input: {
  ctrlKey: boolean;
  deltaY: number;
  metaKey: boolean;
}): number {
  if (!input.ctrlKey && !input.metaKey) {
    return 0;
  }
  if (input.deltaY < 0) {
    return 1;
  }
  if (input.deltaY > 0) {
    return -1;
  }
  return 0;
}
