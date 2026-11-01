import assert from "node:assert/strict";
import test from "node:test";

import { applyPlanHasChanges, parseApplyPlan } from "./applyPlan";

test("parseApplyPlan reads the API's camelCase result", () => {
  const plan = parseApplyPlan({
    dryRun: true,
    deployedLab: false,
    labName: "lab",
    addedNodes: ["leaf3"],
    deletedNodes: [],
    recreatedNodes: ["spine1"],
    startedNodes: [],
    addedLinks: ["leaf3:e1-1 -- spine1:e1-3"],
    deletedEndpoints: [],
    restartedNodes: [],
    nodeChangeReasons: { spine1: "config drift: image" }
  });

  assert.ok(plan);
  assert.equal(plan.deploysLab, false);
  assert.deepEqual(plan.addedNodes, ["leaf3"]);
  assert.deepEqual(plan.recreatedNodes, ["spine1"]);
  assert.deepEqual(plan.addedLinks, ["leaf3:e1-1 -- spine1:e1-3"]);
  assert.deepEqual(plan.nodeChangeReasons, { spine1: "config drift: image" });
  assert.equal(applyPlanHasChanges(plan), true);
});

test("parseApplyPlan reads the CLI's kebab-case JSON", () => {
  const plan = parseApplyPlan({
    "dry-run": true,
    "deployed-lab": false,
    "added-nodes": [],
    "deleted-nodes": ["old"],
    "recreated-nodes": [],
    "started-nodes": [],
    "added-links": [],
    "deleted-endpoints": ["leaf1:e1-9"],
    "restarted-nodes": ["leaf1"],
    "node-change-reasons": { leaf1: "removed link" }
  });

  assert.ok(plan);
  assert.deepEqual(plan.deletedNodes, ["old"]);
  assert.deepEqual(plan.deletedEndpoints, ["leaf1:e1-9"]);
  assert.deepEqual(plan.restartedNodes, ["leaf1"]);
  assert.deepEqual(plan.nodeChangeReasons, { leaf1: "removed link" });
});

test("parseApplyPlan tells an in-sync lab from an unknown answer", () => {
  const inSync = parseApplyPlan({ deployedLab: false, addedNodes: [], deletedNodes: [] });
  assert.ok(inSync);
  assert.equal(applyPlanHasChanges(inSync), false);

  assert.equal(parseApplyPlan(undefined), undefined);
  assert.equal(parseApplyPlan("Apply plan"), undefined);
  assert.equal(parseApplyPlan({ message: "ok" }), undefined);
});

test("parseApplyPlan marks a lab that apply would deploy", () => {
  const plan = parseApplyPlan({ "deployed-lab": true, "lab-name": "lab" });
  assert.ok(plan);
  assert.equal(plan.deploysLab, true);
  assert.deepEqual(plan.addedNodes, []);
  assert.equal(applyPlanHasChanges(plan), true);
});

test("parseApplyPlan drops entries that are not names", () => {
  const plan = parseApplyPlan({
    addedNodes: ["leaf3", 7, "", null],
    nodeChangeReasons: { leaf3: "", spine1: 4, leaf1: "added link" }
  });
  assert.ok(plan);
  assert.deepEqual(plan.addedNodes, ["leaf3"]);
  assert.deepEqual(plan.nodeChangeReasons, { leaf1: "added link" });
});

test("parseApplyPlan keeps the resource changes of a c9s plan", () => {
  const plan = parseApplyPlan({
    dryRun: true,
    deployedLab: false,
    namespace: "c9s-demo",
    recreatedNodes: ["n1"],
    changes: [
      { action: "recreate", kind: "Node", namespace: "c9s-demo", name: "n1" },
      { action: "update", kind: "Topology", name: "demo" },
      { action: "explode", kind: "Node", name: "bad" },
      { action: "create", kind: "Node" }
    ]
  });
  assert.ok(plan);
  assert.equal(plan.namespace, "c9s-demo");
  assert.deepEqual(plan.changes, [
    { action: "recreate", kind: "Node", namespace: "c9s-demo", name: "n1" },
    { action: "update", kind: "Topology", name: "demo" }
  ]);
  assert.equal(applyPlanHasChanges(plan), true);
  // A Topology change alone is a change too.
  const topologyOnly = parseApplyPlan({ changes: [{ action: "update", kind: "Topology", name: "demo" }] });
  assert.ok(topologyOnly);
  assert.equal(applyPlanHasChanges(topologyOnly), true);
  const none = parseApplyPlan({ changes: [] });
  assert.ok(none);
  assert.equal(applyPlanHasChanges(none), false);
});
