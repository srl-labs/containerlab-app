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
import type { ClabApiClient, TopologyEntry, InspectAllLabsResponse } from "./clabApiClient";

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
  const client = {
    listTopologies: async () => entries
  } as Pick<ClabApiClient, "listTopologies"> as ClabApiClient;

  const topologyRef = await resolveCanonicalStandaloneTopologyRef(client, "token", {
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
  const client = { listLabs: async () => ({ demo: [{ labName: "demo", absLabPath: "/srv/shared/demo.clab.yml" }] }) } as unknown as ClabApiClient;
  await assert.rejects(resolveRunningLabNameForTopology(client, "token", {
    labName: "demo", yamlPath: "demo.clab.yml", absoluteYamlPath: "/home/alice/demo.clab.yml"
  }, "demo"), TopologySourceConflictError);
  await assert.rejects(resolveRunningLabNameForTopology(client, "token", {
    labName: "demo", yamlPath: "@shared/demo.clab.yml"
  }, "demo"), TopologySourceConflictError);
});
