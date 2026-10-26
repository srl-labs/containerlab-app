import assert from "node:assert/strict";
import test from "node:test";

import type { Node } from "@xyflow/react";

import { applyAnnotationZOrder, computeAnnotationZOrder } from "./annotationZOrder";

function annotation(id: string, type: string, x: number, zIndex?: number): Node {
  return {
    id,
    type,
    position: { x, y: 0 },
    width: 100,
    height: 50,
    ...(zIndex !== undefined ? { zIndex } : {}),
    data: zIndex !== undefined ? { zIndex } : {}
  };
}

const nodes: Node[] = [
  annotation("group", "group-node", 0, -1),
  annotation("shape", "free-shape-node", 50, -1),
  annotation("text", "free-text-node", 60),
  annotation("far", "free-text-node", 1000, 3),
  { id: "r1", type: "topology-node", position: { x: 0, y: 0 }, data: {} }
];

function changes(ids: string[], action: Parameters<typeof computeAnnotationZOrder>[2]) {
  return [...computeAnnotationZOrder(nodes, new Set(ids), action)];
}

test("front and back move past every other annotation", () => {
  assert.deepEqual(changes(["shape"], "front"), [["shape", 4]]);
  assert.deepEqual(changes(["text"], "back"), [["text", -2]]);
  // Several keep their order among themselves.
  assert.deepEqual(changes(["group", "text"], "back"), [
    ["group", -3],
    ["text", -2]
  ]);
});

test("forward and backward step past the next annotation they overlap", () => {
  // The text overlaps the shape below it but not the far text above it.
  assert.deepEqual(changes(["shape"], "forward"), [["shape", 1]]);
  assert.deepEqual(changes(["text"], "forward"), []);
  assert.deepEqual(changes(["text"], "backward"), [["text", -2]]);
});

test("groups stay behind topology nodes", () => {
  assert.deepEqual(changes(["group"], "front"), []);
  assert.deepEqual(changes(["group"], "back"), [["group", -2]]);
});

test("new stacking applies to the node and to the data the annotations file is written from", () => {
  const next = applyAnnotationZOrder(nodes, new Map([["text", 7]]));
  const text = next.find((node) => node.id === "text");
  assert.ok(text);
  assert.equal(text.zIndex, 7);
  assert.deepEqual(text.data, { zIndex: 7 });
  assert.equal(next[0], nodes[0]);
  assert.equal(applyAnnotationZOrder(nodes, new Map()), nodes);
});
