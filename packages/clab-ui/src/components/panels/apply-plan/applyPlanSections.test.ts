import assert from "node:assert/strict";
import test from "node:test";

import { parseApplyPlan, type ApplyPlan } from "../../../host/applyPlan";

import {
  applyPlanChangeCount,
  applyPlanLosesState,
  buildApplyPlanSections
} from "./applyPlanSections";

function plan(value: Record<string, unknown>): ApplyPlan {
  const parsed = parseApplyPlan({ addedNodes: [], ...value });
  assert.ok(parsed);
  return parsed;
}

test("buildApplyPlanSections lists only the sections with changes, additions first", () => {
  const sections = buildApplyPlanSections(
    plan({
      deletedNodes: ["old"],
      addedNodes: ["leaf3"],
      restartedNodes: ["leaf1"],
      addedLinks: ["leaf3:e1-1 -- spine1:e1-3"],
      nodeChangeReasons: { leaf1: "added link" }
    })
  );

  assert.deepEqual(
    sections.map((section) => section.id),
    ["addedNodes", "restartedNodes", "deletedNodes", "addedLinks"]
  );
  assert.deepEqual(sections[1]?.items, [{ label: "leaf1", reason: "added link" }]);
  assert.deepEqual(sections[3]?.items, [{ label: "leaf3:e1-1  ↔  spine1:e1-3" }]);
});

test("applyPlanLosesState flags recreated and removed nodes", () => {
  assert.equal(applyPlanLosesState(plan({ restartedNodes: ["leaf1"] })), false);
  assert.equal(applyPlanLosesState(plan({ recreatedNodes: ["leaf1"] })), true);
  assert.equal(applyPlanLosesState(plan({ deletedNodes: ["leaf1"] })), true);
});

test("applyPlanChangeCount adds up every listed change", () => {
  assert.equal(
    applyPlanChangeCount(
      plan({ addedNodes: ["a", "b"], addedLinks: ["a:e1 -- b:e1"], deletedEndpoints: ["c:e1"] })
    ),
    4
  );
});
