import assert from "node:assert/strict";
import test from "node:test";

import { buildTimeTicks } from "./TrafficChart";

const at = (iso: string) => new Date(`2026-10-25T${iso}Z`);

test("a one-minute window gets ticks every 15 seconds on round boundaries", () => {
  const { ticks, stepSeconds } = buildTimeTicks(at("10:00:07"), at("10:01:07"), 5);
  assert.equal(stepSeconds, 15);
  assert.deepEqual(
    ticks.map((tick) => tick.toISOString().slice(11, 19)),
    ["10:00:15", "10:00:30", "10:00:45", "10:01:00"]
  );
});

test("a five-minute window steps by whole minutes", () => {
  const { ticks, stepSeconds } = buildTimeTicks(at("10:00:30"), at("10:05:30"), 5);
  assert.equal(stepSeconds, 60);
  assert.equal(ticks.length, 5);
  assert.equal(ticks[0].toISOString().slice(11, 19), "10:01:00");
});

test("compact charts get fewer, wider ticks", () => {
  assert.equal(buildTimeTicks(at("10:00:00"), at("10:01:00"), 3).stepSeconds, 30);
});
