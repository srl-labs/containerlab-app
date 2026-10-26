import assert from "node:assert/strict";
import test from "node:test";

import type { Node } from "@xyflow/react";

import { buildAlignmentIndex, calculateAlignments } from "./useHelperLines";

function node(
  id: string,
  x: number,
  y: number,
  options: { size?: number; width?: number; height?: number; type?: string } = {}
): Node {
  const size = options.size ?? 40;
  return {
    id,
    type: options.type ?? "topology-node",
    position: { x, y },
    measured: { width: options.width ?? size, height: options.height ?? size },
    data: {}
  };
}

function align(dragged: Node, others: Node[]) {
  return calculateAlignments(dragged, buildAlignmentIndex([dragged, ...others], new Set([dragged.id])));
}

test("snaps edges within the threshold and leaves distant nodes alone", () => {
  const near = align(node("c", 203, 97), [node("a", 200, 100)]);
  assert.deepEqual(near.snap, { x: 200, y: 100 });
  assert.equal(near.lines.vertical, 200);
  assert.equal(near.lines.horizontal, 100);

  const far = align(node("c", 260, 180), [node("a", 200, 100)]);
  assert.deepEqual(far.snap, { x: null, y: null });
  assert.equal(far.lines.vertical, null);
  assert.equal(far.lines.horizontal, null);
});

test("repeats the gap of a row next to the dragged node", () => {
  // a and b are 60 apart; c lands 60 after b.
  const result = align(node("c", 203, 2), [node("a", 0, 0), node("b", 100, 0)]);
  assert.deepEqual(result.snap, { x: 200, y: 0 });
  assert.deepEqual(
    result.lines.gaps.map(({ axis, start, end }) => ({ axis, start, end })),
    [
      { axis: "x", start: 40, end: 100 },
      { axis: "x", start: 140, end: 200 }
    ]
  );
  assert.ok(result.lines.gaps.every((gap) => gap.offset === 20));
});

test("repeats a row gap on the side before the dragged node", () => {
  const result = align(node("c", -103, 0), [node("a", 0, 0), node("b", 100, 0)]);
  assert.equal(result.snap.x, -100);
  assert.equal(result.lines.gaps.length, 2);
});

test("centers the dragged node between its neighbours", () => {
  const result = align(node("c", 103, 0), [node("a", 0, 0), node("b", 200, 0)]);
  assert.equal(result.snap.x, 100);
  // Same sizes: the equal gaps and the center midpoint agree.
  assert.equal(result.lines.verticalMidpoint, 120);
  assert.deepEqual(
    result.lines.gaps.map(({ start, end }) => [start, end]),
    [
      [40, 100],
      [140, 200]
    ]
  );
});

test("tells equal gaps from centered between neighbours of different sizes", () => {
  const row = [node("a", 0, 0), node("b", 200, 0, { size: 80 })];

  const gaps = align(node("c", 103, 0), row);
  assert.equal(gaps.snap.x, 100);
  assert.equal(gaps.lines.verticalMidpoint, null);
  assert.equal(gaps.lines.gaps.length, 2);

  const centered = align(node("c", 108, 0), row);
  assert.equal(centered.snap.x, 110);
  assert.equal(centered.lines.verticalMidpoint, 130);
  assert.deepEqual(centered.lines.gaps, []);
});

test("matches gaps in a column", () => {
  const result = align(node("c", 1, 198), [node("a", 0, 0), node("b", 0, 100)]);
  assert.deepEqual(result.snap, { x: 0, y: 200 });
  assert.deepEqual(
    result.lines.gaps.map(({ axis, start, end, offset }) => ({ axis, start, end, offset })),
    [
      { axis: "y", start: 40, end: 100, offset: 20 },
      { axis: "y", start: 140, end: 200, offset: 20 }
    ]
  );
});

test("ignores gaps of nodes outside the dragged node's row", () => {
  const result = align(node("c", 203, 300), [node("a", 0, 0), node("b", 100, 0)]);
  assert.equal(result.snap.x, null);
  assert.deepEqual(result.lines.gaps, []);
});

test("does not snap between neighbours away from the center", () => {
  const result = align(node("c", 70, 0), [node("a", 0, 0), node("b", 200, 0)]);
  assert.equal(result.snap.x, null);
  assert.equal(result.lines.verticalMidpoint, null);
  assert.deepEqual(result.lines.gaps, []);
});

test("matches spacing only between topology nodes", () => {
  const text = node("c", 203, 2, { type: "free-text-node" });
  const result = align(text, [node("a", 0, 0), node("b", 100, 0)]);
  assert.equal(result.snap.x, null);
  assert.deepEqual(result.lines.gaps, []);

  const group = node("g", -20, -20, { width: 400, height: 80, type: "group-node" });
  const inGroup = align(node("c", 203, 2), [group, node("a", 0, 0), node("b", 100, 0)]);
  assert.equal(inGroup.snap.x, 200);
});

test("excluded nodes, such as the rest of a dragged selection, are no guides", () => {
  const dragged = node("c", 203, 97);
  const index = buildAlignmentIndex([dragged, node("a", 200, 100)], new Set(["c", "a"]));
  assert.deepEqual(calculateAlignments(dragged, index).snap, { x: null, y: null });
});

test("the closest guide wins and only guides that hold are shown", () => {
  const row = [node("a", 0, 0), node("b", 100, 0)];

  // d's edges are 1px away, the repeated gap 2px.
  const edge = align(node("c", 198, 0), [...row, node("d", 197, 500)]);
  assert.equal(edge.snap.x, 197);
  assert.equal(edge.lines.vertical, 197);
  assert.deepEqual(edge.lines.gaps, []);

  // d's edges are 3px away, the repeated gap still 2px.
  const gap = align(node("c", 198, 0), [...row, node("d", 195, 500)]);
  assert.equal(gap.snap.x, 200);
  assert.equal(gap.lines.vertical, null);
  assert.equal(gap.lines.gaps.length, 2);
});
