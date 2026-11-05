import assert from "node:assert/strict";
import test from "node:test";

import { typographyFor } from "./typography";

test("the section label matches the small heading, without shouting", () => {
  const { overline, subtitle2 } = typographyFor();
  assert.equal(overline?.textTransform, "none");
  assert.equal(overline?.fontSize, subtitle2?.fontSize);
  assert.equal(overline?.fontWeight, subtitle2?.fontWeight);
});
