import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRuntimeContainer,
  normalizeRuntimeInterface,
  runtimeContainersEqual,
  runtimeContainersTopologyEqual,
  sortRuntimeContainers,
  toFiniteNumber
} from "./runtimeModel";

test("toFiniteNumber accepts numbers and numeric strings only", () => {
  assert.equal(toFiniteNumber(12), 12);
  assert.equal(toFiniteNumber("1500"), 1500);
  assert.equal(toFiniteNumber(" "), undefined);
  assert.equal(toFiniteNumber("abc"), undefined);
  assert.equal(toFiniteNumber(Number.POSITIVE_INFINITY), undefined);
  assert.equal(toFiniteNumber(undefined), undefined);
});

test("normalizeRuntimeInterface parses string counters and drops empty stats and netem", () => {
  const iface = normalizeRuntimeInterface({
    name: "e1-1",
    mtu: "1500",
    ifIndex: "12",
    stats: { rxBps: "1000", txBps: undefined, statsIntervalSeconds: 1 },
    netemState: { delay: "10ms", jitter: undefined }
  });

  assert.equal(iface.mtu, 1500);
  assert.equal(iface.ifIndex, 12);
  assert.deepEqual(iface.stats, { rxBps: 1000, statsIntervalSeconds: 1 });
  assert.deepEqual(iface.netemState, { delay: "10ms" });

  const bare = normalizeRuntimeInterface({ name: "e1-2", stats: {}, netemState: {} });
  assert.equal(bare.stats, undefined);
  assert.equal(bare.netemState, undefined);
  assert.equal(bare.alias, "");
  assert.equal(bare.mtu, 0);
});

test("normalizeRuntimeContainer fills defaults and sorts interfaces by name", () => {
  const container = normalizeRuntimeContainer({
    name: "clab-demo-srl1",
    interfaces: [{ name: "mgmt0" }, { name: "e1-1" }]
  });

  assert.equal(container.nodeName, "");
  assert.equal(container.ipv4Address, "");
  assert.deepEqual(
    container.interfaces?.map((iface) => iface.name),
    ["e1-1", "mgmt0"]
  );
});

test("sortRuntimeContainers orders by name without mutating its input", () => {
  const input = [normalizeRuntimeContainer({ name: "b" }), normalizeRuntimeContainer({ name: "a" })];

  assert.deepEqual(
    sortRuntimeContainers(input).map((container) => container.name),
    ["a", "b"]
  );
  assert.equal(input[0]?.name, "b");
});

test("runtimeContainersEqual separates counter changes from topology changes", () => {
  const build = (rxBps: number, state = "up") => [
    normalizeRuntimeContainer({
      name: "clab-demo-srl1",
      interfaces: [{ name: "e1-1", state, stats: { rxBps } }]
    })
  ];

  assert.equal(runtimeContainersEqual(build(1), build(1)), true);
  assert.equal(runtimeContainersEqual(build(1), build(2)), false);
  assert.equal(runtimeContainersTopologyEqual(build(1), build(2)), true);
  assert.equal(runtimeContainersTopologyEqual(build(1), build(1, "down")), false);
});
