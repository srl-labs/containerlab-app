import assert from "node:assert/strict";
import test from "node:test";

import { parse } from "yaml";

import { generateClosTopologyYaml } from "./closTopology";

test("a Clos topology links every node to every node of the next tier, like containerlab generate", () => {
  const topology = parse(
    generateClosTopologyYaml({
      name: "fab",
      tiers: [
        { count: 2, kind: "nokia_srlinux", type: "ixr-d2l" },
        { count: 2, kind: "arista_ceos" },
        { count: 1, kind: "linux" }
      ],
      images: { nokia_srlinux: "srl:1", linux: "alpine:3", arista_ceos: "ceos:4" },
      licenses: { nokia_srlinux: "/lic" },
      ipv4Subnet: "10.1.0.0/24"
    })
  ) as Record<string, unknown>;

  assert.deepEqual(topology, {
    name: "fab",
    mgmt: { "ipv4-subnet": "10.1.0.0/24" },
    topology: {
      kinds: {
        arista_ceos: { image: "ceos:4" },
        linux: { image: "alpine:3" },
        nokia_srlinux: { image: "srl:1", license: "/lic" }
      },
      nodes: {
        "node1-1": { kind: "nokia_srlinux", group: "tier-1", type: "ixr-d2l" },
        "node1-2": { kind: "nokia_srlinux", group: "tier-1", type: "ixr-d2l" },
        "node2-1": { kind: "arista_ceos", group: "tier-2" },
        "node2-2": { kind: "arista_ceos", group: "tier-2" },
        "node3-1": { kind: "linux", group: "tier-3" }
      },
      links: [
        { endpoints: ["node1-1:e1-1", "node2-1:eth1"] },
        { endpoints: ["node1-1:e1-2", "node2-2:eth1"] },
        { endpoints: ["node1-2:e1-1", "node2-1:eth2"] },
        { endpoints: ["node1-2:e1-2", "node2-2:eth2"] },
        // Uplinks come after the links to the tier below.
        { endpoints: ["node2-1:eth3", "node3-1:eth1"] },
        { endpoints: ["node2-2:eth3", "node3-1:eth2"] }
      ]
    }
  });
});

test("a single tier has no links, and unknown kinds are refused", () => {
  const topology = parse(
    generateClosTopologyYaml({ name: "one", tiers: [{ count: 2, kind: "linux" }], images: {} })
  ) as { topology: Record<string, unknown> };
  assert.deepEqual(Object.keys(topology.topology), ["nodes"]);
  assert.throws(
    () => generateClosTopologyYaml({ name: "x", tiers: [{ count: 1, kind: "ext-container" }], images: {} }),
    /cannot be generated/
  );
  assert.throws(() => generateClosTopologyYaml({ name: "a b", tiers: [{ count: 1 }], images: {} }), /lab name/);
});
