import assert from "node:assert/strict";
import test from "node:test";

import type { Edge, Node } from "@xyflow/react";

import {
  buildCaptureNodeTarget,
  buildRuntimeCaptureOptions,
  groupCaptureSelection,
  matchesCaptureFilter
} from "./captureInterfaceOptions";
import { initialCaptureSelection, rememberCaptureSelection } from "./captureSelectionMemory";

function topologyNode(id: string, extraData: Record<string, unknown> = {}): Node {
  return {
    id,
    type: "topology-node",
    position: { x: 0, y: 0 },
    data: { label: id, role: "router", longname: `clab-lab-${id}`, extraData }
  };
}

function link(
  id: string,
  source: string,
  sourceEndpoint: string,
  target: string,
  targetEndpoint: string,
  extraData: Record<string, unknown> = {}
): Edge {
  return { id, source, target, data: { sourceEndpoint, targetEndpoint, extraData } };
}

const leafInterfaces = [
  { name: "eth0", state: "up" },
  { name: "e1-1", alias: "ethernet-1/1", state: "up" },
  { name: "e1-49", alias: "ethernet-1/49", state: "down" },
  { name: "e1-2", alias: "ethernet-1/2", state: "up" }
];

test("capture options merge live interfaces with canvas links", () => {
  const nodes = [
    topologyNode("leaf1", { runtimeInterfaces: leafInterfaces }),
    topologyNode("spine1"),
    topologyNode("client1")
  ];
  const edges = [
    link("l1", "spine1", "e1-1", "leaf1", "ethernet-1/49"),
    link("l2", "leaf1", "e1-1", "client1", "eth1", { clabSourceInterfaceState: "up" })
  ];

  const target = buildCaptureNodeTarget("leaf1", nodes, edges);

  assert.ok(target);
  assert.equal(target.containerName, "clab-lab-leaf1");
  assert.deepEqual(
    target.options.map((option) => [option.name, option.peer?.node ?? null, option.state]),
    [
      ["eth0", null, "up"],
      ["e1-1", "client1", "up"],
      ["e1-2", null, "up"],
      ["e1-49", "spine1", "down"]
    ]
  );
  assert.equal(target.options[0].isManagement, true);
  assert.equal(target.options[3].alias, "ethernet-1/49");
  assert.equal(target.options[3].peer?.endpoint, "e1-1");
});

test("linked endpoints still show before the runtime lists interfaces", () => {
  const nodes = [topologyNode("leaf1"), topologyNode("spine1")];
  const edges = [
    link("l1", "spine1", "e1-1", "leaf1", "e1-49", {
      clabTargetLongName: "clab-lab-leaf1",
      clabTargetInterfaceState: "up"
    })
  ];

  const target = buildCaptureNodeTarget("leaf1", nodes, edges);

  assert.deepEqual(
    target?.options.map((option) => [option.name, option.state, option.containerName]),
    [["e1-49", "up", "clab-lab-leaf1"]]
  );
});

test("capture targets exist only for topology nodes", () => {
  const network: Node = { id: "host", type: "network-node", position: { x: 0, y: 0 }, data: {} };

  assert.equal(buildCaptureNodeTarget("host", [network], []), undefined);
  assert.equal(buildCaptureNodeTarget("missing", [], []), undefined);
});

test("selections split into one request per owning container", () => {
  const nodes = [topologyNode("sr1"), topologyNode("r2"), topologyNode("r3")];
  const edges = [
    link("l1", "sr1", "1/1/c1/1", "r2", "eth1", { clabSourceLongName: "clab-lab-sr1-a" }),
    link("l2", "sr1", "1/1/c2/1", "r3", "eth1", { clabSourceLongName: "clab-lab-sr1-b" }),
    link("l3", "sr1", "1/1/c1/2", "r3", "eth2", { clabSourceLongName: "clab-lab-sr1-a" })
  ];
  const target = buildCaptureNodeTarget("sr1", nodes, edges);
  assert.ok(target);

  const groups = groupCaptureSelection(target.options, new Set(["1/1/c1/1", "1/1/c1/2", "1/1/c2/1"]));

  assert.deepEqual(groups, [
    { containerName: "clab-lab-sr1-a", interfaceNames: ["1/1/c1/1", "1/1/c1/2"], nodeNamespace: false },
    { containerName: "clab-lab-sr1-b", interfaceNames: ["1/1/c2/1"], nodeNamespace: false }
  ]);
});

test("the filter matches names, aliases and link peers", () => {
  const nodes = [topologyNode("leaf1", { runtimeInterfaces: leafInterfaces }), topologyNode("spine1")];
  const target = buildCaptureNodeTarget("leaf1", nodes, [link("l1", "spine1", "e1-1", "leaf1", "e1-49")]);
  assert.ok(target);
  const names = (filter: string) =>
    target.options.filter((option) => matchesCaptureFilter(option, filter)).map((option) => option.name);

  assert.deepEqual(names("SPINE"), ["e1-49"]);
  assert.deepEqual(names("ethernet-1/2"), ["e1-2"]);
  assert.equal(names("  ").length, target.options.length);
});

test("runtime-only options drop loopback and unknown interfaces", () => {
  const options = buildRuntimeCaptureOptions("clab-lab-r1", [
    { name: "lo", state: "up" },
    { name: "eth1", state: "up", label: "ge-0/0/0" },
    { name: "eth9", state: "unknown" },
    { name: "eth0", state: "up" }
  ]);

  assert.deepEqual(
    options.map((option) => [option.name, option.alias ?? null, option.isManagement]),
    [
      ["eth0", null, true],
      ["eth1", "ge-0/0/0", false]
    ]
  );
});

test("the dialog starts from linked interfaces, then remembers the last pick", () => {
  const nodes = [topologyNode("leaf9", { runtimeInterfaces: leafInterfaces }), topologyNode("spine1")];
  const target = buildCaptureNodeTarget("leaf9", nodes, [link("l1", "spine1", "e1-1", "leaf9", "e1-49")]);
  assert.ok(target);

  assert.deepEqual(initialCaptureSelection(target.containerName, target.options), ["e1-49"]);
  assert.deepEqual(initialCaptureSelection(target.containerName, target.options, false), [
    "e1-1",
    "e1-2",
    "e1-49"
  ]);

  rememberCaptureSelection(target.containerName, ["eth0", "gone"]);
  assert.deepEqual(initialCaptureSelection(target.containerName, target.options), ["eth0"]);
});
