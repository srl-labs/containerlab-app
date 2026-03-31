import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStandaloneTopologyRefFromPath,
  findLabStateForTopology,
  isTopologyRunning
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
