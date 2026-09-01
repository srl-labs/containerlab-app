import assert from "node:assert/strict";
import test from "node:test";

import type { FreeTextAnnotation } from "../../core/types/topology";

import { cloneFreeTextAnnotation } from "./cloneFreeTextAnnotation";

const source: FreeTextAnnotation = {
  id: "freeText_1",
  text: "hello world",
  position: { x: 100, y: 50 },
  fontSize: 14,
  fontColor: "#333333",
  fontWeight: "bold",
  groupId: "group-1"
};

test("cloneFreeTextAnnotation assigns the new id and offsets the position", () => {
  const copy = cloneFreeTextAnnotation(source, "freeText_2");

  assert.equal(copy.id, "freeText_2");
  assert.deepEqual(copy.position, { x: 120, y: 70 });
});

test("cloneFreeTextAnnotation preserves text, style and group membership", () => {
  const copy = cloneFreeTextAnnotation(source, "freeText_2");

  assert.equal(copy.text, "hello world");
  assert.equal(copy.fontSize, 14);
  assert.equal(copy.fontWeight, "bold");
  assert.equal(copy.groupId, "group-1");
});

test("cloneFreeTextAnnotation omits geo coordinates so geo layout can place the copy", () => {
  const geoSource: FreeTextAnnotation = {
    ...source,
    geoCoordinates: { lat: 48, lng: 11 }
  };

  const copy = cloneFreeTextAnnotation(geoSource, "freeText_2");

  assert.equal(copy.geoCoordinates, undefined);
  assert.deepEqual(geoSource.geoCoordinates, { lat: 48, lng: 11 });
});

test("cloneFreeTextAnnotation does not mutate the source", () => {
  cloneFreeTextAnnotation(source, "freeText_2");

  assert.equal(source.id, "freeText_1");
  assert.deepEqual(source.position, { x: 100, y: 50 });
});
