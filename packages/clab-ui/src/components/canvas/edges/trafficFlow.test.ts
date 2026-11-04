import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveTrafficFlows,
  trafficFlowAnimation,
  trafficFlowCycleSeconds,
  trafficLaneOffset
} from "./trafficFlow";

test("each direction comes from the sending end, else from the receiving end", () => {
  assert.deepEqual(
    resolveTrafficFlows({
      clabSourceStats: { txBps: 5_000_000, rxBps: 1_000 },
      clabTargetStats: { txBps: 2_000, rxBps: 4_900_000 }
    }),
    { forwardBps: 5_000_000, reverseBps: 2_000 }
  );
  // Only the target end reports stats.
  assert.deepEqual(resolveTrafficFlows({ clabTargetStats: { txBps: 10, rxBps: 800_000 } }), {
    forwardBps: 800_000,
    reverseBps: 10
  });
  assert.deepEqual(resolveTrafficFlows(undefined), { forwardBps: 0, reverseBps: 0 });
  assert.deepEqual(resolveTrafficFlows({ clabSourceStats: { txBps: Number.NaN } }), {
    forwardBps: 0,
    reverseBps: 0
  });
});

test("more traffic moves the dashes faster, within bounds", () => {
  const idle = trafficFlowCycleSeconds(1_000);
  const mbps = trafficFlowCycleSeconds(1_000_000);
  const gbps = trafficFlowCycleSeconds(10_000_000_000);
  assert.ok(idle > mbps && mbps > gbps);
  assert.equal(trafficFlowCycleSeconds(0), idle);
  assert.ok(gbps >= 0.4 && idle <= 2.4);
});

test("the animation value carries its direction, which a separate style would lose", () => {
  assert.match(trafficFlowAnimation(1_000_000, true), /^clabTrafficFlow \S+s linear infinite reverse$/);
  assert.match(trafficFlowAnimation(1_000_000, false), /^clabTrafficFlow \S+s linear infinite normal$/);
});

test("small rate changes keep the same speed, so running dashes do not jump", () => {
  assert.equal(trafficFlowCycleSeconds(20_000_000), trafficFlowCycleSeconds(21_000_000));
  assert.notEqual(trafficFlowCycleSeconds(20_000_000), trafficFlowCycleSeconds(2_000_000_000));
});

test("the forward lane runs on the right of the way traffic travels, beside the link", () => {
  // Travelling right, in screen coordinates with y pointing down, right is down.
  const right = trafficLaneOffset({ sx: 0, sy: 0, tx: 100, ty: 0 }, 2);
  assert.equal(right.x === 0, true);
  assert.equal(right.y, 3.5);
  // Travelling down, right is towards smaller x.
  const down = trafficLaneOffset({ sx: 0, sy: 0, tx: 0, ty: 100 }, 2);
  assert.equal(down.x, -3.5);
  assert.equal(down.y === 0, true);
  assert.deepEqual(trafficLaneOffset({ sx: 5, sy: 5, tx: 5, ty: 5 }, 2), { x: 0, y: 0 });
});
