import assert from "node:assert/strict";
import test from "node:test";

import { getCustomIconUrl, supportsCustomIconColor } from "./iconUtils";

const SVG_URI = "data:image/svg+xml;base64,PHN2Zy8+";
const PNG_URI = "data:image/png;base64,aWNvbg==";

test("only SVG custom icons support color overrides", () => {
  for (const uri of [
    SVG_URI,
    "data:image/svg+xml,%3Csvg%2F%3E",
    "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E"
  ]) {
    assert.equal(supportsCustomIconColor(uri), true);
  }
  for (const uri of [
    PNG_URI,
    "data:image/jpeg;base64,aWNvbg==",
    "https://example.com/icon.svg",
    ""
  ]) {
    assert.equal(supportsCustomIconColor(uri), false);
  }
});

test("custom icons retain their source unless an SVG color override is set", () => {
  assert.equal(getCustomIconUrl(SVG_URI), SVG_URI);
  assert.equal(getCustomIconUrl(SVG_URI, null), SVG_URI);
  assert.equal(getCustomIconUrl(SVG_URI, ""), SVG_URI);
  assert.equal(getCustomIconUrl(PNG_URI, "#ff6600"), PNG_URI);
  assert.notEqual(getCustomIconUrl(SVG_URI, "#005aff"), SVG_URI);
});
