import assert from "node:assert/strict";
import test from "node:test";

import type { TopologyRef } from "@containerlab/clab-ui/session";

import { createLab, parseCreateLabInput } from "./createLab";
import type { LabFileStore } from "./saveLabFiles";

function topologyRef(fileName: string): TopologyRef {
  return {
    topologyId: `standalone:sandbox::${fileName}`,
    labName: fileName.replace(/\.clab\.ya?ml$/i, ""),
    yamlPath: fileName,
    annotationsPath: `${fileName}.annotations.json`,
    source: "standalone",
  };
}

/** Records writes to an empty sandbox. */
function recordingStore() {
  const writes = new Map<string, string>();
  const files: LabFileStore = {
    async findTopologyFile() {
      return undefined;
    },
    async createTopologyFile(fileName, content) {
      writes.set(fileName, content);
      return topologyRef(fileName);
    },
    async readFile(path) {
      throw new Error(`ENOENT: ${path}`);
    },
    async writeFile(path, content) {
      writes.set(path, content);
    },
    async deleteFile(path) {
      writes.delete(path);
    },
  };
  return { writes, files };
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
  const { writes, files } = recordingStore();
  const result = await createLab({ topology: demoTopology }, { files });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.fileName, "demo.clab.yml");
  assert.equal(result.autoLayout, true);
  assert.equal(result.replaced, false);
  assert.deepEqual([...writes.keys()], ["demo.clab.yml"]);
  assert.match(writes.get("demo.clab.yml") ?? "", /name: demo/);
  assert.match(writes.get("demo.clab.yml") ?? "", /kind: linux/);
});

test("createLab writes annotations when provided and skips auto-layout", async () => {
  const { writes, files } = recordingStore();
  const result = await createLab(
    {
      topology: demoTopology,
      annotations: {
        nodeAnnotations: [{ id: "r1", position: { x: 120, y: 40 } }],
      },
    },
    { files },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.autoLayout, false);
  assert.match(writes.get("demo.clab.yml.annotations.json") ?? "", /"x": 120/);
});

test("createLab rejects malformed annotations before writing anything", async () => {
  const { writes, files } = recordingStore();
  const result = await createLab(
    {
      topology: demoTopology,
      annotations: { nodeAnnotations: { r1: { position: { x: 0, y: 0 } } } },
    },
    { files },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((message) => /annotations\/nodeAnnotations/.test(message)));
  assert.equal(writes.size, 0);

  const notAnObject = await createLab({ topology: demoTopology, annotations: [] }, { files });
  assert.equal(notAnObject.ok, false);
  assert.equal(writes.size, 0);
});

test("createLab rejects a document missing name or topology.nodes", async () => {
  const { writes, files } = recordingStore();
  const deps = { files };

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
  assert.equal(writes.size, 0);
});
