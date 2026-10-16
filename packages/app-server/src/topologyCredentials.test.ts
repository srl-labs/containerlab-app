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

function clientReturning(yaml: string | Error) {
  return {
    getLabTopologyYaml: async () => {
      if (yaml instanceof Error) throw yaml;
      return yaml;
    }
  };
}

test("resolveTopologySshUsername uses the node's resolved credentials", async () => {
  const client = clientReturning(YAML_TEXT);
  assert.equal(await resolveTopologySshUsername(client, "t", "lab", ["srl1"]), "srl-admin");
  assert.equal(await resolveTopologySshUsername(client, "t", "lab", ["srl2"]), "ops");
});

test("resolveTopologySshUsername tries each node name in order", async () => {
  const client = clientReturning(YAML_TEXT);
  assert.equal(
    await resolveTopologySshUsername(client, "t", "lab", ["srl2-a", "srl2"]),
    "ops"
  );
});

test("resolveTopologySshUsername leaves the choice to the caller when nothing is set", async () => {
  assert.equal(
    await resolveTopologySshUsername(clientReturning(YAML_TEXT), "t", "lab", ["linux1"]),
    undefined
  );
  assert.equal(
    await resolveTopologySshUsername(clientReturning(new Error("404")), "t", "lab", ["srl1"]),
    undefined
  );
});
