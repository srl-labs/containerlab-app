import assert from "node:assert/strict";
import test from "node:test";

import {
  getNodeBadgeState,
  getNodeBootingAnimationDelay,
  getNodeRuntimeIconOpacity
} from "./nodeStyles";

test("stopped runtime nodes render with reduced icon opacity", () => {
  assert.equal(getNodeRuntimeIconOpacity("running"), 1);
  assert.equal(getNodeRuntimeIconOpacity("undeployed"), 1);
  assert.ok(getNodeRuntimeIconOpacity("paused") < 1);
  assert.ok(getNodeRuntimeIconOpacity("stopped") < getNodeRuntimeIconOpacity("paused"));
});

test("booting and unhealthy nodes replace the container state badge", () => {
  assert.equal(getNodeBadgeState("running", "starting"), "booting");
  assert.equal(getNodeBadgeState("undeployed", "starting"), "booting");
  assert.equal(getNodeBadgeState("running", "stopping"), "booting");
  assert.equal(getNodeBadgeState("running", "unhealthy"), "unhealthy");
  assert.equal(getNodeBadgeState("running", "ready"), "running");
  assert.equal(getNodeBadgeState("stopped", undefined), "stopped");
});

test("booting nodes pulse in a phase of their own", () => {
  const delays = ["srl1", "srl2", "leaf1", "leaf2", "spine1"].map(getNodeBootingAnimationDelay);

  for (const delay of delays) {
    const ms = Number(/^-(\d+)ms$/.exec(delay)?.[1]);
    assert.ok(ms >= 0 && ms < 1800, delay);
  }
  assert.ok(new Set(delays).size > 1);
  assert.equal(getNodeBootingAnimationDelay("srl1"), delays[0]);
});
