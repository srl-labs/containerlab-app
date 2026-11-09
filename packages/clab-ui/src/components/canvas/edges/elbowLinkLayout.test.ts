import assert from "node:assert/strict";
import test from "node:test";

import { placeCurveLabel } from "./elbowLinkLayout";

const LABEL = { text: "e1-1", fontSize: 10, horizontalPadding: 2 };

test("curve labels sit past the node name and read along the link", () => {
  const down = [
    { x: 0, y: 0 },
    { x: 0, y: 200 }
  ];
  // name 16 + gap 3 + half of a 28px label
  assert.deepEqual(placeCurveLabel(down, "bottom", LABEL, 16), { x: 0, y: 33, rotation: -90 });
  assert.deepEqual(placeCurveLabel(down, "top", LABEL, 16), { x: 0, y: 17, rotation: -90 });
});

test("curve labels turn with the curve and never read upside down", () => {
  const upLeft = [
    { x: 100, y: 100 },
    { x: 0, y: 0 }
  ];
  const placement = placeCurveLabel(upLeft, "top", LABEL, 0);
  assert.ok(Math.abs(placement.rotation - 45) < 1e-9, `rotation ${placement.rotation}`);
});
