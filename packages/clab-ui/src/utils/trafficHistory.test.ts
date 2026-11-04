import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_GRAPH_POINTS, linkTrafficKey, recordTrafficSample } from "./trafficHistory";

test("a sample counts once, however many charts or recorders see it", () => {
  const key = linkTrafficKey("a", "srl1", "e1-1");
  const sample = { rxBps: 1000, txBps: 2000, statsIntervalSeconds: 1 };
  recordTrafficSample(key, sample, 10_000);
  const history = recordTrafficSample(key, sample, 10_500);
  assert.deepEqual(history.rxBps, [1000]);
  assert.deepEqual(history.timestamps, [10]);

  recordTrafficSample(key, { rxBps: 3000, statsIntervalSeconds: 1 }, 11_000);
  assert.deepEqual(history.rxBps, [1000, 3000]);
  assert.deepEqual(history.txBps, [2000, 0]);
  assert.deepEqual(history.timestamps, [10, 11]);
});

test("the history keeps the latest samples only", () => {
  const key = linkTrafficKey("b", "srl2", "e1-1");
  for (let index = 0; index < MAX_GRAPH_POINTS + 5; index += 1) {
    recordTrafficSample(key, { rxBps: index, statsIntervalSeconds: 1 }, 1000 * (index + 1));
  }
  const history = recordTrafficSample(key, undefined);
  assert.equal(history.rxBps.length, MAX_GRAPH_POINTS);
  assert.equal(history.rxBps[0], 5);
});
