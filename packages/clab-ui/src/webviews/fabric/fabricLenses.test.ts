import assert from "node:assert/strict";
import test from "node:test";

import { disagreeingRts, hopsByStage, isFailedOutcome, serviceCards, summarizePath, summarizeWhere } from "./fabricLenses";
import type { FabricPathHop, FabricServiceRecord } from "./fabricTypes";

function hop(node: string, stage: number, outcome: string, peer = ""): FabricPathHop {
  return { node, hop: stage, ni: "default", address: "10.0.0.2", outcome, peer };
}

test("a path that arrives, over ECMP", () => {
  const hops = [
    hop("leaf1", 0, "forwarded", "spine1"),
    hop("leaf1", 0, "forwarded", "spine2"),
    hop("spine1", 1, "forwarded", "leaf2"),
    hop("spine2", 1, "forwarded", "leaf2"),
    hop("leaf2", 2, "delivered")
  ];
  const summary = summarizePath(hops);
  assert.deepEqual(summary.stages, [["leaf1"], ["spine1", "spine2"], ["leaf2"]]);
  assert.equal(summary.hops, 2);
  assert.deepEqual(summary.arrived.map((end) => end.node), ["leaf2"]);
  assert.equal(summary.failed.length, 0);
  assert.equal(hopsByStage(hops).map((stage) => stage.length).join(), "2,2,1");
});

test("a path cut short still counts the cable to its peer", () => {
  const summary = summarizePath([hop("leaf1", 0, "forwarded", "spine1"), hop("spine1", 1, "no-route")]);
  assert.equal(summary.hops, 1);
  assert.deepEqual(summary.failed.map((end) => end.node), ["spine1"]);
  assert.equal(isFailedOutcome("no-route"), true);
  assert.equal(isFailedOutcome("forwarded"), false);
});

test("a path that never left its node", () => {
  const summary = summarizePath([hop("spine1", 0, "delivered")]);
  assert.equal(summary.hops, 0);
  assert.equal(summary.arrived.length, 1);
});

test("where an address is, and whether its holders agree", () => {
  assert.deepEqual(summarizeWhere([{ node: "-", kind: "not-found" }]), {
    found: false,
    duplicate: false,
    multihomed: false,
    places: 1,
    nodes: ["-"]
  });
  const summary = summarizeWhere([
    { node: "leaf2", kind: "duplicate" },
    { node: "leaf10", kind: "duplicate" },
    { node: "leaf2", kind: "arp" }
  ]);
  assert.equal(summary.found, true);
  assert.equal(summary.duplicate, true);
  assert.deepEqual(summary.nodes, ["leaf2", "leaf10"]);
  assert.equal(summarizeWhere([]).found, false);
});

function service(node: string, extra: Partial<FabricServiceRecord> = {}): FabricServiceRecord {
  return { node, name: "macvrf-1", type: "mac-vrf", oper: "up", group: "g1", vnis: [100], macs_local: 2, ...extra };
}

test("a service is one card, with its nodes and what they carry", () => {
  const [card, ...rest] = serviceCards([service("leaf2"), service("leaf10"), service("leaf1", { group: "g2", name: "ipvrf-1", type: "ip-vrf" })]);
  assert.equal(rest.length, 1);
  assert.ok(card);
  assert.equal(card.id, "g2");
  const macvrf = rest[0];
  assert.ok(macvrf);
  assert.deepEqual(macvrf.nodes, ["leaf2", "leaf10"]);
  assert.deepEqual(macvrf.vnis, [100]);
  assert.equal(macvrf.macs, 4);
  assert.equal(macvrf.state, "up");
});

test("a service's state says when its nodes disagree, and services with issues come first", () => {
  const cards = serviceCards([
    service("leaf1", { group: "a" }),
    service("leaf2", { group: "b", oper: "down", issues: ["vni differs"] }),
    service("leaf3", { group: "b" })
  ]);
  assert.equal(cards[0]?.id, "b");
  assert.equal(cards[0]?.state, "mixed");
  assert.equal(cards[0]?.issues, 1);
  assert.equal(cards[1]?.state, "up");
});

test("a route-target only one node has is what disagrees", () => {
  const vpn = (...rts: string[]) => [{ import_rts: rts }];
  const [card] = serviceCards([
    service("leaf1", { vpn: vpn("target:1:1") }),
    service("leaf2", { vpn: vpn("target:1:1", "target:9:9") })
  ]);
  assert.ok(card);
  assert.deepEqual([...disagreeingRts(card)], [["leaf2", ["target:9:9"]]]);
  const [lone] = serviceCards([service("leaf1", { vpn: vpn("target:1:1") })]);
  assert.ok(lone);
  assert.equal(disagreeingRts(lone).size, 0);
});
