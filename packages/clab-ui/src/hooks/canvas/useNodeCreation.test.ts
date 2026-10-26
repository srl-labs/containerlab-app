import assert from "node:assert/strict";
import test from "node:test";

import type { CustomNodeTemplate } from "../../core/types/editors";

import { getUniqueId } from "../../core/utilities/idUtils";

import { createNameReservations, determineType } from "./useNodeCreation";

test("new nodes get containerlab's default type for their kind", () => {
  assert.equal(determineType("nokia_srlinux"), "ixr-d2l");
  assert.equal(determineType("nokia_srsim"), "SR-1");
  assert.equal(determineType("nokia_sros"), "sr-1");
});

test("kinds without a default type get no type", () => {
  assert.equal(determineType("linux"), undefined);
  assert.equal(determineType("juniper_cjunosevolved"), undefined);
  assert.equal(determineType("toString"), undefined);
});

test("a template type wins over the kind default", () => {
  const template = { name: "", kind: "nokia_srsim", type: "SR-7" } as CustomNodeTemplate;
  assert.equal(determineType("nokia_srsim", template), "SR-7");
});

test("named custom templates without a type get no default type", () => {
  const template = { name: "my-sros", kind: "nokia_sros" } as CustomNodeTemplate;
  assert.equal(determineType("nokia_sros", template), undefined);
});

test("deleting nodes frees their names for the next node", () => {
  let time = 0;
  const reservations = createNameReservations(() => time);
  const graph = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const id = getUniqueId("srl", reservations.usedIds(graph));
    graph.add(id);
    reservations.created(id, graph);
    time += 10;
  }
  assert.deepEqual([...graph], ["srl1", "srl2", "srl3"]);

  graph.clear();
  assert.equal(getUniqueId("srl", reservations.usedIds(graph)), "srl1");
});

test("two quick creations get different names before the first is in the graph", () => {
  let time = 0;
  const reservations = createNameReservations(() => time);
  const graph = new Set<string>();
  // The graph adds nodes later, e.g. after the host answered.
  const first = getUniqueId("srl", reservations.usedIds(graph));
  reservations.created(first, graph);
  time += 10;
  const second = getUniqueId("srl", reservations.usedIds(graph));
  assert.deepEqual([first, second], ["srl1", "srl2"]);

  // Once the node is in the graph and then deleted, its name is free again.
  graph.add(first);
  reservations.usedIds(graph);
  graph.delete(first);
  assert.equal(getUniqueId("srl", reservations.usedIds(graph)), "srl1");

  // A node that never reaches the graph frees its name after a while.
  reservations.created("srl7", graph);
  assert.equal(getUniqueId("srl", reservations.usedIds(graph)), "srl8");
  time += 10_000;
  assert.equal(getUniqueId("srl", reservations.usedIds(graph)), "srl1");
});
