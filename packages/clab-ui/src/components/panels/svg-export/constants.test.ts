import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeSrgbColor, resolveCssColor } from "./constants";

describe("normalizeSrgbColor", () => {
  it("converts opaque color(srgb) to rgb with 0-255 channels", () => {
    assert.equal(normalizeSrgbColor("color(srgb 0.2 0.4 1)"), "rgb(51, 102, 255)");
    assert.equal(normalizeSrgbColor("color(srgb 0 0 0 / 1)"), "rgb(0, 0, 0)");
  });

  it("keeps alpha as rgba", () => {
    assert.equal(normalizeSrgbColor("color(srgb 1 0.5 0 / 0.25)"), "rgba(255, 128, 0, 0.25)");
    assert.equal(normalizeSrgbColor("color(srgb 1 1 1 / 50%)"), "rgba(255, 255, 255, 0.5)");
  });

  it("rounds the fractional channels color-mix() produces", () => {
    assert.equal(
      normalizeSrgbColor("color(srgb 0.0941176 0.0941176 0.105882)"),
      "rgb(24, 24, 27)"
    );
  });

  it("leaves other color forms untouched", () => {
    assert.equal(normalizeSrgbColor("rgb(30, 30, 30)"), "rgb(30, 30, 30)");
    assert.equal(normalizeSrgbColor("#252526"), "#252526");
    assert.equal(normalizeSrgbColor("color(display-p3 1 0 0)"), "color(display-p3 1 0 0)");
    assert.equal(normalizeSrgbColor("color(srgb none 0 0)"), "color(srgb none 0 0)");
  });

  it("falls back without a DOM", () => {
    assert.equal(resolveCssColor("var(--missing)", "#cccccc"), "#cccccc");
  });
});
