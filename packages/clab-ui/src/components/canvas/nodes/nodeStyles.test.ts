import assert from "node:assert/strict";
import test from "node:test";

import { getNodeRuntimeIconOpacity } from "./nodeStyles";

test("stopped runtime nodes render with reduced icon opacity", () => {
  assert.equal(getNodeRuntimeIconOpacity("running"), 1);
  assert.equal(getNodeRuntimeIconOpacity("undeployed"), 1);
  assert.ok(getNodeRuntimeIconOpacity("paused") < 1);
  assert.ok(getNodeRuntimeIconOpacity("stopped") < getNodeRuntimeIconOpacity("paused"));
});
