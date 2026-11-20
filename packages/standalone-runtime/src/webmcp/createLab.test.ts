import assert from "node:assert/strict";
import test from "node:test";

import type { TopologyRef } from "@containerlab/clab-ui/session";

import { createLab, parseCreateLabInput } from "./createLab";

function topologyRef(fileName: string): TopologyRef {
  return {
    topologyId: `standalone:sandbox::${fileName}`,
    labName: fileName.replace(/\.clab\.ya?ml$/i, ""),
    yamlPath: fileName,
    annotationsPath: `${fileName}.annotations.json`,
    source: "standalone",
  };
}

const demoTopology = {
  name: "demo",
  topology: {
    nodes: {
      r1: { kind: "linux", image: "alpine" },
    },
  },
};

test("parseCreateLabInput accepts wrapper and bare topology documents", () => {
  assert.deepEqual(parseCreateLabInput({ topology: demoTopology }), {
    topology: demoTopology,
    annotations: undefined,
  });
  assert.deepEqual(
    parseCreateLabInput({
      topology: demoTopology,
      annotations: { nodeAnnotations: [{ id: "r1", position: { x: 1, y: 2 } }] },
    }),
    {
      topology: demoTopology,
      annotations: { nodeAnnotations: [{ id: "r1", position: { x: 1, y: 2 } }] },
    },
  );
  assert.deepEqual(parseCreateLabInput(demoTopology), {
    topology: demoTopology,
    annotations: undefined,
  });
});

test("createLab stores a schema-valid topology as a .clab.yml file", async () => {
  const writes: Array<{ fileName: string; content: string }> = [];
  const result = await createLab(
    { topology: demoTopology },
    {
      async writeTopologyFile(fileName, content) {
        writes.push({ fileName, content });
        return { topologyRef: topologyRef(fileName) };
      },
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.fileName, "demo.clab.yml");
  assert.equal(result.autoLayout, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.fileName, "demo.clab.yml");
  assert.match(writes[0]?.content ?? "", /name: demo/);
  assert.match(writes[0]?.content ?? "", /kind: linux/);
});

test("createLab writes annotations when provided and skips auto-layout", async () => {
  const annotationWrites: Array<{ path: string; content: string }> = [];
  const result = await createLab(
    {
      topology: demoTopology,
      annotations: {
        nodeAnnotations: [{ id: "r1", position: { x: 120, y: 40 } }],
      },
    },
    {
      async writeTopologyFile(fileName) {
        return { topologyRef: topologyRef(fileName) };
      },
      async writeAnnotationsFile(path, content) {
        annotationWrites.push({ path, content });
      },
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.autoLayout, false);
  assert.equal(annotationWrites.length, 1);
  assert.equal(annotationWrites[0]?.path, "demo.clab.yml.annotations.json");
  assert.match(annotationWrites[0]?.content ?? "", /"x": 120/);
});

test("createLab rejects a document missing name or topology.nodes", async () => {
  let writeCount = 0;
  const deps = {
    async writeTopologyFile(fileName: string) {
      writeCount += 1;
      return { topologyRef: topologyRef(fileName) };
    },
  };

  const missingName = await createLab(
    { topology: { topology: { nodes: { r1: { kind: "linux", image: "alpine" } } } } },
    deps,
  );
  assert.equal(missingName.ok, false);
  if (missingName.ok) return;
  assert.ok(missingName.errors.some((message) => /name/i.test(message)));

  const missingNodes = await createLab(
    { topology: { name: "demo", topology: {} } },
    deps,
  );
  assert.equal(missingNodes.ok, false);
  if (missingNodes.ok) return;
  assert.ok(missingNodes.errors.some((message) => /nodes/i.test(message)));
  assert.equal(writeCount, 0);
});
