import assert from "node:assert/strict";
import test from "node:test";

import { resolveTopologySshUsername } from "./topologyCredentials.ts";

const YAML_TEXT = `name: lab
topology:
  kinds:
    nokia_srlinux:
      credentials:
        username: srl-admin
  nodes:
    srl1:
      kind: nokia_srlinux
    srl2:
      kind: nokia_srlinux
      credentials:
        username: ops
    linux1:
      kind: linux
`;

function backendReturning(yaml: string | Error) {
  return {
    runningTopologyYaml: async () => {
      if (yaml instanceof Error) throw yaml;
      return yaml;
    }
  };
}

test("resolveTopologySshUsername uses the node's resolved credentials", async () => {
  const backend = backendReturning(YAML_TEXT);
  assert.equal(await resolveTopologySshUsername(backend, "lab", ["srl1"]), "srl-admin");
  assert.equal(await resolveTopologySshUsername(backend, "lab", ["srl2"]), "ops");
});

test("resolveTopologySshUsername tries each node name in order", async () => {
  const backend = backendReturning(YAML_TEXT);
  assert.equal(
    await resolveTopologySshUsername(backend, "lab", ["srl2-a", "srl2"]),
    "ops"
  );
});

test("resolveTopologySshUsername leaves the choice to the caller when nothing is set", async () => {
  assert.equal(
    await resolveTopologySshUsername(backendReturning(YAML_TEXT), "lab", ["linux1"]),
    undefined
  );
  assert.equal(
    await resolveTopologySshUsername(backendReturning(new Error("404")), "lab", ["srl1"]),
    undefined
  );
});
