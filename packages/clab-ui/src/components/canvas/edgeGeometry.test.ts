import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateControlPoint, isVisuallyCanonicalDirection } from "./edgeGeometry";

describe("edge geometry", () => {
  it("resolves visual direction from the dominant axis", () => {
    assert.equal(isVisuallyCanonicalDirection(10, 20, 100, 30), true);
    assert.equal(isVisuallyCanonicalDirection(100, 30, 10, 20), false);
    assert.equal(isVisuallyCanonicalDirection(10, 20, 20, 100), false);
    assert.equal(isVisuallyCanonicalDirection(20, 100, 10, 20), true);
  });

  it("keeps telemetry anchor curves ordered when node ids are reverse sorted", () => {
    const sx = 120;
    const sy = 10;
    const tx = 220;
    const ty = 10;

    const genericControlPoint = calculateControlPoint(sx, sy, tx, ty, 0, 3, false, 40);
    const visualControlPoint = calculateControlPoint(
      sx,
      sy,
      tx,
      ty,
      0,
      3,
      isVisuallyCanonicalDirection(sx, sy, tx, ty),
      40
    );

    assert.ok(genericControlPoint);
    assert.ok(visualControlPoint);
    assert.equal(genericControlPoint.y > sy, true);
    assert.equal(visualControlPoint.y < sy, true);
  });
});
