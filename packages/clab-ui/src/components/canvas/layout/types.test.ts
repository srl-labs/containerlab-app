import assert from "node:assert/strict";
import test from "node:test";

import type { Node, Edge } from "@xyflow/react";

import { applyLayout } from "../layout";
import { hasPresetPositions, isLayoutParticipant, normalizeLayoutableNodePositions } from "./types";

function node(id: string, type: string, x: number, y: number): Node {
  return {
    id,
    type,
    position: { x, y },
    data: {}
  };
}

test("normalizes and extracts only layoutable node positions", () => {
  const topologyNode = node("leaf1", "topology-node", 10.2, 20.8);
  const networkNode = node("mgmt", "network-node", 30.4, 40.4);
  const annotationNode = node("traffic-rate-1", "traffic-rate-node", 50.2, 60.8);
  const nodes = [topologyNode, networkNode, annotationNode];

  const result = normalizeLayoutableNodePositions(nodes, (position) => ({
    x: Math.round(position.x),
    y: Math.round(position.y)
  }));

  assert.deepEqual(result.positions, [
    { id: "leaf1", position: { x: 10, y: 21 } },
    { id: "mgmt", position: { x: 30, y: 40 } }
  ]);
  assert.deepEqual(result.nodes[0]?.position, { x: 10, y: 21 });
  assert.deepEqual(result.nodes[1]?.position, { x: 30, y: 40 });
  assert.equal(result.nodes[2], annotationNode);
});

test("preserves hidden node positions without snapping them to the grid", () => {
  const hiddenNode = { ...node("dummy0", "network-node", 30.4, 40.4), hidden: true };
  const nodes = [node("leaf1", "topology-node", 10.2, 20.8), hiddenNode];

  const result = normalizeLayoutableNodePositions(nodes, (position) => ({
    x: Math.round(position.x),
    y: Math.round(position.y)
  }));

  assert.deepEqual(result.positions, [
    { id: "leaf1", position: { x: 10, y: 21 } },
    { id: "dummy0", position: { x: 30.4, y: 40.4 } }
  ]);
  assert.equal(result.nodes[1], hiddenNode);
});

test("isLayoutParticipant excludes hidden nodes and non-layoutable types", () => {
  assert.equal(isLayoutParticipant(node("leaf1", "topology-node", 0, 0)), true);
  assert.equal(isLayoutParticipant(node("mgmt", "network-node", 0, 0)), true);
  assert.equal(isLayoutParticipant(node("text-1", "free-text-node", 0, 0)), false);
  assert.equal(
    isLayoutParticipant({ ...node("dummy0", "network-node", 0, 0), hidden: true }),
    false
  );
});

test("hasPresetPositions ignores positions of hidden nodes", () => {
  const visibleAtOrigin = node("leaf1", "topology-node", 0, 0);
  const hiddenWithPosition = { ...node("dummy0", "network-node", 400, 300), hidden: true };

  assert.equal(hasPresetPositions([visibleAtOrigin, hiddenWithPosition]), false);
  assert.equal(
    hasPresetPositions([node("leaf1", "topology-node", 400, 300), hiddenWithPosition]),
    true
  );
});

for (const layout of ["force", "auto", "radial"] as const) {
  test(`${layout} ignores hidden elements while preserving their positions and metadata`, async () => {
    const visibleNodes = [
      node("leaf1", "topology-node", 10, 20),
      node("leaf2", "topology-node", 30, 40)
    ];
    const hiddenNode = {
      ...node("dummy0", "network-node", 900.5, 700.5),
      hidden: true,
      data: { nodeType: "dummy", layer: 4 }
    };
    const annotationNode = node("note", "free-text-node", 50, 60);
    const visibleEdges: Edge[] = [{ id: "real", source: "leaf1", target: "leaf2" }];
    const hiddenEdges: Edge[] = [
      {
        id: "dummy",
        source: "leaf1",
        target: "dummy0",
        hidden: true,
        data: { topologyType: "mesh" }
      },
      { id: "hidden-real", source: "leaf1", target: "leaf2", hidden: true }
    ];
    const expected = await applyLayout(layout, visibleNodes, visibleEdges);
    const actual = await applyLayout(
      layout,
      [...visibleNodes, hiddenNode, annotationNode],
      [...visibleEdges, ...hiddenEdges]
    );

    assert.deepEqual(actual.nodes.slice(0, 2), expected.nodes);
    assert.equal(actual.nodes[2], hiddenNode);
    assert.equal(actual.nodes[3], annotationNode);
    assert.deepEqual(actual.edges.slice(1), hiddenEdges);
  });
}
