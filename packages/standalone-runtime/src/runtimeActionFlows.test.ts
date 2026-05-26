import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTopologyFileNameForCreate } from "./runtimeActionFlows";

test("normalizeTopologyFileNameForCreate appends .clab.yml to extensionless names", () => {
  assert.equal(normalizeTopologyFileNameForCreate("demo"), "demo.clab.yml");
  assert.equal(normalizeTopologyFileNameForCreate("labs/demo"), "labs/demo.clab.yml");
});

test("normalizeTopologyFileNameForCreate preserves valid topology extensions", () => {
  assert.equal(normalizeTopologyFileNameForCreate("demo.clab.yml"), "demo.clab.yml");
  assert.equal(normalizeTopologyFileNameForCreate("demo.clab.yaml"), "demo.clab.yaml");
});

test("normalizeTopologyFileNameForCreate leaves other extensions for validation", () => {
  assert.equal(normalizeTopologyFileNameForCreate("demo.yml"), "demo.yml");
  assert.equal(normalizeTopologyFileNameForCreate("demo.txt"), "demo.txt");
});
