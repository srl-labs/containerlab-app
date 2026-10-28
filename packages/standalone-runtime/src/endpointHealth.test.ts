import assert from "node:assert/strict";
import test from "node:test";

import { fetchEndpointHealthMetrics } from "./endpointHealth";

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
test.beforeEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://app.example.test" } } });
});
test.afterEach(() => {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const METRICS = {
  metrics: {
    cpu: { usagePercent: 1, numCPU: 1 },
    mem: { usagePercent: 1, usedMem: 1, totalMem: 2 },
    disk: { path: "/", usagePercent: 1, usedDisk: 1, totalDisk: 2 }
  }
};

/** Answers the lab host's description and its metrics, and records what was asked. */
function fakeServer(t: test.TestContext, healthMetrics: boolean): string[] {
  const asked: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const path = new URL(String(input), "https://app.example.test").pathname;
    asked.push(path);
    if (path === "/api/runtime/host") {
      return Response.json({ profile: { runtime: healthMetrics ? "docker" : "c9s" }, support: { healthMetrics } });
    }
    return Response.json(METRICS);
  });
  return asked;
}

test("host metrics are asked of lab hosts that report them", async (t) => {
  const asked = fakeServer(t, true);
  const metrics = await fetchEndpointHealthMetrics("docker-host");
  assert.equal(metrics.metrics.cpu?.numCPU, 1);
  assert.deepEqual(asked, ["/api/runtime/host", "/auth/endpoints/docker-host/metrics"]);
});

test("a lab host without host metrics, such as a cluster, is not asked", async (t) => {
  const asked = fakeServer(t, false);
  await assert.rejects(fetchEndpointHealthMetrics("cluster-host"), /does not report CPU, memory and disk usage/);
  assert.deepEqual(asked, ["/api/runtime/host"]);
});
