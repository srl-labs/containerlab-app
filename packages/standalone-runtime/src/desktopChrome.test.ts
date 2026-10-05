import assert from "node:assert/strict";
import test from "node:test";

import { cssColorToHex } from "./desktopChrome";

test("cssColorToHex converts computed rgb colors", () => {
  assert.equal(cssColorToHex("rgb(0, 0, 0)"), "#000000");
  assert.equal(cssColorToHex("rgb(236, 236, 236)"), "#ececec");
  assert.equal(cssColorToHex("rgba(255, 255, 255, 0.5)"), "#ffffff");
  assert.equal(cssColorToHex("rgb(1 2 3)"), "#010203");
});

test("cssColorToHex refuses values it cannot represent", () => {
  assert.equal(cssColorToHex("transparent"), null);
  assert.equal(cssColorToHex("color(srgb 1 0 0)"), null);
  assert.equal(cssColorToHex("rgb(300, 0, 0)"), null);
});
