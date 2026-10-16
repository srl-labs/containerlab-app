import assert from "node:assert/strict";
import test from "node:test";

import type { ClabTopology } from "../types/topology";

import { computeNodeInheritance, rebaseInheritedValues } from "./nodeInheritance";

const PARSED: ClabTopology = {
  topology: {
    defaults: { kind: "linux", env: { SHARED: "d" }, user: "admin" },
    kinds: {
      linux: { image: "alpine:3", exec: ["echo linux"], group: "edge" },
      nokia_srlinux: { image: "srlinux:25", binds: ["/k:/data"] }
    },
    groups: { edge: { env: { ROLE: "edge" }, memory: "1G" }, core: { kind: "nokia_srlinux" } },
    nodes: {}
  }
};

test("inherited values and their levels are given per field and entry", () => {
  const inheritance = computeNodeInheritance(PARSED, "linux", "edge");
  assert.equal(inheritance.values.image, "alpine:3");
  assert.equal(inheritance.values.memory, "1G");
  assert.deepEqual(inheritance.values.env, { SHARED: "d", ROLE: "edge" });
  assert.deepEqual(inheritance.fieldSource("image"), { level: "kind", name: "linux" });
  assert.deepEqual(inheritance.fieldSource("memory"), { level: "group", name: "edge" });
  assert.deepEqual(inheritance.fieldSource("user"), { level: "defaults" });
  assert.equal(inheritance.fieldSource("cmd"), undefined);
  assert.deepEqual(inheritance.fieldSource("kind"), { level: "defaults" });
  assert.deepEqual(inheritance.fieldSource("group"), { level: "kind", name: "linux" });
  assert.deepEqual(inheritance.mapEntries("env"), {
    SHARED: { level: "defaults" },
    ROLE: { level: "group", name: "edge" }
  });
  assert.deepEqual([...inheritance.listItems("exec")], [["echo linux", { level: "kind", name: "linux" }]]);
});

test("a node that sets its own kind or group is not marked as inheriting it", () => {
  const inheritance = computeNodeInheritance(PARSED, "nokia_srlinux", "core");
  assert.equal(inheritance.fieldSource("kind")?.level, "group");
  assert.equal(inheritance.fieldSource("group"), undefined);
});

test("changing the kind swaps inherited values and keeps the node's own", () => {
  const before = computeNodeInheritance(PARSED, "linux", "edge").values;
  const after = computeNodeInheritance(PARSED, "nokia_srlinux", "edge").values;
  const updates = rebaseInheritedValues(
    {
      id: "n1",
      name: "n1",
      kind: "nokia_srlinux",
      image: "alpine:3",
      cmd: "own",
      env: { SHARED: "d", ROLE: "edge", OWN: "1" },
      exec: ["echo linux", "echo own"]
    },
    before,
    after
  );
  assert.equal(updates.image, "srlinux:25");
  assert.equal("cmd" in updates, false);
  assert.equal("env" in updates, false);
  assert.deepEqual(updates.exec, ["echo own"]);
  assert.deepEqual(updates.binds, ["/k:/data"]);
});
