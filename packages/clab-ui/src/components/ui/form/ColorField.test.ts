import assert from "node:assert/strict";
import test from "node:test";

import { parseColorInput } from "./ColorField";

test("hex colors are accepted with or without # and in short form", () => {
  assert.equal(parseColorInput("ff6600", false), "#ff6600");
  assert.equal(parseColorInput("#FF6600", false), "#ff6600");
  assert.equal(parseColorInput("#f60", false), "#ff6600");
  assert.equal(parseColorInput("ff66", false), null);
});

test("alpha forms are accepted only where the field allows them", () => {
  assert.equal(parseColorInput("#ff660080", false), null);
  assert.equal(parseColorInput("#ff660080", true), "#ff660080");
  assert.equal(parseColorInput("rgba(255, 102, 0, 0.5)", true), "rgba(255, 102, 0, 0.5)");
  assert.equal(parseColorInput("not a color", true), null);
});
