import assert from "node:assert/strict";
import test from "node:test";

import * as YAML from "yaml";

import { applyInheritanceSectionUpdate } from "./inheritanceSectionYaml";
import type { InheritanceSectionUpdate } from "../types/inheritance";

function apply(yaml: string, update: InheritanceSectionUpdate): string {
  const doc = YAML.parseDocument(yaml);
  applyInheritanceSectionUpdate(doc, update);
  return doc.toString();
}

const LAB = `name: lab
topology:
  # shared settings
  defaults:
    image: alpine # pinned
    env:
      A: "1"
  nodes:
    n1:
      kind: linux
      group: edge
`;

test("defaults merge key by key and keep comments", () => {
  const out = apply(LAB, {
    level: "defaults",
    changes: { image: null, cmd: "sh", env: { A: "1", B: "2" } }
  });
  assert.equal(
    out,
    `name: lab
topology:
  # shared settings
  defaults:
    env:
      A: "1"
      B: "2"
    cmd: sh
  nodes:
    n1:
      kind: linux
      group: edge
`
  );
});

test("new kinds and groups are created before nodes", () => {
  const withKind = apply(LAB, { level: "kind", name: "linux", changes: { image: "alpine:3" } });
  const out = apply(withKind, { level: "group", name: "edge", changes: { memory: "1G" } });
  const topology = (YAML.parse(out) as { topology: Record<string, unknown> }).topology;
  assert.deepEqual(Object.keys(topology), ["defaults", "kinds", "groups", "nodes"]);
  assert.deepEqual(topology.kinds, { linux: { image: "alpine:3" } });
  assert.deepEqual(topology.groups, { edge: { memory: "1G" } });
});

test("a section's own kind or group key is not written", () => {
  const out = apply(LAB, { level: "kind", name: "linux", changes: { kind: "linux", group: "g" } });
  assert.deepEqual(YAML.parse(out).topology.kinds, { linux: { group: "g" } });
});

test("renaming a group renames the nodes, kinds and defaults that use it", () => {
  const yaml = apply(
    apply(LAB, { level: "group", name: "edge", changes: { memory: "1G" } }),
    { level: "kind", name: "linux", changes: { group: "edge" } }
  );
  const out = YAML.parse(
    apply(yaml, { level: "group", name: "edge", rename: "leaf", changes: { cpu: 2 } })
  ) as { topology: Record<string, Record<string, Record<string, unknown>>> };
  assert.deepEqual(out.topology.groups, { leaf: { memory: "1G", cpu: 2 } });
  assert.equal(out.topology.kinds.linux.group, "leaf");
  assert.equal(out.topology.nodes.n1.group, "leaf");
});

test("renaming onto an existing group fails", () => {
  const yaml = apply(apply(LAB, { level: "group", name: "a" }), { level: "group", name: "b" });
  assert.throws(() => apply(yaml, { level: "group", name: "a", rename: "b" }), /already exists/);
});

test("removing the last group drops the groups map; nodes keep their group", () => {
  const yaml = apply(LAB, { level: "group", name: "edge", changes: { memory: "1G" } });
  const out = YAML.parse(apply(yaml, { level: "group", name: "edge", remove: true })) as {
    topology: Record<string, Record<string, Record<string, unknown>>>;
  };
  assert.equal(out.topology.groups, undefined);
  assert.equal(out.topology.nodes.n1.group, "edge");
});
