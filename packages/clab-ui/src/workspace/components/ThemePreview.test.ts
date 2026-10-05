import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { themeRoleLabel } from "../../theme/customThemes";

test("every part of the theme preview opens a color the editor has", () => {
  const source = readFileSync(path.join(import.meta.dirname, "ThemePreview.tsx"), "utf8");
  // Literal roles, roles in the data tables, and the literals inside role expressions.
  const roles = [
    ...[...source.matchAll(/data-theme-role="([^"]+)"/g)].map(([, role]) => role),
    ...[...source.matchAll(/\brole: "([^"]+)"/g)].map(([, role]) => role),
    ...[...source.matchAll(/data-theme-role=\{([^}\n]*)\}/g)].flatMap(([, expression]) =>
      [...expression.matchAll(/"([^"]+)"/g)].map(([, role]) => role)
    )
  ];
  assert.ok(roles.length > 20);
  assert.deepEqual(
    roles.filter((role) => themeRoleLabel(role) === undefined),
    []
  );
  assert.equal(themeRoleLabel("ansi.brightRed"), "Terminal bright red");
});
