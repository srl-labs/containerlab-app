import assert from "node:assert/strict";
import { test } from "node:test";
import { filterSettings } from "./settingsFilter";
import type { SettingDefinition, SettingValue } from "./schema";
const definitions: SettingDefinition[] = [
  {
    key: "containerlab.binaryPath",
    title: "Containerlab binary",
    category: "general",
    type: "string",
    reloadRequired: true,
  },
  {
    key: "containerlab.runtime",
    title: "Container runtime",
    category: "general",
    type: "string",
    reloadRequired: true,
  },
  {
    key: "containerlab.appearance.fontSize",
    title: "Interface font size",
    category: "appearance",
    type: "number",
    reloadRequired: false,
  },
];
const values: Record<string, SettingValue> = Object.fromEntries(
  definitions.map((definition, index) => [
    definition.key,
    {
      value: "test",
      effectiveValue: "test",
      overridden: index !== 1,
      workspaceOverride: false,
    },
  ]),
);
test("counts current-category and global overrides independently of the search", () => {
  const result = filterSettings(
    definitions,
    values,
    "general",
    "does not match",
    "modified-view",
  );
  assert.equal(result.currentModified, 1);
  assert.equal(result.allModified, 2);
  assert.equal(result.visible.length, 0);
});
test("modified here restricts both categories and search results", () => {
  assert.deepEqual(
    filterSettings(
      definitions,
      values,
      "general",
      "",
      "modified-view",
    ).visible.map((item) => item.key),
    ["containerlab.binaryPath"],
  );
  assert.equal(
    filterSettings(definitions, values, "general", "font", "modified-view")
      .visible.length,
    0,
  );
});
test("all modified spans categories and respects the selected scope's values", () => {
  assert.equal(
    filterSettings(definitions, values, "general", "", "modified-all").visible
      .length,
    2,
  );
  const inherited = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      { ...value, overridden: false },
    ]),
  );
  assert.equal(
    filterSettings(definitions, inherited, "general", "", "modified-all")
      .allModified,
    0,
  );
  assert.equal(
    filterSettings(definitions, inherited, "general", "", "modified-all")
      .visible.length,
    0,
  );
});
test("unfiltered search spans all categories while browsing stays in the current category", () => {
  assert.equal(
    filterSettings(definitions, values, "general", "", "all").visible.length,
    2,
  );
  assert.equal(
    filterSettings(definitions, values, "general", "font", "all").visible[0]
      .category,
    "appearance",
  );
});
