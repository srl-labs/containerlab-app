import assert from "node:assert/strict";
import test from "node:test";

import type { ContainerState, EndpointConfig, LabState } from "../types";
import {
  buildStandaloneTopologyRefFromPath,
  findLabStateForTopology,
  isTopologyRunning,
  resolveStandaloneLoadTopologyTarget,
  topologyPathsLikelyMatch,
  type TopologyFileEntry
} from "./documentUtils";

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

function buildLabs(
  labName = "runtime-lab",
  topologyPath = "/labs/demo-a.clab.yml",
  owner = "user"
): Map<string, LabState> {
  return new Map([
    [
      labName,
      {
        endpointId: ENDPOINT_ID,
        name: labName,
        owner,
        topologyPath,
        containers: new Map([[`clab-${labName}-srl1`, buildContainer(labName, topologyPath, owner)]])
      }
    ]
  ]);
}

function buildTopologyEntry(path: string): TopologyFileEntry {
  return {
    endpointId: ENDPOINT_ID,
    filename: path,
    path,
    hasAnnotations: true,
    labName: "demo",
    deploymentState: "undeployed",
    topologyRef: buildStandaloneTopologyRefFromPath(path, "demo", ENDPOINT_ID)
  };
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

test("shared source paths identify running labs without confusing duplicate names", () => {
  const labs = buildLabs();
  const sharedRef = {
    ...buildStandaloneTopologyRefFromPath("@shared/demo.clab.yml", "runtime-lab", ENDPOINT_ID),
    absoluteYamlPath: "/srv/shared/demo.clab.yml"
  };
  assert.equal(findLabStateForTopology(sharedRef, labs), undefined);
  assert.equal(findLabStateForTopology({ ...sharedRef, absoluteYamlPath: undefined }, labs), undefined);
  labs.get("runtime-lab")!.topologyPath = sharedRef.absoluteYamlPath;
  assert.equal(findLabStateForTopology(sharedRef, labs)?.name, "runtime-lab");
  assert.equal(findLabStateForTopology({ ...sharedRef, endpointId: "other" }, labs), undefined);
  assert.equal(findLabStateForTopology({ ...sharedRef, absoluteYamlPath: "/srv/shared/Demo.clab.yml" }, labs), undefined);
});

test("collaborators open shared running sources in edit mode from either explorer path", () => {
  const labs = buildLabs();
  const topologyRef = {
    ...buildStandaloneTopologyRefFromPath("@shared/demo.clab.yml", "runtime-lab", ENDPOINT_ID),
    absoluteYamlPath: "/labs/demo-a.clab.yml"
  };
  const entry: TopologyFileEntry = {
    endpointId: ENDPOINT_ID, filename: "demo.clab.yml", path: topologyRef.yamlPath,
    hasAnnotations: false, topologyRef
  };
  const endpoints = [buildEndpoint("collaborator")];
  for (const requestedRef of [topologyRef, buildStandaloneTopologyRefFromPath(topologyRef.absoluteYamlPath, "runtime-lab", ENDPOINT_ID)]) {
    const target = resolveStandaloneLoadTopologyTarget({ topologyRef: requestedRef, endpointId: ENDPOINT_ID, files: [entry], labs, endpoints });
    assert.equal(target?.sourcePreference, "api-file");
    assert.deepEqual(target?.canonicalTopologyRef, topologyRef);
  }
  const privateEntry = { ...entry, path: "demo.clab.yml", topologyRef: { ...topologyRef, yamlPath: "demo.clab.yml" } };
  const privateTarget = resolveStandaloneLoadTopologyTarget({ topologyRef: privateEntry.topologyRef, endpointId: ENDPOINT_ID, files: [privateEntry], labs, endpoints });
  assert.equal(privateTarget?.sourcePreference, "running-lab-doc");
});

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
    labs: buildLabs("demo", path, "alice")
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
    labs: buildLabs("demo", path, "alice")
  });

  assert.equal(target?.sourcePreference, "api-file");
  assert.equal(target?.canonicalTopologyRef, fileEntry.topologyRef);
});
