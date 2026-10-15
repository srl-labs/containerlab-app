import assert from "node:assert/strict";
import test from "node:test";

import { resolveInheritedFrom } from "../parsing/NodeConfigResolver";
import { summarizeMgmtNetworkUsage } from "../../components/panels/lab-settings/mgmtNetworkUsage";
import { buildInitialMgmt } from "../../hooks/editor/labSettingsForm";

import {
  getMgmtNetworkSubnet,
  isAddressInSubnet,
  resolveNodeMgmtNetwork
} from "./mgmtNetworks";

const NETWORKS = [{ network: "oob" }, { network: "lab" }];

test("a single or missing mgmt section puts every node on its one network", () => {
  assert.deepEqual(resolveNodeMgmtNetwork(undefined, []), {
    status: "ok",
    index: 0,
    name: "clab",
    explicit: false
  });
  assert.deepEqual(resolveNodeMgmtNetwork("", [{ network: "mgmt" }]), {
    status: "ok",
    index: 0,
    name: "mgmt",
    explicit: false
  });
  assert.deepEqual(resolveNodeMgmtNetwork("other", [{ network: "mgmt" }]), {
    status: "unknown",
    name: "other"
  });
});

test("with several networks a node must name a defined one", () => {
  assert.deepEqual(resolveNodeMgmtNetwork(undefined, NETWORKS), { status: "missing" });
  assert.deepEqual(resolveNodeMgmtNetwork("lab", NETWORKS), {
    status: "ok",
    index: 1,
    name: "lab",
    explicit: true
  });
  assert.deepEqual(resolveNodeMgmtNetwork("nope", NETWORKS), { status: "unknown", name: "nope" });
});

test("network modes and host-namespace kinds take no management network", () => {
  for (const networkMode of ["host", "none", "container:r1"]) {
    assert.deepEqual(resolveNodeMgmtNetwork(undefined, NETWORKS, { networkMode }), {
      status: "exempt"
    });
  }
  for (const kind of ["bridge", "ovs-bridge", "host", "ext-container"]) {
    assert.deepEqual(resolveNodeMgmtNetwork(undefined, NETWORKS, { kind }), { status: "exempt" });
  }
});

test("subnets fall back to the docker defaults only for the first bridge network", () => {
  assert.equal(getMgmtNetworkSubnet(undefined, true, "ipv4"), "172.20.20.0/24");
  assert.equal(getMgmtNetworkSubnet({}, true, "ipv6"), "3fff:172:20:20::/64");
  assert.equal(getMgmtNetworkSubnet({}, false, "ipv4"), undefined);
  assert.equal(getMgmtNetworkSubnet({ driver: "macvlan" }, true, "ipv4"), undefined);
  assert.equal(getMgmtNetworkSubnet({ "ipv4-subnet": "auto" }, true, "ipv4"), undefined);
  assert.equal(getMgmtNetworkSubnet({ "ipv6-subnet": "fd00::/64" }, true, "ipv4"), undefined);
  assert.equal(getMgmtNetworkSubnet({ "ipv4-subnet": "10.0.0.0/8" }, false, "ipv4"), "10.0.0.0/8");
});

test("addresses are checked against IPv4 and IPv6 subnets", () => {
  assert.equal(isAddressInSubnet("172.20.20.5", "172.20.20.0/24"), true);
  assert.equal(isAddressInSubnet("172.20.21.5", "172.20.20.0/24"), false);
  assert.equal(isAddressInSubnet("10.1.2.3/16", "10.0.0.0/8"), true);
  assert.equal(isAddressInSubnet("3fff:172:20:20::10", "3fff:172:20:20::/64"), true);
  assert.equal(isAddressInSubnet("3fff:172:20:21::10", "3fff:172:20:20::/64"), false);
  assert.equal(isAddressInSubnet("::ffff:10.0.0.1", "::ffff:10.0.0.0/120"), true);
  assert.equal(isAddressInSubnet("172.20.20.5", "3fff::/64"), undefined);
  assert.equal(isAddressInSubnet("not-an-ip", "10.0.0.0/8"), undefined);
  assert.equal(isAddressInSubnet("10.0.0.1", "10.0.0.0/33"), undefined);
});

test("inherited keys are traced to group, then kind, then defaults", () => {
  const parsed = {
    topology: {
      defaults: { "mgmt-net": "oob", image: "alpine" },
      kinds: { linux: { "mgmt-net": "lab", env: { A: "1" } } },
      groups: { edge: { kind: "linux", env: { B: "2" } } },
      nodes: {}
    }
  };
  assert.deepEqual(resolveInheritedFrom(parsed, { group: "edge", image: "own" }), {
    kind: "group",
    env: "group",
    "mgmt-net": "kind"
  });
  assert.deepEqual(resolveInheritedFrom(parsed, { kind: "nokia_srlinux" }), {
    "mgmt-net": "defaults",
    image: "defaults"
  });
});

test("network usage follows renames, the draft default and removed networks", () => {
  const settings = { mgmtNetworks: [{ network: "oob" }, { network: "lab" }], defaultMgmtNet: "oob" };
  const initial = buildInitialMgmt(settings);
  const nodes = [
    { id: "a", mgmtNet: "oob", fromDefaults: true },
    { id: "b", mgmtNet: "lab", fromDefaults: false },
    { id: "c", mgmtNet: "lab", fromDefaults: false, networkMode: "host" },
    { id: "d", mgmtNet: "gone", fromDefaults: false }
  ];
  assert.deepEqual(summarizeMgmtNetworkUsage(nodes, ["oob", "lab"], initial), {
    counts: [1, 1],
    unassigned: [],
    unknown: [{ node: "d", network: "gone" }]
  });

  const renamedNoDefault = {
    defaultMgmtNet: "",
    networks: [initial.networks[0], { ...initial.networks[1], networkName: "core" }]
  };
  assert.deepEqual(summarizeMgmtNetworkUsage(nodes, ["oob", "lab"], renamedNoDefault), {
    counts: [0, 1],
    unassigned: ["a"],
    unknown: [{ node: "d", network: "gone" }]
  });
});
