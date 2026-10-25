import assert from "node:assert/strict";
import test from "node:test";

import { isNetemCleared } from "./netem.ts";

test("impairments with only zeros and blanks count as cleared", () => {
  assert.equal(isNetemCleared({ delay: "0ms", jitter: "0s", loss: "0%", rate: 0, corruption: "" }), true);
  assert.equal(isNetemCleared({ delay: "0ms" }), true);
  assert.equal(isNetemCleared({}), true);
});

test("any impairment value keeps netem set", () => {
  assert.equal(isNetemCleared({ delay: "10ms" }), false);
  assert.equal(isNetemCleared({ loss: "0.5%" }), false);
  assert.equal(isNetemCleared({ rate: 100 }), false);
  assert.equal(isNetemCleared(null), false);
  assert.equal(isNetemCleared({ delay: true }), false);
});
