import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveTerminalFontShortcutAction,
  resolveTerminalWheelZoomDelta
} from "./runtimeTerminalZoomShortcuts";

test("resolveTerminalFontShortcutAction favors Alt+Arrow shortcuts", () => {
  assert.equal(
    resolveTerminalFontShortcutAction({
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      key: "ArrowUp"
    }),
    "increase"
  );
  assert.equal(
    resolveTerminalFontShortcutAction({
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      key: "ArrowDown"
    }),
    "decrease"
  );
  assert.equal(
    resolveTerminalFontShortcutAction({
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      key: "0"
    }),
    "reset"
  );
});

test("resolveTerminalFontShortcutAction supports best-effort Ctrl/Cmd shortcuts", () => {
  assert.equal(
    resolveTerminalFontShortcutAction({
      altKey: false,
      ctrlKey: true,
      metaKey: false,
      key: "="
    }),
    "increase"
  );
  assert.equal(
    resolveTerminalFontShortcutAction({
      altKey: false,
      ctrlKey: false,
      metaKey: true,
      key: "-"
    }),
    "decrease"
  );
  assert.equal(
    resolveTerminalFontShortcutAction({
      altKey: false,
      ctrlKey: true,
      metaKey: false,
      key: "0"
    }),
    "reset"
  );
});

test("resolveTerminalFontShortcutAction ignores unrelated keys", () => {
  assert.equal(
    resolveTerminalFontShortcutAction({
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      key: "ArrowUp"
    }),
    null
  );
  assert.equal(
    resolveTerminalFontShortcutAction({
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      key: "K"
    }),
    null
  );
});

test("resolveTerminalWheelZoomDelta requires Ctrl/Cmd modifier and preserves direction", () => {
  assert.equal(
    resolveTerminalWheelZoomDelta({
      ctrlKey: true,
      metaKey: false,
      deltaY: -20
    }),
    1
  );
  assert.equal(
    resolveTerminalWheelZoomDelta({
      ctrlKey: false,
      metaKey: true,
      deltaY: 20
    }),
    -1
  );
  assert.equal(
    resolveTerminalWheelZoomDelta({
      ctrlKey: false,
      metaKey: false,
      deltaY: -20
    }),
    0
  );
});
