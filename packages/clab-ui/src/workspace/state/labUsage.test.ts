import assert from "node:assert/strict";
import { test } from "node:test";

import type { LabOverviewCard } from "./labsOverview";
import { canWatchLabUsage, LAB_USAGE_HISTORY, nextLabUsage } from "./labUsage";

const GIB = 1024 ** 3;

function sample(nodes: Array<{ nodeName: string; cpuPercent?: number; memoryBytes: number; memoryLimitBytes?: number }>) {
  return {
    time: "2026-10-25T10:00:00Z",
    intervalSeconds: 3,
    nodes: nodes.map((node) => ({ name: `clab-demo-${node.nodeName}`, cpuCount: 8, ...node }))
  };
}

test("lab usage sums the running nodes and keeps each node's share", () => {
  const usage = nextLabUsage(undefined, sample([
    { nodeName: "srl1", cpuPercent: 12.25, memoryBytes: GIB, memoryLimitBytes: 16 * GIB },
    { nodeName: "srl2", cpuPercent: 30.1, memoryBytes: 2 * GIB, memoryLimitBytes: 16 * GIB },
    { nodeName: "client", memoryBytes: GIB / 2, memoryLimitBytes: 16 * GIB }
  ]));
  assert.equal(usage.cpuPercent, 42.4);
  assert.equal(usage.cpuCount, 8);
  assert.equal(usage.memoryBytes, 3.5 * GIB);
  assert.equal(usage.memoryLimitBytes, 16 * GIB);
  assert.deepEqual(usage.nodes.srl1, { cpuPercent: 12.25, memoryBytes: GIB });
  assert.deepEqual(usage.nodes.client, { memoryBytes: GIB / 2 });
  assert.equal(usage.time, Date.parse("2026-10-25T10:00:00Z"));
  assert.deepEqual(usage.cpuHistory, [42.4]);
  // A node with a limit of its own hides how much memory the host has.
  const limited = nextLabUsage(undefined, sample([
    { nodeName: "a", memoryBytes: GIB, memoryLimitBytes: 16 * GIB },
    { nodeName: "b", memoryBytes: GIB, memoryLimitBytes: 2 * GIB }
  ]));
  assert.equal(limited.memoryLimitBytes, undefined);
});

test("a first sample without CPU leaves the CPU unknown, and history stays bounded", () => {
  let usage = nextLabUsage(undefined, sample([{ nodeName: "a", memoryBytes: 100 }]));
  assert.equal(usage.cpuPercent, undefined);
  assert.deepEqual(usage.cpuHistory, []);
  assert.deepEqual(usage.memoryHistory, [100]);
  for (let index = 0; index < LAB_USAGE_HISTORY + 5; index += 1) {
    usage = nextLabUsage(usage, sample([{ nodeName: "a", cpuPercent: index, memoryBytes: 100 + index }]));
  }
  assert.equal(usage.cpuHistory.length, LAB_USAGE_HISTORY);
  assert.equal(usage.memoryHistory.length, LAB_USAGE_HISTORY);
  assert.equal(usage.cpuHistory.at(-1), LAB_USAGE_HISTORY + 4);
  // Nodes that stopped are gone from the next sample.
  usage = nextLabUsage(usage, sample([]));
  assert.deepEqual(usage.nodes, {});
  assert.equal(usage.memoryBytes, 0);
});

test("only cards of running labs with a lab name follow usage", () => {
  const card = { labName: "demo", state: "running" } as LabOverviewCard;
  assert.equal(canWatchLabUsage(card), true);
  assert.equal(canWatchLabUsage({ ...card, state: "partial" }), true);
  assert.equal(canWatchLabUsage({ ...card, state: "stopped" }), false);
  assert.equal(canWatchLabUsage({ ...card, state: "undeployed", labName: undefined }), false);
});
