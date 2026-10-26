import assert from "node:assert/strict";
import test from "node:test";

import type Docker from "dockerode";

import { cpuPercent, statsCounters } from "./stats.ts";

function dockerStats(fields: Record<string, unknown>): Docker.ContainerStats {
  return fields as unknown as Docker.ContainerStats;
}

test("stats counters leave out page cache that can be reclaimed", () => {
  const counters = statsCounters(
    dockerStats({
      cpu_stats: { cpu_usage: { total_usage: 4e9 }, system_cpu_usage: 8e10, online_cpus: 4 },
      memory_stats: { usage: 300, limit: 1000, stats: { inactive_file: 100 } },
      pids_stats: { current: 7 }
    })
  );
  assert.deepEqual(counters, {
    cpuNanos: 4e9,
    clockNanos: 2e10,
    cpuCount: 4,
    memoryBytes: 200,
    memoryLimitBytes: 1000,
    pids: 7
  });
});

test("CPU usage is relative to one CPU and unknown across a restart", () => {
  const previous = { cpuNanos: 1e9, clockNanos: 1e10, cpuCount: 4, memoryBytes: 0, memoryLimitBytes: 0, pids: 0 };
  assert.equal(cpuPercent(previous, { ...previous, cpuNanos: 4e9, clockNanos: 1.2e10 }), 150);
  assert.equal(cpuPercent(previous, { ...previous, cpuNanos: 1, clockNanos: 1.3e10 }), undefined);
});
