import assert from "node:assert/strict";
import test from "node:test";

import { isTopologyFileName } from "../host/topologyVariables";

import { guideFileNameFor } from "./guideFile";

test("a topology's guide has its name with the .clab.md suffix", () => {
  assert.equal(guideFileNameFor("srl-pair.clab.yml"), "srl-pair.clab.md");
  assert.equal(guideFileNameFor("srl-pair.clab.yaml"), "srl-pair.clab.md");
  assert.equal(guideFileNameFor("fabric.clab.gotmpl"), "fabric.clab.md");
  assert.equal(guideFileNameFor("Upper.CLAB.YML"), "Upper.clab.md");
});

test("only topology files have a guide", () => {
  assert.equal(guideFileNameFor("notes.yml"), undefined);
  assert.equal(guideFileNameFor("srl-pair.clab.md"), undefined);
});

test("a guide is never taken for a topology", () => {
  assert.equal(isTopologyFileName("srl-pair.clab.md"), false);
});
