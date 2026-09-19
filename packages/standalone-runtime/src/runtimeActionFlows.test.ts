import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTopologyFileNameForCreate,
  promptForCreateTopology,
  setCreateTopologyDialogRequester
} from "./runtimeActionFlows";

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

test("creating before the lazy dialog mounts waits for the location selector", async () => {
  const result = promptForCreateTopology({ endpointOptions: [{ value: "team", label: "Team" }] });
  const cleanup = setCreateTopologyDialogRequester(async (request) => {
    assert.equal(request.defaultEndpointId, "team");
    return { endpointId: "team", fileName: "@shared/new-lab" };
  });
  try {
    assert.deepEqual(await result, { endpointId: "team", fileName: "@shared/new-lab.clab.yml" });
  } finally {
    cleanup();
  }
});
