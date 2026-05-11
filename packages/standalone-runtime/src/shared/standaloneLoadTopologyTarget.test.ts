import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStandaloneTopologyRefFromPath,
  resolveStandaloneLoadTopologyTarget
} from "../standaloneHostShared";
import type { EndpointConfig } from "../stores/endpointStore";
import type { ContainerState, LabState } from "../stores/labStore";

const ENDPOINT_ID = "endpoint-1";

function buildEndpoint(username: string): EndpointConfig {
  return {
    id: ENDPOINT_ID,
    url: "http://api.example.test",
    label: "API",
    username,
    sessionDuration: "24h",
    status: "connected",
    connected: true
  };
}

function buildContainer(labName: string, labPath: string, owner: string): ContainerState {
  return {
    endpointId: ENDPOINT_ID,
    name: `clab-${labName}-srl1`,
    containerId: `cid-${labName}`,
    labName,
    labPath,
    owner,
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

function buildLabs(path: string, owner: string): Map<string, LabState> {
  return new Map([
    [
      "demo",
      {
        endpointId: ENDPOINT_ID,
        name: "demo",
        owner,
        topologyPath: path,
        containers: new Map([["clab-demo-srl1", buildContainer("demo", path, owner)]])
      }
    ]
  ]);
}

function buildTopologyEntry(path: string) {
  const topologyRef = buildStandaloneTopologyRefFromPath(path, "demo", ENDPOINT_ID);
  return {
    endpointId: ENDPOINT_ID,
    filename: path,
    path,
    hasAnnotations: true,
    labName: "demo",
    deploymentState: "undeployed",
    topologyRef
  };
}

test("non-owned running lab uses running documents instead of a matching API file entry", () => {
  const path = "/home/alice/.clab/demo/demo.clab.yml";
  const topologyRef = buildStandaloneTopologyRefFromPath(path, "demo", ENDPOINT_ID);
  const fileEntry = buildTopologyEntry(path);
  fileEntry.topologyRef.annotationsPath = "test-owned/demo.clab.yml.annotations.json";

  const target = resolveStandaloneLoadTopologyTarget({
    topologyRef,
    endpointId: ENDPOINT_ID,
    deploymentState: "deployed",
    endpoints: [buildEndpoint("test")],
    files: [fileEntry],
    labs: buildLabs(path, "alice")
  });

  assert.equal(target?.sourcePreference, "running-lab-doc");
  assert.deepEqual(target?.canonicalTopologyRef, topologyRef);
});

test("owned running lab keeps the canonical API file entry", () => {
  const path = "/home/alice/.clab/demo/demo.clab.yml";
  const topologyRef = buildStandaloneTopologyRefFromPath(path, "demo", ENDPOINT_ID);
  const fileEntry = buildTopologyEntry(path);

  const target = resolveStandaloneLoadTopologyTarget({
    topologyRef,
    endpointId: ENDPOINT_ID,
    deploymentState: "deployed",
    endpoints: [buildEndpoint("alice")],
    files: [fileEntry],
    labs: buildLabs(path, "alice")
  });

  assert.equal(target?.sourcePreference, "api-file");
  assert.equal(target?.canonicalTopologyRef, fileEntry.topologyRef);
});
