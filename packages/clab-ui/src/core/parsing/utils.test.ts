import assert from "node:assert/strict";
import test from "node:test";

import type { ClabTopology, NodeAnnotation } from "../types/topology";

import { TopologyParser } from "./TopologyParser";
import { computeFullPrefix, extractIconVisuals } from "./utils";

test("extractIconVisuals passes the box appearance through, normalized", () => {
  const annotation: NodeAnnotation = {
    id: "srl1",
    iconColor: "#ff0000",
    labelPosition: "top",
    // Opacity clamps to its default and is dropped along with the other defaults.
    box: { color: " #112233 ", opacity: 140, blur: 8, borderWidth: 1, shadow: true }
  };

  assert.deepEqual(extractIconVisuals(annotation), {
    iconColor: "#ff0000",
    labelPosition: "top",
    box: { color: "#112233", blur: 8 }
  });
});

test("extractIconVisuals leaves out an empty or invalid box", () => {
  assert.deepEqual(extractIconVisuals({ id: "a", box: { opacity: 100, shadow: true } }), {});
  assert.deepEqual(
    extractIconVisuals({ id: "b", box: "red" as unknown as NodeAnnotation["box"] }),
    {}
  );
  assert.deepEqual(extractIconVisuals(undefined), {});
});

function topologyWithPrefix(prefix: unknown): ClabTopology {
  // Cast keeps the null case, which YAML produces for a bare `prefix:` key.
  return { name: "demo", prefix } as ClabTopology;
}

test("computeFullPrefix defaults to clab-<lab> when prefix is not set", () => {
  assert.equal(computeFullPrefix({ name: "demo" }, "demo"), "clab-demo");
  assert.equal(computeFullPrefix(topologyWithPrefix(null), "demo"), "clab-demo");
});

test("computeFullPrefix drops the prefix when it is empty", () => {
  assert.equal(computeFullPrefix(topologyWithPrefix(""), "demo"), "");
  assert.equal(computeFullPrefix(topologyWithPrefix("   "), "demo"), "");
});

test("computeFullPrefix uses the bare lab name for __lab-name", () => {
  assert.equal(computeFullPrefix(topologyWithPrefix("__lab-name"), "demo"), "demo");
});

test("computeFullPrefix joins a custom prefix with the lab name", () => {
  assert.equal(computeFullPrefix(topologyWithPrefix("acme"), "demo"), "acme-demo");
  assert.equal(computeFullPrefix(topologyWithPrefix("clab"), "demo"), "clab-demo");
});

test("parsed nodes look up the deployed container by containerlab's name for every prefix form", () => {
  const cases: Array<{ prefix?: string; containerName: string }> = [
    { containerName: "clab-demo-r1" },
    { prefix: "", containerName: "r1" },
    { prefix: "__lab-name", containerName: "demo-r1" },
    { prefix: "acme", containerName: "acme-demo-r1" }
  ];

  for (const { prefix, containerName } of cases) {
    const lookedUp: string[] = [];
    const parsed: ClabTopology = {
      name: "demo",
      ...(prefix !== undefined ? { prefix } : {}),
      topology: { nodes: { r1: { kind: "linux", image: "alpine" } } }
    };
    const result = TopologyParser.parseToReactFlowFromParsed(parsed, {
      containerDataProvider: {
        findContainer: (name) => {
          lookedUp.push(name);
          return undefined;
        },
        findInterface: () => undefined
      }
    });

    const label = `prefix ${JSON.stringify(prefix)}`;
    assert.deepEqual(lookedUp, [containerName], label);
    const node = result.topology.nodes.find((candidate) => candidate.id === "r1");
    assert.ok(node, label);
    const extraData = (node.data as { extraData?: Record<string, unknown> }).extraData;
    assert.ok(extraData, label);
    assert.equal(extraData.longname, containerName, label);
    assert.equal(extraData.labdir, "clab-demo/", label);
  }
});
