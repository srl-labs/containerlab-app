/**
 * Keyboard shortcuts of the topology editor, in one table that the key
 * handler, the shortcuts modal, context menus and toolbar tooltips read.
 */

/** One key combination. `mod` is Ctrl, or Cmd on macOS. */
interface KeyChord {
  /** `KeyboardEvent.key`, case-insensitive for letters */
  key?: string;
  /** `KeyboardEvent.code`, for keys whose `key` changes with Shift or the layout, like brackets */
  code?: string;
  mod?: boolean;
  shift?: boolean;
  /** Matches whatever modifiers are held, like Delete or Escape */
  anyModifiers?: boolean;
}

interface ShortcutDefinition {
  label: string;
  /** As shown, keys joined by " + "; Ctrl and Alt read Cmd and Option on macOS. */
  keys: string;
  chords: readonly KeyChord[];
}

export const SHORTCUTS = {
  undo: { label: "Undo", keys: "Ctrl + Z", chords: [{ key: "z", mod: true }] },
  redo: {
    label: "Redo",
    keys: "Ctrl + Y",
    chords: [
      { key: "y", mod: true },
      { key: "z", mod: true, shift: true }
    ]
  },
  copy: { label: "Copy selected", keys: "Ctrl + C", chords: [{ key: "c", mod: true }] },
  paste: { label: "Paste", keys: "Ctrl + V", chords: [{ key: "v", mod: true }] },
  duplicate: { label: "Duplicate selected", keys: "Ctrl + D", chords: [{ key: "d", mod: true }] },
  selectAll: { label: "Select all", keys: "Ctrl + A", chords: [{ key: "a", mod: true }] },
  group: {
    label: "Group selected",
    keys: "G",
    chords: [{ key: "g" }, { key: "g", mod: true }]
  },
  delete: {
    label: "Delete selected",
    keys: "Del",
    chords: [
      { key: "Delete", anyModifiers: true },
      { key: "Backspace", anyModifiers: true }
    ]
  },
  deselect: { label: "Deselect all", keys: "Esc", chords: [{ key: "Escape", anyModifiers: true }] },
  selectTool: { label: "Select tool", keys: "V", chords: [{ key: "v" }] },
  textTool: { label: "Add text", keys: "T", chords: [{ key: "t" }] },
  rectangleTool: { label: "Add rectangle", keys: "R", chords: [{ key: "r" }] },
  circleTool: { label: "Add circle", keys: "O", chords: [{ key: "o" }] },
  linkTool: { label: "Create link from selected node", keys: "L", chords: [{ key: "l" }] },
  fitView: { label: "Fit to viewport", keys: "F", chords: [{ key: "f" }] },
  bringForward: {
    label: "Bring forward",
    keys: "Ctrl + ]",
    chords: [{ code: "BracketRight", mod: true }]
  },
  sendBackward: {
    label: "Send backward",
    keys: "Ctrl + [",
    chords: [{ code: "BracketLeft", mod: true }]
  },
  bringToFront: {
    label: "Bring to front",
    keys: "Ctrl + Shift + ]",
    chords: [{ code: "BracketRight", mod: true, shift: true }]
  },
  sendToBack: {
    label: "Send to back",
    keys: "Ctrl + Shift + [",
    chords: [{ code: "BracketLeft", mod: true, shift: true }]
  }
} as const satisfies Record<string, ShortcutDefinition>;

export type ShortcutId = keyof typeof SHORTCUTS;

const isMac =
  typeof window !== "undefined" &&
  typeof window.navigator !== "undefined" &&
  /macintosh/i.test(window.navigator.userAgent);

/** Keys with the platform's modifier names: Cmd and Option on macOS. */
export function formatKey(keys: string): string {
  if (!isMac) return keys;
  return keys.replace(/Ctrl/g, "Cmd").replace(/Alt/g, "Option");
}

/** Compact keys of a shortcut for menus and tooltips, e.g. "Ctrl+Z". */
export function shortcutKeys(id: ShortcutId): string {
  return formatKey(SHORTCUTS[id].keys).replace(/ \+ /g, "+");
}

/** A tooltip with its shortcut, e.g. "Undo (Ctrl+Z)". */
export function withShortcut(label: string, id: ShortcutId): string {
  return `${label} (${shortcutKeys(id)})`;
}

function matchesChord(event: KeyboardEvent, chord: KeyChord): boolean {
  if (chord.code !== undefined && event.code !== chord.code) return false;
  if (chord.key !== undefined) {
    const key = chord.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key !== chord.key) return false;
  }
  if (chord.anyModifiers === true) return true;
  const mod = event.ctrlKey || event.metaKey;
  return mod === (chord.mod === true) && event.shiftKey === (chord.shift === true) && !event.altKey;
}

export function matchesShortcut(event: KeyboardEvent, id: ShortcutId): boolean {
  return SHORTCUTS[id].chords.some((chord) => matchesChord(event, chord));
}
