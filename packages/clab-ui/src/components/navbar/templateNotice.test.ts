import assert from "node:assert/strict";
import test from "node:test";

import { templateProblem } from "./templateNotice";

const FILE = "fabric.clab.gotmpl";

test("a template that renders has no problem to report", () => {
  assert.equal(templateProblem({ source: "rendered" }, FILE), undefined);
  assert.equal(
    templateProblem({ source: "rendered", varsFiles: ["fabric.clab_vars.yml"] }, FILE),
    undefined
  );
});

test("each way a template falls short says what the canvas shows instead", () => {
  assert.equal(
    templateProblem({ source: "rendered", error: 'node "leaf1" has no image' }, FILE),
    'containerlab rejects the topology fabric.clab.gotmpl renders to: node "leaf1" has no image'
  );
  assert.equal(
    templateProblem({ source: "last-rendered", error: "unexpected EOF" }, FILE),
    "fabric.clab.gotmpl no longer renders, so the canvas keeps its last rendering: unexpected EOF"
  );
  assert.equal(
    templateProblem({ source: "text", error: "needs containerlab 0.78 or newer." }, FILE),
    "containerlab could not render fabric.clab.gotmpl, so the canvas shows it as written: needs containerlab 0.78 or newer."
  );
});
