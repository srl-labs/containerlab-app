import assert from "node:assert/strict";
import test from "node:test";

import {
  labTrafficRange,
  resolveTrafficFlows,
  trafficFlowAnimation,
  trafficFlowLook,
  trafficLaneOffset,
  trafficLevel
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

const stats = (txBps: number, rxBps: number) => ({ data: { extraData: { clabSourceStats: { txBps, rxBps } } } });

test("the range covers every direction with traffic in the lab, and ignores idle ones", () => {
  assert.deepEqual(labTrafficRange([stats(20e6, 200e3), stats(300e6, 700e3), stats(0, 0), {}]), {
    minBps: 200e3,
    maxBps: 300e6
  });
  assert.deepEqual(labTrafficRange([stats(0, 0)]), { minBps: 0, maxBps: 0 });
  assert.deepEqual(labTrafficRange([]), { minBps: 0, maxBps: 0 });
});

test("the busiest link is at the top and the quietest at the bottom of the lab's scale", () => {
  const range = { minBps: 200e3, maxBps: 300e6 };
  assert.equal(trafficLevel(300e6, range), 1);
  assert.equal(trafficLevel(200e3, range), 0);
  const middle = trafficLevel(20e6, range);
  assert.ok(middle > 0 && middle < 1);
  assert.ok(trafficLevel(700e3, range) < middle);
});

test("the same traffic looks different depending on the rest of the lab", () => {
  assert.equal(trafficLevel(20e6, { minBps: 20e6, maxBps: 20e6 }), 1);
  assert.ok(trafficLevel(20e6, { minBps: 200e3, maxBps: 10e9 }) < 1);
});

test("links with nearly the same traffic look alike", () => {
  assert.equal(trafficLevel(100e6, { minBps: 100e6, maxBps: 101e6 }), 1);
});

test("small rate changes keep the same level, so running dashes do not jump", () => {
  const range = { minBps: 200e3, maxBps: 300e6 };
  assert.equal(trafficLevel(20e6, range), trafficLevel(21e6, range));
});

test("busier traffic moves faster with smaller gaps", () => {
  const looks = [0, 0.25, 0.5, 0.75, 1].map(trafficFlowLook);
  for (let index = 1; index < looks.length; index += 1) {
    const [quieter, busier] = [looks[index - 1], looks[index]];
    assert.ok(quieter.period / quieter.cycleSeconds < busier.period / busier.cycleSeconds, "speed");
    assert.ok(quieter.period > busier.period, "gap");
  }
  assert.equal(looks[0].dashArray, "8 28");
  assert.equal(looks[4].dashArray, "8 4");
});

test("the dash and gap add up to how far the animation moves", () => {
  for (const level of [0, 0.25, 0.5, 0.75, 1]) {
    const look = trafficFlowLook(level);
    const [dash, gap] = look.dashArray.split(" ").map(Number);
    assert.equal(dash + gap, look.period);
  }
});

test("the animation value carries its direction, which a separate style would lose", () => {
  assert.match(trafficFlowAnimation(0.5, true), /^clabTrafficFlow 0\.50s linear infinite reverse$/);
  assert.match(trafficFlowAnimation(0.5, false), /^clabTrafficFlow 0\.50s linear infinite normal$/);
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
