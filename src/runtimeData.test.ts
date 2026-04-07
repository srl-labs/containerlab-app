import assert from "node:assert/strict";
import test from "node:test";
import {
  getRuntimeContainersForLab,
  getRuntimeContainersForTopology,
  runtimeContainersEqual
} from "./runtimeData";
import { buildStandaloneTopologyRefFromPath } from "./standaloneHostShared";
import type { ContainerState, LabState } from "./stores/labStore";

const ENDPOINT_ID = "endpoint-1";

function buildContainer(rxBps: string): ContainerState {
  return {
    endpointId: ENDPOINT_ID,
    name: "clab-demo-srl1",
    containerId: "cid-1",
    labName: "demo",
    labPath: "/tmp/demo.clab.yml",
    owner: "user",
    nodeName: "srl1",
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:latest",
    state: "running",
    status: "Up",
    ipv4Address: "172.20.20.2",
    ipv6Address: "2001:db8::2",
    interfaces: new Map([
      [
        "e1-1",
        {
          name: "e1-1",
          alias: "ethernet-1/1",
          state: "up",
          type: "veth",
          mac: "02:42:ac:11:00:01",
          mtu: "1500",
          ifIndex: "12",
          rxBps,
          txBps: "2000",
          statsIntervalSeconds: "1"
        }
      ]
    ])
  };
}

function buildLabs(rxBps: string): Map<string, LabState> {
  return new Map([
    [
      "demo",
      {
        endpointId: ENDPOINT_ID,
        name: "demo",
        owner: "user",
        topologyPath: "/tmp/demo.clab.yml",
        containers: new Map([["clab-demo-srl1", buildContainer(rxBps)]])
      }
    ]
  ]);
}

test("runtimeContainersEqual detects stats-only changes", () => {
  const previous = getRuntimeContainersForLab("demo", buildLabs("1000"));
  const next = getRuntimeContainersForLab("demo", buildLabs("1500"));

  assert.equal(runtimeContainersEqual(previous, next), false);
});

test("runtimeContainersEqual treats identical stats as unchanged", () => {
  const previous = getRuntimeContainersForLab("demo", buildLabs("1000"));
  const next = getRuntimeContainersForLab("demo", buildLabs("1000"));

  assert.equal(runtimeContainersEqual(previous, next), true);
});

test("getRuntimeContainersForTopology prefers exact topology path over lab name", () => {
  const labs = new Map<string, LabState>([
    [
      "demo",
      {
        endpointId: ENDPOINT_ID,
        name: "demo",
        owner: "user",
        topologyPath: "/labs/demo-a.clab.yml",
        containers: new Map([
          [
            "clab-demo-srl1",
            {
              ...buildContainer("1000"),
              labPath: "/labs/demo-a.clab.yml"
            }
          ]
        ])
      }
    ]
  ]);

  const topologyRef = buildStandaloneTopologyRefFromPath("/labs/demo-a.clab.yml", "other-lab-name");
  const runtimeContainers = getRuntimeContainersForTopology(topologyRef, labs);

  assert.equal(runtimeContainers.length, 1);
  assert.equal(runtimeContainers[0]?.name, "clab-demo-srl1");
});
