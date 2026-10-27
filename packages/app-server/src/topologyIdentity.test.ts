import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStandaloneTopologyRef,
  buildStandaloneTopologyRefFromPath,
  findRunningLabNameForTopology,
  normalizeStandaloneTopologyRef,
  resolveCanonicalStandaloneTopologyRef,
  resolveRunningLabNameForTopology,
  TopologySourceConflictError
} from "./topologyIdentity";
import type { InspectAllLabsResponse, TopologyEntry } from "@srl-labs/containerlab-lab-backend";

test("normalizeStandaloneTopologyRef canonicalizes standalone paths", () => {
  const normalized = normalizeStandaloneTopologyRef({
    topologyId: "custom-id",
    labName: " demo ",
    yamlPath: "./labs\\demo.clab.yml",
    source: "standalone"
  });

  assert.deepEqual(normalized, {
    topologyId: "standalone:labs/demo.clab.yml",
    labName: "demo",
    yamlPath: "labs/demo.clab.yml",
    annotationsPath: "labs/demo.clab.yml.annotations.json",
    source: "standalone"
  });
});

test("resolveCanonicalStandaloneTopologyRef prefers the server topology entry for an exact path", async () => {
  const entries: TopologyEntry[] = [
    {
      labName: "demo-a",
      yamlFileName: "labs/a/demo.clab.yml",
      annotationsFileName: "labs/a/demo.clab.yml.annotations.json",
      hasAnnotations: true,
      deploymentState: "unknown"
    },
    {
      labName: "demo-b",
      yamlFileName: "labs/b/demo.clab.yml",
      annotationsFileName: "",
      hasAnnotations: false,
      deploymentState: "unknown"
    }
  ];
  const backend = { listTopologies: async () => entries };

  const topologyRef = await resolveCanonicalStandaloneTopologyRef(backend, {
    topologyId: "standalone:./labs/a/demo.clab.yml",
    labName: "wrong",
    yamlPath: "./labs/a/demo.clab.yml",
    annotationsPath: "./elsewhere.annotations.json",
    source: "standalone"
  });

  assert.deepEqual(topologyRef, buildStandaloneTopologyRef(entries[0]));
});

test("buildStandaloneTopologyRefFromPath keeps topology identity stable when lab labels change", () => {
  const left = buildStandaloneTopologyRefFromPath("/labs/demo.clab.yml", "alpha");
  const right = buildStandaloneTopologyRefFromPath("/labs/demo.clab.yml", "beta");

  assert.equal(left.topologyId, right.topologyId);
  assert.equal(left.topologyId, "standalone:/labs/demo.clab.yml");
});

test("findRunningLabNameForTopology resolves runtime lab by topology path", () => {
  const runningLabName = findRunningLabNameForTopology(
    {
      st: [
        {
          name: "leaf1",
          containerId: "cid",
          image: "image",
          kind: "linux",
          state: "running",
          status: "Up",
          ipv4Address: "",
          ipv6Address: "",
          labName: "st",
          labPath: "/home/test/.clab/srl-telemetry-lab/st.clab.yml",
          absLabPath: "/home/test/.clab/srl-telemetry-lab/st.clab.yml",
          group: "",
          owner: "test"
        }
      ]
    },
    {
      labName: "srl-telemetry-lab",
      yamlPath: "srl-telemetry-lab/st.clab.yml"
    }
  );

  assert.equal(runningLabName, "st");
});

test("absolute source identity overrides duplicate names and preserves case", () => {
  const labs: InspectAllLabsResponse = { demo: [{
    name: "clab-demo-n1", containerId: "cid", image: "alpine", kind: "linux",
    state: "running", status: "Up", ipv4Address: "", ipv6Address: "",
    labName: "demo", labPath: "/srv/shared/demo.clab.yml", absLabPath: "/srv/shared/demo.clab.yml",
    group: "", owner: "alice"
  }] };
  const entry: TopologyEntry = { labName: "demo", yamlFileName: "@shared/demo.clab.yml", absolutePath: "/srv/shared/demo.clab.yml", annotationsFileName: "", hasAnnotations: false, deploymentState: "undeployed" };
  const ref = buildStandaloneTopologyRef(entry, "endpoint-1");
  assert.equal(ref.yamlPath, "@shared/demo.clab.yml");
  assert.equal(ref.absoluteYamlPath, entry.absolutePath);
  assert.equal(findRunningLabNameForTopology(labs, ref), "demo");
  assert.equal(findRunningLabNameForTopology(labs, { ...ref, absoluteYamlPath: "/home/user/demo.clab.yml" }), undefined);
  assert.equal(findRunningLabNameForTopology(labs, { ...ref, absoluteYamlPath: "/srv/shared/Demo.clab.yml" }), undefined);
  assert.equal(findRunningLabNameForTopology(labs, { ...ref, absoluteYamlPath: undefined }), undefined);
});

test("runtime actions cannot fall back to a same-named lab from another source", async () => {
  const backend = {
    inspectAll: async () =>
      ({ demo: [{ labName: "demo", absLabPath: "/srv/shared/demo.clab.yml" }] }) as unknown as InspectAllLabsResponse
  };
  await assert.rejects(resolveRunningLabNameForTopology(backend, {
    labName: "demo", yamlPath: "demo.clab.yml", absoluteYamlPath: "/home/alice/demo.clab.yml"
  }, "demo"), TopologySourceConflictError);
  await assert.rejects(resolveRunningLabNameForTopology(backend, {
    labName: "demo", yamlPath: "@shared/demo.clab.yml"
  }, "demo"), TopologySourceConflictError);
});

test("a cluster lab that containerlab did not deploy matches its topology file by name", async () => {
  // containerlab -r c9s reports where the topology lives in the cluster, not the file it came from.
  const clusterLab = (labName: string) => ({
    labName,
    labPath: `k8s://c9s-${labName}/topologies/${labName}`,
    absLabPath: `k8s://c9s-${labName}/topologies/${labName}`
  });
  const backend = {
    inspectAll: async () =>
      ({ demo: [clusterLab("demo")], other: [clusterLab("other")] }) as unknown as InspectAllLabsResponse
  };
  const ref = { labName: "demo", yamlPath: "demo/demo.clab.yml", absoluteYamlPath: "/home/alice/labs/demo/demo.clab.yml" };
  assert.equal(await resolveRunningLabNameForTopology(backend, ref, "demo"), "demo");
  assert.equal(findRunningLabNameForTopology(await backend.inspectAll(), { ...ref, absoluteYamlPath: undefined }), "demo");
  assert.equal(findRunningLabNameForTopology(await backend.inspectAll(), { ...ref, labName: "missing" }), undefined);
  // A Docker lab of the same name still needs its own file.
  const docker = { demo: [{ labName: "demo", absLabPath: "/srv/shared/demo.clab.yml" }] } as unknown as InspectAllLabsResponse;
  assert.equal(findRunningLabNameForTopology(docker, ref), undefined);
});
