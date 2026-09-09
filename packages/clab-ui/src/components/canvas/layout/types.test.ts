import assert from "node:assert/strict";
import test from "node:test";

import type { Node } from "@xyflow/react";

import { normalizeLayoutableNodePositions } from "./types";

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
