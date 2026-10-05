import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveAppTheme } from "./appThemes";
import {
  createCustomTheme,
  customThemeVars,
  exportCustomThemes,
  importCustomThemes,
  parseCustomThemes,
  themeExportFileName,
  withRoleColor,
  withTokenColor,
  type CustomTheme
} from "./customThemes";

function themeFrom(baseId: string): CustomTheme {
  return createCustomTheme(resolveAppTheme(baseId.startsWith("light") ? "light" : "dark", baseId), []);
}

test("a new custom theme starts identical to its base", () => {
  const theme = themeFrom("dracula");
  assert.equal(theme.name, "Dracula (custom)");
  assert.equal(theme.mode, "dark");
  assert.deepEqual(customThemeVars(theme), resolveAppTheme("dark", "dracula").vars);
});

test("copies of custom themes get a fresh id and a unique name", () => {
  const original = withRoleColor(themeFrom("nord"), "accent", "#ff0000");
  const copy = createCustomTheme({ ...resolveAppTheme("dark"), id: original.id }, [original]);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.name, "Nord (custom) copy");
  assert.deepEqual(copy.colors, original.colors);
});

test("the background role moves every surface by the same offset", () => {
  const vars = customThemeVars(withRoleColor(themeFrom("dark-modern"), "background", "#102030"));
  assert.equal(vars["--vscode-editor-background"], "#102030");
  // Dark Modern's sidebar sits 7 below the editor (#181818 vs #1f1f1f), its inputs 18 above.
  assert.equal(vars["--vscode-sideBar-background"], "#091929");
  assert.equal(vars["--vscode-input-background"], "#223242");
});

test("the accent role picks legible button text", () => {
  const light = customThemeVars(withRoleColor(themeFrom("light-modern"), "accent", "#ffd700"));
  assert.equal(light["--vscode-button-background"], "#ffd700");
  assert.equal(light["--vscode-focusBorder"], "#ffd700");
  assert.equal(light["--vscode-button-foreground"], "#000000");
  const dark = customThemeVars(withRoleColor(themeFrom("light-modern"), "accent", "#0b3d91"));
  assert.equal(dark["--vscode-button-foreground"], "#ffffff");
});

test("terminal colors are roles of their own", () => {
  const vars = customThemeVars(withRoleColor(themeFrom("dark-modern"), "ansi.brightRed", "#ff1122"));
  assert.equal(vars["--vscode-terminal-ansiBrightRed"], "#ff1122");
});

test("token overrides win, and setting a role clears the overrides it covers", () => {
  let theme = withTokenColor(themeFrom("dark-modern"), "sideBar.background", "#010101");
  theme = withTokenColor(theme, "editor.foreground", "#fafafa");
  assert.equal(customThemeVars(theme)["--vscode-sideBar-background"], "#010101");
  theme = withRoleColor(theme, "surface", "#222244");
  assert.deepEqual(theme.tokens, { "editor.foreground": "#fafafa" });
  assert.equal(customThemeVars(theme)["--vscode-sideBar-background"], "#222244");
  assert.equal(customThemeVars(theme)["--vscode-editor-foreground"], "#fafafa");
});

test("export and import round-trip the editable layers", () => {
  let theme = withRoleColor(themeFrom("gruvbox-dark"), "accent", "#fe8019");
  theme = withTokenColor(theme, "badge.background", "rgba(255, 0, 0, 0.5)");
  const exported = JSON.parse(exportCustomThemes([theme])) as Record<string, unknown>;
  assert.equal(exported.type, "dark");
  // The export is a usable VS Code theme: hex colors, alpha folded into #rrggbbaa.
  assert.equal((exported.colors as Record<string, string>)["badge.background"], "#ff000080");
  const [restored] = importCustomThemes(JSON.stringify(exported));
  assert.notEqual(restored.id, theme.id);
  assert.equal(restored.name, theme.name);
  assert.equal(restored.base, "gruvbox-dark");
  assert.deepEqual(customThemeVars(restored), customThemeVars(theme));
  assert.equal(themeExportFileName([theme]), "gruvbox-dark-custom-color-theme.json");
});

test("VS Code themes import with comments, alpha colors and gaps filled from their colors", () => {
  const [theme] = importCustomThemes(`{
    // A VS Code color theme
    "name": "Paperwhite",
    "colors": {
      "editor.background": "#fdf6e3",
      "editor.foreground": "#333333",
      "list.hoverBackground": "#00000010", /* translucent */
      "button.background": "#cb4b16",
    },
    "tokenColors": [],
  }`);
  assert.equal(theme.name, "Paperwhite");
  assert.equal(theme.mode, "light");
  const vars = customThemeVars(theme);
  assert.equal(vars["--vscode-editor-background"], "#fdf6e3");
  assert.equal(vars["--vscode-list-hoverBackground"], "#00000010");
  assert.equal(vars["--vscode-button-background"], "#cb4b16");
  // Not in the file: follows the imported background rather than Light Modern's white.
  assert.notEqual(vars["--vscode-notifications-background"], "#ffffff");
});

test("imports accept lists and reject files without colors", () => {
  const themes = importCustomThemes(
    JSON.stringify({ themes: [{ type: "dark", colors: { "editor.background": "#000000" } }, { name: "x" }] })
  );
  assert.equal(themes.length, 1);
  assert.equal(themes[0].name, "Imported theme");
  assert.throws(() => importCustomThemes("{ nope"), /not valid JSON/);
  assert.throws(() => importCustomThemes('{ "tokenColors": [] }'), /No theme colors/);
});

test("stored themes survive a JSON round trip and drop bad entries", () => {
  const theme = withRoleColor(themeFrom("nord"), "accent", "#ff0000");
  assert.deepEqual(parseCustomThemes(JSON.parse(JSON.stringify([theme, null, { id: 3 }]))), [theme]);
});
