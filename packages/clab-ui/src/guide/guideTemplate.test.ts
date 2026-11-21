import assert from "node:assert/strict";
import test from "node:test";

import { guideCodeBlocks, parseGuide } from "./parseGuide";
import { guideTemplate } from "./guideTemplate";

test("the starter guide uses the lab's own nodes", () => {
  const guide = parseGuide(guideTemplate("srl-pair", ["srl1", "srl2"]));
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
  const blocks = guideCodeBlocks(parseGuide(guideTemplate("solo", ["r1"])));
  assert.deepEqual(blocks.map((block) => block.nodes), [["r1"], ["r1"]]);
});

test("a lab without nodes gets a guide without runnable blocks", () => {
  const guide = parseGuide(guideTemplate("", []));
  assert.equal(guide.title, "Lab guide");
  assert.deepEqual(guideCodeBlocks(guide).map((block) => block.kind), ["copy"]);
});

test("a lab name YAML would misread stays the title", () => {
  assert.equal(parseGuide(guideTemplate("yes: no #1", ["a"])).title, "yes: no #1");
});
