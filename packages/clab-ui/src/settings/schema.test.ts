import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createSettingsCatalog,
  validateSettingsChange,
  type SettingSchema,
} from "./schema";
const manifest = JSON.parse(
  readFileSync(
    new URL(
      "../../../../apps/vscode-containerlab/package.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  contributes: {
    configuration: Array<{ properties: Record<string, SettingSchema> }>;
  };
};
const catalog = createSettingsCatalog(manifest.contributes.configuration);
test("every contributed setting has a valid default and a human-readable form title", () => {
  assert.equal(
    catalog.length,
    Object.values(manifest.contributes.configuration).reduce(
      (sum, group) => sum + Object.keys(group.properties).length,
      0,
    ),
  );
  for (const definition of catalog) {
    assert.equal(
      validateSettingsChange(definition, definition.default),
      undefined,
      definition.key,
    );
    assert.notEqual(
      definition.title,
      definition.key.replace("containerlab.", ""),
      definition.key,
    );
  }
});
test("rejects invalid ports, enum values, types, and fractional numbers", () => {
  const port = catalog.find((setting) => setting.key.endsWith("telnetPort"))!;
  for (const value of [0, 65536, 2.5, "5000", NaN])
    assert.ok(validateSettingsChange(port, value));
  assert.equal(validateSettingsChange(port, 5000), undefined);
  assert.ok(
    validateSettingsChange(
      catalog.find((setting) => setting.key.endsWith("colorScheme"))!,
      "unknown",
    ),
  );
});
test("validates mappings and template structure without stripping advanced fields", () => {
  const mapping = catalog.find((setting) =>
    setting.key.endsWith("sshUserMapping"),
  )!;
  assert.ok(validateSettingsChange(mapping, { linux: 10 }));
  assert.equal(validateSettingsChange(mapping, { linux: "root" }), undefined);
  const template = catalog.find((setting) =>
    setting.key.endsWith("customNodes"),
  )!;
  assert.ok(validateSettingsChange(template, [{ name: "Missing kind" }]));
  assert.ok(
    validateSettingsChange(template, [
      { name: "one", kind: "linux" },
      { name: "one", kind: "linux" },
    ]),
  );
  assert.ok(
    validateSettingsChange(template, [
      { name: "one", kind: "linux", setDefault: true },
      { name: "two", kind: "linux", setDefault: true },
    ]),
  );
  assert.equal(
    validateSettingsChange(template, [
      { name: "one", kind: "linux", env: { FOO: "bar" }, binds: ["/tmp:/tmp"] },
    ]),
    undefined,
  );
});
