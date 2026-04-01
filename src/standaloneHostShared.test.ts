import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStandaloneTopologyRefFromPath,
  findLabStateForTopology,
  isTopologyRunning,
  topologyPathsLikelyMatch
} from "./standaloneHostShared";
import type { ContainerState, LabState } from "./stores/labStore";

function buildContainer(labName: string, labPath: string): ContainerState {
  return {
    name: `clab-${labName}-srl1`,
    containerId: `cid-${labName}`,
    labName,
    labPath,
    owner: "user",
    nodeName: "srl1",
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:latest",
    state: "running",
    status: "Up",
    ipv4Address: "172.20.20.2",
    ipv6Address: "2001:db8::2",
    interfaces: new Map()
  };
}

function buildLabs(): Map<string, LabState> {
  return new Map([
    [
      "runtime-lab",
      {
        name: "runtime-lab",
        owner: "user",
        topologyPath: "/labs/demo-a.clab.yml",
        containers: new Map([
          ["clab-runtime-lab-srl1", buildContainer("runtime-lab", "/labs/demo-a.clab.yml")]
        ])
      }
    ]
  ]);
}

test("findLabStateForTopology and isTopologyRunning match by yamlPath", () => {
  const labs = buildLabs();
  const topologyRef = buildStandaloneTopologyRefFromPath("/labs/demo-a.clab.yml", "different-lab-name");

  const lab = findLabStateForTopology(topologyRef, labs);

  assert.equal(lab?.name, "runtime-lab");
  assert.equal(isTopologyRunning(topologyRef, labs), true);
});

test("findLabStateForTopology matches absolute and relative topology paths", () => {
  const labs = buildLabs();
  const topologyRef = buildStandaloneTopologyRefFromPath("demo-a.clab.yml", "runtime-lab");

  const lab = findLabStateForTopology(topologyRef, labs);

  assert.equal(lab?.name, "runtime-lab");
  assert.equal(isTopologyRunning(topologyRef, labs), true);
});

test("findLabStateForTopology falls back to unique lab name", () => {
  const labs = buildLabs();
  const topologyRef = {
    yamlPath: "/unrelated/path/does-not-match.clab.yml",
    labName: "runtime-lab"
  };

  const lab = findLabStateForTopology(topologyRef, labs);

  assert.equal(lab?.name, "runtime-lab");
});

test("topologyPathsLikelyMatch handles canonical and runtime path variants", () => {
  assert.equal(topologyPathsLikelyMatch("/home/user/labs/demo-a.clab.yml", "labs/demo-a.clab.yml"), true);
  assert.equal(topologyPathsLikelyMatch("/home/user/labs/demo-a.clab.yml", "demo-a.clab.yml"), true);
  assert.equal(topologyPathsLikelyMatch("/home/user/labs/demo-a.clab.yml", "demo-b.clab.yml"), false);
});
