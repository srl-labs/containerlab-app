import assert from "node:assert/strict";
import { test } from "node:test";

import {
  angleBetweenPoints,
  normalizeRotation,
  uprightRotation,
  getShapeRotation,
  rotateLine
} from "./rotation";

test("angles follow clockwise canvas coordinates and handle degenerate geometry", () => {
  assert.equal(angleBetweenPoints({ x: 0, y: 0 }, { x: 20, y: 20 }), 45);
  assert.equal(angleBetweenPoints({ x: 20, y: 20 }, { x: 0, y: 0 }), -135);
  assert.equal(angleBetweenPoints({ x: 0, y: 0 }, { x: 0, y: 20 }), 90);
  assert.equal(angleBetweenPoints({ x: 10, y: 20 }, { x: 10, y: 20 }), null);
  assert.equal(angleBetweenPoints({ x: NaN, y: 0 }, { x: 10, y: 20 }), null);
});

test("normalization preserves fractional angles and parallel text stays upright", () => {
  assert.equal(normalizeRotation(720 + 22.5), 22.5);
  assert.equal(normalizeRotation(-450), -90);
  assert.equal(uprightRotation(135), -45);
  assert.equal(uprightRotation(-135), 45);
  assert.equal(uprightRotation(180), 0);
  assert.equal(uprightRotation(90), 90);
});

test("line rotation uses endpoints, preserves center and length, and survives serialization", () => {
  const line = {
    id: "line",
    shapeType: "line" as const,
    position: { x: 20, y: 30 },
    endPosition: { x: 120, y: 30 },
    rotation: 77
  };
  assert.equal(getShapeRotation(line), 0);
  const vertical = { ...line, ...rotateLine(line, 90) };
  assert.deepEqual(vertical.position, { x: 70, y: -20 });
  assert.deepEqual(vertical.endPosition, { x: 70, y: 80 });
  assert.equal(getShapeRotation(JSON.parse(JSON.stringify(vertical))), 90);
  const diagonal = { ...vertical, ...rotateLine(vertical, -22.5) };
  assert.ok(Math.abs(getShapeRotation(diagonal) + 22.5) < 1e-8);
  assert.ok(
    Math.abs(
      Math.hypot(
        diagonal.endPosition.x - diagonal.position.x,
        diagonal.endPosition.y - diagonal.position.y
      ) - 100
    ) < 1e-8
  );
  assert.equal((diagonal.position.x + diagonal.endPosition.x) / 2, 70);
  assert.equal((diagonal.position.y + diagonal.endPosition.y) / 2, 30);
});
