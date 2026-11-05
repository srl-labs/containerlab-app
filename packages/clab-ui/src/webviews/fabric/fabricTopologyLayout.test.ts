import assert from "node:assert/strict";
import test from "node:test";

import { cablePath, fitView, layoutTopology, trafficLevel, zoomView } from "./fabricTopologyLayout";
import type { FabricAttachedClient, FabricTopology } from "./fabricTypes";

function client(id: string, nodes: string[]): FabricAttachedClient {
  return { id, label: id, nodes, attachments: [] };
}

const GRAPH: FabricTopology = {
  nodes: [
    { name: "spine1", tier: "spine", asn: 65000 },
    { name: "leaf2", tier: "leaf" },
    { name: "leaf10", tier: "leaf" }
  ],
  links: [],
  clients: [client("host1", ["leaf2"]), client("host2", ["leaf2", "leaf10"])],
  segments: [],
  components: [{ name: "fabric", nodes: ["spine1", "leaf2", "leaf10"] }]
};

test("tiers are rows from the top down, names in reading order", () => {
  const { nodes, labels } = layoutTopology(GRAPH, false);
  const spine = nodes.get("spine1");
  const leaf2 = nodes.get("leaf2");
  const leaf10 = nodes.get("leaf10");
  assert.ok(spine && leaf2 && leaf10);
  assert.ok(spine.y < leaf2.y);
  assert.equal(leaf2.y, leaf10.y);
  assert.ok(leaf2.x < leaf10.x);
  assert.deepEqual(labels.map((label) => label.text), ["spine", "leaf"]);
});

test("the row above is centred over the wider one", () => {
  const { nodes } = layoutTopology(GRAPH, false);
  const [spine, leaf2, leaf10] = [nodes.get("spine1"), nodes.get("leaf2"), nodes.get("leaf10")];
  assert.ok(spine && leaf2 && leaf10);
  assert.equal(spine.x, (leaf2.x + leaf10.x) / 2);
});

test("clients only appear when shown, under their nodes and apart", () => {
  assert.equal(layoutTopology(GRAPH, false).clients.size, 0);
  const { clients, nodes } = layoutTopology(GRAPH, true);
  const [host1, host2, leaf2] = [clients.get("host1"), clients.get("host2"), nodes.get("leaf2")];
  assert.ok(host1 && host2 && leaf2);
  assert.ok(host1.y > leaf2.y);
  assert.ok(host2.x - host1.x >= 124);
});

test("the node box grows for the lines some node has", () => {
  const plain = { ...GRAPH, nodes: GRAPH.nodes.map((node) => ({ ...node, asn: null })) };
  assert.ok(layoutTopology(GRAPH, false).nodeHeight > layoutTopology(plain, false).nodeHeight);
});

test("several components stack, each with its title", () => {
  const { titles, nodes } = layoutTopology(
    { ...GRAPH, components: [{ name: "a", nodes: ["leaf2"] }, { name: "b", nodes: ["leaf10"] }] },
    false
  );
  assert.deepEqual(titles.map((title) => title.name), ["a", "b"]);
  const [first, second] = [nodes.get("leaf2"), nodes.get("leaf10")];
  assert.ok(first && second);
  assert.ok(second.y > first.y);
});

test("nodes of a tier the drawing does not know are still drawn", () => {
  const { nodes } = layoutTopology(
    { ...GRAPH, nodes: [{ name: "x", tier: "new-tier" }], components: [{ name: "c", nodes: ["x"] }] },
    false
  );
  assert.ok(nodes.get("x"));
});

test("an empty fabric draws nothing, without failing", () => {
  const layout = layoutTopology({ nodes: [], links: [], clients: [], segments: [], components: [] }, true);
  assert.equal(layout.nodes.size, 0);
});

test("a cable between rows is straight, along a row it arcs", () => {
  const straight = cablePath({ x: 0, y: 0 }, { x: 100, y: 100 }, 50);
  assert.equal(straight.d, "M0,25 L100,75");
  assert.deepEqual(straight.mid, { x: 50, y: 50 });
  const arc = cablePath({ x: 0, y: 0 }, { x: 100, y: 0 }, 50);
  assert.match(arc.d, /Q/);
  assert.ok(arc.mid.y < -25);
});

test("fitting never enlarges and centres the drawing", () => {
  assert.deepEqual(fitView({ width: 100, height: 100 }, { width: 300, height: 300 }), { x: 100, y: 100, k: 1 });
  assert.equal(fitView({ width: 400, height: 100 }, { width: 200, height: 300 }).k, 0.5);
});

test("zooming keeps the point under the cursor in place, within limits", () => {
  const view = zoomView({ x: 0, y: 0, k: 1 }, 2, { x: 50, y: 50 });
  assert.deepEqual(view, { x: -50, y: -50, k: 2 });
  assert.equal(zoomView({ x: 0, y: 0, k: 3 }, 2, { x: 0, y: 0 }).k, 3);
  assert.equal(zoomView({ x: 0, y: 0, k: 0.2 }, 0.5, { x: 0, y: 0 }).k, 0.2);
});

test("traffic levels by share of the full rate", () => {
  assert.equal(trafficLevel(null, 100), "none");
  assert.equal(trafficLevel(10, 100), "low");
  assert.equal(trafficLevel(30, 100), "medium");
  assert.equal(trafficLevel(60, 100), "high");
  assert.equal(trafficLevel(90, 100), "full");
});
