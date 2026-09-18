import assert from "node:assert/strict";
import test from "node:test";

import { describeTopology } from "./describeTopology";

test("source inspection uses parsed ranges and resolves defaults, kind images, and overrides", () => {
  const yaml = `name: test
topology:
  defaults: {kind: linux, image: alpine:3.23}
  kinds:
    nokia_srlinux: {image: srl:latest}
  nodes:
    'client:one': {}
    router:
      kind: nokia_srlinux
    explicit:
      kind: nokia_srlinux
      image: custom:1
  links:
    - endpoints: [router:e1-1, explicit:e1-1]
`;
  const description = describeTopology(yaml);
  assert.equal(description.links, 1);
  assert.deepEqual(description.nodes, [
    { id: "client:one", kind: "linux", image: "alpine:3.23", startLine: 7, endLine: 7 },
    { id: "router", kind: "nokia_srlinux", image: "srl:latest", startLine: 8, endLine: 9 },
    { id: "explicit", kind: "nokia_srlinux", image: "custom:1", startLine: 10, endLine: 12 }
  ]);
});

test("malformed, empty, and non-topology input produces a readable error", () => {
  for (const yaml of ["", "name: incomplete", "topology: {nodes: {}}", "topology: ["])
    assert.throws(() => describeTopology(yaml));
});

test("YAML aliases can provide node configuration without losing the source location", () => {
  const result = describeTopology(`name: aliases
settings: &linux {kind: linux, image: alpine:3.23}
topology:
  nodes:
    client: *linux
`);
  assert.deepEqual(result.nodes[0], {
    id: "client", kind: "linux", image: "alpine:3.23", startLine: 5, endLine: 5
  });
});
