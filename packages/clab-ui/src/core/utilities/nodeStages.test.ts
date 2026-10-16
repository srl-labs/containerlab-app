import assert from "node:assert/strict";
import test from "node:test";

import {
  findWaitForCycle,
  getNodeWaitForDependencies,
  listWaitForDependencies,
  mergeNodeStages,
  parseNodeStages,
  serializeNodeStages
} from "./nodeStages";

test("parseNodeStages reads wait-for and exec lists", () => {
  const stages = parseNodeStages({
    create: { "wait-for": [{ node: "node2", stage: "healthy" }] },
    "create-links": {
      exec: [
        { command: "ls /sys/class/net/", phase: "on-enter" },
        { command: "touch /tmp/x", phase: "on-exit", target: "host" }
      ]
    },
    bogus: { "wait-for": [{ node: "x" }] }
  });
  assert.deepEqual(stages, {
    create: { waitFor: [{ node: "node2", stage: "healthy" }] },
    "create-links": {
      exec: [
        { command: "ls /sys/class/net/", phase: "on-enter" },
        { command: "touch /tmp/x", phase: "on-exit", target: "host" }
      ]
    }
  });
});

test("parseNodeStages turns the phase map form into list entries", () => {
  assert.deepEqual(parseNodeStages({ healthy: { exec: { "on-enter": ["a"], "on-exit": ["b"] } } }), {
    healthy: {
      exec: [
        { command: "a", phase: "on-enter" },
        { command: "b", phase: "on-exit" }
      ]
    }
  });
});

test("parseNodeStages returns undefined for empty or invalid stages", () => {
  assert.equal(parseNodeStages(undefined), undefined);
  assert.equal(parseNodeStages({ create: {} }), undefined);
  assert.equal(parseNodeStages(["create"]), undefined);
});

test("serializeNodeStages drops blank rows and keeps stage order", () => {
  assert.deepEqual(
    serializeNodeStages({
      healthy: { exec: [{ command: " ", phase: "on-enter" }] },
      configure: { exec: [{ command: "echo hi", phase: "on-exit", target: "host" }] },
      create: {
        waitFor: [
          { node: " spine1 ", stage: "healthy" },
          { node: "", stage: "create" }
        ]
      }
    }),
    {
      create: { "wait-for": [{ node: "spine1", stage: "healthy" }] },
      configure: { exec: [{ command: "echo hi", phase: "on-exit", target: "host" }] }
    }
  );
  assert.deepEqual(Object.keys(serializeNodeStages({ exit: { waitFor: [{ node: "a", stage: "exit" }] }, create: { waitFor: [{ node: "b", stage: "create" }] } }) ?? {}), ["create", "exit"]);
});

test("serializeNodeStages returns null when nothing is left", () => {
  assert.equal(serializeNodeStages(undefined), null);
  assert.equal(serializeNodeStages({}), null);
  assert.equal(serializeNodeStages({ create: { waitFor: [{ node: "", stage: "create" }] } }), null);
});

test("mergeNodeStages adds up levels like containerlab", () => {
  const merged = mergeNodeStages([
    { create: { waitFor: [{ node: "a", stage: "healthy" }], exec: [{ command: "one" }] } },
    undefined,
    {
      create: {
        waitFor: [
          { node: "a", stage: "healthy" },
          { node: "b", stage: "create" }
        ],
        exec: [{ command: "one" }]
      }
    }
  ]);
  assert.deepEqual(merged, {
    create: {
      waitFor: [
        { node: "a", stage: "healthy" },
        { node: "b", stage: "create" }
      ],
      // exec commands are appended, even when repeated
      exec: [{ command: "one" }, { command: "one" }]
    }
  });
});

test("getNodeWaitForDependencies combines inherited and own stages", () => {
  const deps = getNodeWaitForDependencies("leaf1", {
    stages: { configure: { "wait-for": [{ node: "spine1", stage: "configure" }] } },
    inheritedStages: [
      { level: "defaults", stages: { create: { "wait-for": [{ node: "ca", stage: "healthy" }] } } }
    ]
  });
  assert.deepEqual(deps, [
    { node: "leaf1", nodeStage: "create", dependsOn: "ca", dependsOnStage: "healthy" },
    { node: "leaf1", nodeStage: "configure", dependsOn: "spine1", dependsOnStage: "configure" }
  ]);
});

test("findWaitForCycle finds loops whatever the stages", () => {
  const deps = [
    ...listWaitForDependencies("a", { create: { waitFor: [{ node: "b", stage: "healthy" }] } }),
    ...listWaitForDependencies("b", { exit: { waitFor: [{ node: "c", stage: "create" }] } }),
    ...listWaitForDependencies("c", { configure: { waitFor: [{ node: "a", stage: "exit" }] } })
  ];
  assert.deepEqual(findWaitForCycle(deps), ["a", "b", "c", "a"]);
  assert.deepEqual(findWaitForCycle(deps, "b"), ["b", "c", "a", "b"]);
  assert.equal(findWaitForCycle(deps.slice(0, 2)), null);
});

test("findWaitForCycle reports a node that waits for itself", () => {
  const deps = listWaitForDependencies("a", { create: { waitFor: [{ node: "a", stage: "create" }] } });
  assert.deepEqual(findWaitForCycle(deps), ["a", "a"]);
});

test("findWaitForCycle with a start node ignores loops it cannot reach", () => {
  const deps = [
    ...listWaitForDependencies("x", { create: { waitFor: [{ node: "y", stage: "create" }] } }),
    ...listWaitForDependencies("y", { create: { waitFor: [{ node: "x", stage: "create" }] } }),
    ...listWaitForDependencies("a", { create: { waitFor: [{ node: "b", stage: "create" }] } })
  ];
  assert.equal(findWaitForCycle(deps, "a"), null);
});
