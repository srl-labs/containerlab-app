import assert from "node:assert/strict";
import test from "node:test";

import type { Edge, Node } from "@xyflow/react";

import { allocateEndpoint, type EndpointAllocator } from "./endpointAllocator";

function kindNode(id: string, kind: string): Node {
  return { id, position: { x: 0, y: 0 }, data: { extraData: { kind } } };
}

/** Allocates `count` interfaces in a row on one node, as successive link creations would. */
function allocateMany(kind: string, count: number): string[] {
  const nodes = [kindNode("n1", kind)];
  const edges: Edge[] = [];
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const allocators = new Map<string, EndpointAllocator>();
    const name = allocateEndpoint(allocators, nodes, edges, "n1");
    names.push(name);
    edges.push({
      id: `e${index}`,
      source: "n1",
      target: `peer${index}`,
      data: { sourceEndpoint: name, targetEndpoint: "eth1" }
    });
  }
  return names;
}

test("spirent_stc nodes get portN interfaces", () => {
  assert.deepEqual(allocateMany("spirent_stc", 3), ["port1", "port2", "port3"]);
});

test("juniper_cjunosevolved nodes skip the reserved eth1-eth3", () => {
  assert.deepEqual(allocateMany("juniper_cjunosevolved", 2), ["eth4", "eth5"]);
});

test("cisco_iol nodes roll over to the next slot after three ports in slot 0", () => {
  assert.deepEqual(allocateMany("cisco_iol", 6), ["e0/1", "e0/2", "e0/3", "e1/0", "e1/1", "e1/2"]);
});

test("cisco_csr1000v and cisco_c8000v start at Gi2 because Gi1 is management", () => {
  assert.deepEqual(allocateMany("cisco_csr1000v", 2), ["Gi2", "Gi3"]);
  assert.deepEqual(allocateMany("cisco_c8000v", 1), ["Gi2"]);
});

test("kinds that reject ethX get their own interface names", () => {
  assert.deepEqual(allocateMany("nvidia_cumulusvx", 2), ["swp1", "swp2"]);
  assert.deepEqual(allocateMany("cumulus_cvx", 1), ["swp1"]);
  assert.deepEqual(allocateMany("arrcus_arcos", 1), ["swp1"]);
  assert.deepEqual(allocateMany("cisco_c8000", 2), ["FH0_0_0_0", "FH0_0_0_1"]);
});

test("XR kinds start at port 0", () => {
  assert.deepEqual(allocateMany("cisco_xrd", 2), ["Gi0-0-0-0", "Gi0-0-0-1"]);
  assert.deepEqual(allocateMany("cisco_xrd_vrouter", 1), ["Te0/0/0/0"]);
  assert.deepEqual(allocateMany("cisco_xrv9k", 1), ["Gi0/0/0/0"]);
});

test("VM kinds use the vendor interface names containerlab maps to ethN", () => {
  assert.deepEqual(allocateMany("cisco_n9kv", 2), ["Ethernet1/1", "Ethernet1/2"]);
  assert.deepEqual(allocateMany("juniper_vsrx", 2), ["ge-0/0/0", "ge-0/0/1"]);
  assert.deepEqual(allocateMany("juniper_vmx", 1), ["et-0/0/0"]);
  assert.deepEqual(allocateMany("fortinet_fortigate", 2), ["port2", "port3"]);
  assert.deepEqual(allocateMany("ciena_saos", 2), ["1", "2"]);
  assert.deepEqual(allocateMany("f5_bigip-ve", 2), ["1.1", "1.2"]);
  assert.deepEqual(allocateMany("mikrotik_ros", 1), ["ether2"]);
});

test("kinds without a pattern keep ethN", () => {
  assert.deepEqual(allocateMany("linux", 2), ["eth1", "eth2"]);
});
