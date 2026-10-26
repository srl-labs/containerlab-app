import assert from "node:assert/strict";
import test from "node:test";

import { resolveTrafficFlows, trafficFlowCycleSeconds } from "./trafficFlow";

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
  assert.ok(gbps >= 0.18 && idle <= 1.6);
});
