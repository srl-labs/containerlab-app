import assert from "node:assert/strict";
import test from "node:test";

import { findLabFileReferences } from "./labFileReferences";

const TOPOLOGY = `name: dc
topology:
  defaults:
    binds:
      - common/motd.txt:/etc/motd
  kinds:
    nokia_srlinux:
      license: licenses/srl.key
  groups:
    leaves:
      startup-config: "configs/leaf.cfg"
  nodes:
    r1:
      kind: linux
      binds:
        - 'configs/r1.cfg:/etc/r1.cfg:ro'
        - /lib/modules:/lib/modules
      startup-config: |
        inline config
    r2:
      startup-config: configs/r2.cfg
`;

function text(start: number, end: number): string {
  return TOPOLOGY.slice(start, end);
}

test("binds, startup configs and licenses are found in every block", () => {
  const references = findLabFileReferences(TOPOLOGY);
  assert.deepEqual(
    references.map((reference) => [reference.kind, reference.nodeName, text(reference.start, reference.end)]),
    [
      ["bind", undefined, "common/motd.txt"],
      ["file", undefined, "licenses/srl.key"],
      ["file", undefined, "configs/leaf.cfg"],
      ["bind", "r1", "configs/r1.cfg"],
      ["bind", "r1", "/lib/modules"],
      ["file", "r2", "configs/r2.cfg"]
    ]
  );
  assert.equal(references[3].value, "configs/r1.cfg:/etc/r1.cfg:ro");
});

test("text without topology files or with YAML errors has no references", () => {
  assert.deepEqual(findLabFileReferences("name: dc\ntopology:\n  nodes: {}\n"), []);
  assert.deepEqual(findLabFileReferences("topology:\n  nodes:\n    r1: { binds: [a.cfg:/a\n"), []);
  assert.deepEqual(findLabFileReferences("binds:\n  - a.cfg:/a\n"), []);
});
