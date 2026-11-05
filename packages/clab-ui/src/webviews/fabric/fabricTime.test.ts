import assert from "node:assert/strict";
import test from "node:test";

import { parseInstant } from "./fabricTime";

const NOW = new Date(2026, 10, 5, 15, 0, 0).getTime() / 1000;

test("a duration is that long ago", () => {
  assert.equal(parseInstant("30m", NOW), NOW - 1800);
  assert.equal(parseInstant(" 2h ", NOW), NOW - 7200);
  assert.equal(parseInstant("1.5d", NOW), NOW - 129600);
});

test("a time of day is the last time it was that", () => {
  assert.equal(parseInstant("14:02", NOW), new Date(2026, 10, 5, 14, 2, 0).getTime() / 1000);
  assert.equal(parseInstant("16:30", NOW), new Date(2026, 10, 4, 16, 30, 0).getTime() / 1000);
  assert.equal(parseInstant("14:02:30", NOW), new Date(2026, 10, 5, 14, 2, 30).getTime() / 1000);
});

test("epoch seconds and ISO times are taken as they are", () => {
  assert.equal(parseInstant("1793887827.5", NOW), 1793887827.5);
  assert.equal(parseInstant("2026-11-05T14:02:00Z", NOW), Date.UTC(2026, 10, 5, 14, 2, 0) / 1000);
});

test("anything else is not a time", () => {
  for (const text of ["", "soon", "25:00", "12", "14:99", "m"]) {
    assert.equal(parseInstant(text, NOW), undefined, text);
  }
});
