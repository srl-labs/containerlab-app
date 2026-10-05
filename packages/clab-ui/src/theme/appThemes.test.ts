import assert from "node:assert/strict";
import { test } from "node:test";

import { APP_THEMES, DEFAULT_APP_THEME_IDS, resolveAppTheme } from "./appThemes";

test("theme ids are unique and both modes have their default", () => {
  const ids = APP_THEMES.map((theme) => theme.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(resolveAppTheme("light").id, DEFAULT_APP_THEME_IDS.light);
  assert.equal(resolveAppTheme("dark").id, DEFAULT_APP_THEME_IDS.dark);
});

test("resolveAppTheme falls back for unknown ids and themes of the other mode", () => {
  assert.equal(resolveAppTheme("dark", "dracula").id, "dracula");
  assert.equal(resolveAppTheme("dark", "missing").id, "dark-modern");
  assert.equal(resolveAppTheme("light", "dracula").id, "light-modern");
});

test("resolveAppTheme finds extra themes of the requested mode", () => {
  const extra = { ...resolveAppTheme("dark", "nord"), id: "custom-x", name: "X" };
  assert.equal(resolveAppTheme("dark", "custom-x", [extra]), extra);
  assert.equal(resolveAppTheme("light", "custom-x", [extra]).id, "light-modern");
});
