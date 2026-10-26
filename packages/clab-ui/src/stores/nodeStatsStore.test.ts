import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { findNodeStatsSeries, useNodeStatsStore } from "./nodeStatsStore";

afterEach(() => useNodeStatsStore.getState().clear());

test("a node's usage is found by container name, then by topology node name", () => {
  useNodeStatsStore.getState().applySample({
    time: "2026-10-25T10:00:00Z",
    intervalSeconds: 2,
    nodes: [
      { name: "clab-demo-srl1", nodeName: "srl1", cpuPercent: 7, memoryBytes: 10 },
      { name: "clab-demo-srl2", nodeName: "srl2", memoryBytes: 20 }
    ]
  });
  const state = useNodeStatsStore.getState();
  assert.equal(findNodeStatsSeries(state, "clab-demo-srl1", undefined)?.latest.cpuPercent, 7);
  assert.equal(findNodeStatsSeries(state, undefined, "srl2")?.latest.memoryBytes, 20);
  assert.equal(findNodeStatsSeries(state, "renamed", "srl1")?.name, "clab-demo-srl1");
  assert.equal(findNodeStatsSeries(state, undefined, "missing"), undefined);

  useNodeStatsStore.getState().setUnavailable("no stats");
  assert.equal(findNodeStatsSeries(useNodeStatsStore.getState(), undefined, "srl1"), undefined);
});
