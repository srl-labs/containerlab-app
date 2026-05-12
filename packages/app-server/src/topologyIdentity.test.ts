import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStandaloneTopologyRef,
  buildStandaloneTopologyRefFromPath,
  findRunningLabNameForTopology,
  normalizeStandaloneTopologyRef,
  resolveCanonicalStandaloneTopologyRef
} from "./topologyIdentity";
import type { ClabApiClient, TopologyEntry } from "./clabApiClient";

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
