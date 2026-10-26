import assert from "node:assert/strict";
import test from "node:test";

import { SHORTCUTS, matchesShortcut, shortcutKeys, withShortcut } from "./shortcuts";

function key(init: { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): KeyboardEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    code: "",
    ...init
  } as KeyboardEvent;
}

test("modifier shortcuts need their modifiers and nothing else", () => {
  assert.equal(matchesShortcut(key({ key: "z", ctrlKey: true }), "undo"), true);
  assert.equal(matchesShortcut(key({ key: "z", metaKey: true }), "undo"), true);
  assert.equal(matchesShortcut(key({ key: "Z", ctrlKey: true, shiftKey: true }), "undo"), false);
  assert.equal(matchesShortcut(key({ key: "Z", ctrlKey: true, shiftKey: true }), "redo"), true);
  assert.equal(matchesShortcut(key({ key: "y", ctrlKey: true }), "redo"), true);
});

test("single-key tools fire without modifiers only", () => {
  assert.equal(matchesShortcut(key({ key: "t" }), "textTool"), true);
  assert.equal(matchesShortcut(key({ key: "T", shiftKey: true }), "textTool"), false);
  assert.equal(matchesShortcut(key({ key: "v", ctrlKey: true }), "selectTool"), false);
  assert.equal(matchesShortcut(key({ key: "v", ctrlKey: true }), "paste"), true);
  assert.equal(matchesShortcut(key({ key: "g" }), "group"), true);
  assert.equal(matchesShortcut(key({ key: "g", ctrlKey: true }), "group"), true);
});

test("bracket shortcuts match the physical key whatever Shift makes of it", () => {
  assert.equal(matchesShortcut(key({ key: "]", code: "BracketRight", ctrlKey: true }), "bringForward"), true);
  const shifted = key({ key: "}", code: "BracketRight", ctrlKey: true, shiftKey: true });
  assert.equal(matchesShortcut(shifted, "bringToFront"), true);
  assert.equal(matchesShortcut(shifted, "bringForward"), false);
});

test("delete and escape ignore modifiers", () => {
  assert.equal(matchesShortcut(key({ key: "Backspace", shiftKey: true }), "delete"), true);
  assert.equal(matchesShortcut(key({ key: "Escape", ctrlKey: true }), "deselect"), true);
});

test("labels read the same table", () => {
  assert.equal(shortcutKeys("bringToFront"), "Ctrl+Shift+]");
  assert.equal(withShortcut("Undo", "undo"), "Undo (Ctrl+Z)");
  assert.equal(SHORTCUTS.redo.keys, "Ctrl + Y");
});
