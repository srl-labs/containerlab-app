import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSameNodeBoxAppearance, normalizeNodeBoxAppearance } from "./nodeBoxAppearance";

describe("node box appearance", () => {
  it("keeps valid fields and clamps numbers", () => {
    assert.deepEqual(
      normalizeNodeBoxAppearance({
        color: " #1e293b ",
        opacity: 55.4,
        blur: 99,
        borderColor: "rgba(255, 255, 255, 0.4)",
        borderWidth: -2,
        cornerRadius: 12,
        textColor: "white",
        shadow: false
      }),
      {
        color: "#1e293b",
        opacity: 55,
        blur: 24,
        borderColor: "rgba(255, 255, 255, 0.4)",
        borderWidth: 0,
        cornerRadius: 12,
        textColor: "white",
        shadow: false
      }
    );
  });

  it("drops defaults and invalid values", () => {
    assert.equal(
      normalizeNodeBoxAppearance({
        color: "",
        opacity: 100,
        blur: 0,
        borderWidth: 1,
        cornerRadius: Number.NaN,
        textColor: 42,
        shadow: true
      }),
      undefined
    );
    assert.equal(normalizeNodeBoxAppearance(null), undefined);
    assert.equal(normalizeNodeBoxAppearance(["#fff"]), undefined);
    assert.equal(normalizeNodeBoxAppearance({ color: "x".repeat(65) }), undefined);
  });

  it("compares appearances by their normalized value", () => {
    assert.equal(isSameNodeBoxAppearance(undefined, { opacity: 100 }), true);
    assert.equal(isSameNodeBoxAppearance({ blur: 8, color: "#fff" }, { color: "#fff", blur: 8 }), true);
    assert.equal(isSameNodeBoxAppearance({ opacity: 60 }, { opacity: 61 }), false);
  });
});
