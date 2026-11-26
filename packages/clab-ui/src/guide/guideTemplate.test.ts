import assert from "node:assert/strict";
import test from "node:test";

import { guideCodeBlocks, parseGuide } from "./parseGuide";
import { guideTemplate } from "./guideTemplate";

test("the starter guide uses the lab's own nodes", () => {
  const guide = parseGuide(guideTemplate("srl-pair", [{ name: "srl1" }, { name: "srl2" }]));
  assert.equal(guide.title, "srl-pair");
  assert.deepEqual(guide.steps.map((step) => step.title), ["Look around", "Work on a node"]);
  assert.deepEqual(
    guideCodeBlocks(guide).map(({ kind, nodes }) => ({ kind, nodes })),
    [
      { kind: "exec", nodes: ["srl1"] },
      { kind: "terminal", nodes: ["srl2"] }
    ]
  );
  assert.equal(guideCodeBlocks(guide)[0].command, "uname -a");
});

test("a lab with one node uses it for every block", () => {
  const blocks = guideCodeBlocks(parseGuide(guideTemplate("solo", [{ name: "r1" }])));
  assert.deepEqual(blocks.map((block) => block.nodes), [["r1"], ["r1"]]);
});

test("a lab without nodes gets a guide without runnable blocks", () => {
  const guide = parseGuide(guideTemplate("", []));
  assert.equal(guide.title, "Lab guide");
  assert.deepEqual(guideCodeBlocks(guide).map((block) => block.kind), ["copy"]);
});

test("a lab name YAML would misread stays the title", () => {
  assert.equal(parseGuide(guideTemplate("yes: no #1", [{ name: "a" }])).title, "yes: no #1");
});

test("the terminal block types what the node's shell understands", () => {
  const terminalOf = (kind?: string) =>
    guideCodeBlocks(parseGuide(guideTemplate("lab", [{ name: "a" }, { name: "b", kind }]))).find(
      (block) => block.kind === "terminal"
    );
  // A network OS opens its CLI, which knows no shell commands.
  for (const kind of ["nokia_srlinux", "cisco_xrd", "frr"]) {
    assert.equal(terminalOf(kind)?.code, "show version", kind);
  }
  // A Linux shell, BusyBox included: `ip -br` is not in BusyBox.
  for (const kind of ["linux", "nokia_sros", undefined]) {
    assert.equal(terminalOf(kind)?.code, "hostname\nip addr", String(kind));
  }
  assert.deepEqual(terminalOf("nokia_srlinux")?.nodes, ["b"]);
});
