import assert from "node:assert/strict";
import { test } from "node:test";

import type { EndpointHealthMetrics } from "../types";
import { labHostLoad, labHostUsageLevel, roomiestLabHost, type LabHostMetricsState } from "./labHostResources";
import type { LabOverviewCard } from "./labsOverview";

const GIB = 1024 ** 3;

function ready(availableGiB: number, cpuPercent: number): LabHostMetricsState {
  const metrics: EndpointHealthMetrics = {
    serverInfo: { version: "1", uptime: "1h", startTime: "2026-10-25T10:00:00Z" },
    metrics: {
      cpu: { usagePercent: cpuPercent, numCPU: 8 },
      mem: { totalMem: 64 * GIB, usedMem: (64 - availableGiB) * GIB, availableMem: availableGiB * GIB, usagePercent: 0 }
    }
  };
  return { status: "ready", metrics };
}

function card(endpointId: string, state: LabOverviewCard["state"], nodeCount: number): LabOverviewCard {
  return {
    id: `${endpointId}::${state}-${nodeCount}`,
    endpointId,
    endpointLabel: endpointId,
    name: "lab",
    shared: false,
    state,
    nodeCount,
    readyCount: nodeCount,
    nodes: {},
    canDeploy: false,
    canDestroy: false
  };
}

test("usage levels turn busy at 70 % and full at 90 %", () => {
  assert.equal(labHostUsageLevel(undefined), "ok");
  assert.equal(labHostUsageLevel(69.9), "ok");
  assert.equal(labHostUsageLevel(70), "busy");
  assert.equal(labHostUsageLevel(90), "full");
});

test("the roomiest lab host has the most free memory, then the idlest CPU", () => {
  assert.equal(roomiestLabHost({ a: ready(8, 10), b: ready(32, 80), c: { status: "loading" } }), "b");
  assert.equal(roomiestLabHost({ a: ready(16, 50), b: ready(16, 20) }), "b");
});

test("there is no roomiest lab host without a choice", () => {
  assert.equal(roomiestLabHost({ a: ready(8, 10) }), undefined);
  assert.equal(roomiestLabHost({ a: ready(8, 10), b: { status: "error", message: "down" } }), undefined);
});

test("lab host load counts running labs and their nodes, not topology files", () => {
  const load = labHostLoad([card("a", "running", 4), card("a", "partial", 2), card("a", "undeployed", 9), card("b", "stopped", 3)]);
  assert.deepEqual(load.get("a"), { labs: 2, nodes: 6 });
  assert.deepEqual(load.get("b"), { labs: 1, nodes: 3 });
});
