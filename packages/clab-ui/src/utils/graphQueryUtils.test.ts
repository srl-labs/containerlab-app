import assert from "node:assert/strict";
import test from "node:test";

import type { TopoEdge, TopoNode } from "../core/types/graph";
import {
  collectDummyNodeIds,
  isDummyNode,
  markDummyEdgesHidden,
  markDummyNodesHidden
} from "./graphQueryUtils";

test("isDummyNode matches network nodes with a dummy nodeType", () => {
  assert.equal(isDummyNode({ type: "network-node", data: { nodeType: "dummy" } }), true);
  assert.equal(isDummyNode({ type: "network-node", data: { nodeType: "dummy0" } }), false);
  assert.equal(isDummyNode({ type: "network-node", data: { nodeType: "host" } }), false);
  assert.equal(isDummyNode({ type: "network-node", data: { nodeType: "mgmt-net" } }), false);
});

test("isDummyNode ignores topology nodes merely named like a dummy", () => {
  // The old id-prefix test would have caught this node and hidden a real device.
  assert.equal(
    isDummyNode({ type: "topology-node", data: { label: "dummy-router", kind: "nokia_srlinux" } }),
    false
  );
});

test("isDummyNode tolerates missing type and data", () => {
  assert.equal(isDummyNode({}), false);
  assert.equal(isDummyNode({ type: "network-node" }), false);
  assert.equal(isDummyNode({ type: "network-node", data: null }), false);
});

function topologyNode(id: string): TopoNode {
  return {
    id,
    type: "topology-node",
    position: { x: 0, y: 0 },
    data: { label: id, role: "router", kind: "nokia_srlinux" }
  };
}

function dummyNode(id: string): TopoNode {
  return {
    id,
    type: "network-node",
    position: { x: 0, y: 0 },
    data: { label: id, nodeType: "dummy" }
  };
}

function edge(id: string, source: string, target: string): TopoEdge {
  return { id, source, target };
}

const graphNodes = [topologyNode("leaf1"), topologyNode("dummy-router"), dummyNode("dummy0")];
const graphEdges = [edge("e1", "leaf1", "dummy-router"), edge("e2", "leaf1", "dummy0")];

test("collectDummyNodeIds picks up only real dummy endpoint nodes", () => {
  assert.deepEqual([...collectDummyNodeIds(graphNodes)], ["dummy0"]);
});

test("hiding keeps every node in the array and only flags the dummy", () => {
  const ids = collectDummyNodeIds(graphNodes);
  const marked = markDummyNodesHidden(graphNodes, ids, false);

  assert.equal(marked.length, graphNodes.length);
  assert.deepEqual(
    marked.map((node) => [node.id, node.hidden]),
    [
      ["leaf1", undefined],
      ["dummy-router", undefined],
      ["dummy0", true]
    ]
  );
});

test("hiding flags every link touching a dummy, from either endpoint", () => {
  const ids = collectDummyNodeIds(graphNodes);
  const marked = markDummyEdgesHidden([...graphEdges, edge("e3", "dummy0", "leaf1")], ids, false);

  assert.deepEqual(
    marked.map((e) => [e.id, e.hidden]),
    [
      ["e1", undefined],
      ["e2", true],
      ["e3", true]
    ]
  );
});

test("showing again clears the flag rather than leaving it stale", () => {
  const ids = collectDummyNodeIds(graphNodes);
  const hiddenNodes = markDummyNodesHidden(graphNodes, ids, false);
  const hiddenEdges = markDummyEdgesHidden(graphEdges, ids, false);

  const shownNodes = markDummyNodesHidden(hiddenNodes, ids, true);
  const shownEdges = markDummyEdgesHidden(hiddenEdges, ids, true);

  assert.equal(shownNodes.find((node) => node.id === "dummy0")?.hidden, false);
  assert.equal(shownEdges.find((e) => e.id === "e2")?.hidden, false);
});

test("a graph with no dummy nodes is returned untouched", () => {
  const nodes = [topologyNode("leaf1")];
  const edges = [edge("e1", "leaf1", "leaf1")];
  const ids = collectDummyNodeIds(nodes);

  assert.equal(markDummyNodesHidden(nodes, ids, false), nodes);
  assert.equal(markDummyEdgesHidden(edges, ids, false), edges);
});
