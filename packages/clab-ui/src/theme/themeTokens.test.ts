import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { APP_THEMES } from "./appThemes";
import { DARK_VARS, LIGHT_VARS } from "./devTheme";

// VS Code supplies these only in some themes or for its own editor; every use must
// carry a fallback because standalone hosts never define them.
const VSCODE_ONLY_TOKENS = new Set([
  "--vscode-contrastBorder",
  "--vscode-editor-font-family",
  "--vscode-editor-font-size"
]);

const sourceRoot = path.resolve(import.meta.dirname, "..");
const TOKEN_PATTERN = /--vscode-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*(?![A-Za-z0-9.-])/g;

function tokensUsedBySource(): Map<string, string> {
  const used = new Map<string, string>();
  for (const entry of readdirSync(sourceRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:css|tsx?)$/.test(entry.name) || entry.name.includes(".test.")) continue;
    const file = path.join(entry.parentPath, entry.name);
    for (const [token] of readFileSync(file, "utf8").matchAll(TOKEN_PATTERN)) {
      if (!used.has(token)) used.set(token, path.relative(sourceRoot, file));
    }
  }
  return used;
}

test("standalone light and dark palettes define the same theme tokens", () => {
  assert.deepEqual(Object.keys(LIGHT_VARS).sort(), Object.keys(DARK_VARS).sort());
});

test("every app theme defines the same theme tokens as the base palettes", () => {
  const expected = Object.keys(DARK_VARS).sort();
  for (const theme of APP_THEMES) {
    assert.deepEqual(Object.keys(theme.vars).sort(), expected, `${theme.id} is missing or adds tokens`);
    for (const [token, value] of Object.entries(theme.vars)) {
      assert.ok(value.trim().length > 0, `${theme.id} leaves ${token} empty`);
    }
  }
});

test("every theme token the UI reads is defined for standalone hosts", () => {
  const palette = new Set(Object.keys(DARK_VARS));
  const missing = [...tokensUsedBySource()]
    .filter(([token]) => !palette.has(token) && !VSCODE_ONLY_TOKENS.has(token))
    .map(([token, file]) => `${token} (${file})`);
  assert.deepEqual(missing, [], "add the token to DARK_VARS and LIGHT_VARS");
});

test("VS Code-only tokens stay out of the standalone palettes", () => {
  for (const token of VSCODE_ONLY_TOKENS) {
    assert.equal(token in DARK_VARS, false, `${token} is defined; drop it from VSCODE_ONLY_TOKENS`);
  }
});
