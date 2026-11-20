import assert from "node:assert/strict";
import test from "node:test";

import type { TopologyRef } from "@containerlab/clab-ui/session";

import { createClosTopology, parseCreateClosTopologyInput } from "./createClosTopology";

function topologyRef(fileName: string): TopologyRef {
  return {
    topologyId: `standalone:sandbox::${fileName}`,
    labName: fileName.replace(/\.clab\.ya?ml$/i, ""),
    yamlPath: fileName,
    annotationsPath: `${fileName}.annotations.json`,
    source: "standalone",
  };
}

const leafSpine = {
  name: "clos6",
  tiers: [
    { count: 2, kind: "nokia_srlinux", type: "ixrd2" },
    { count: 2, kind: "nokia_srlinux", type: "ixrd3" },
  ],
  images: { nokia_srlinux: "ghcr.io/nokia/srlinux:latest" },
};

test("parseCreateClosTopologyInput requires name, tiers, and images", () => {
  const missing = parseCreateClosTopologyInput({});
  assert.ok(missing.errors.some((message) => /name/i.test(message)));
  assert.ok(missing.errors.some((message) => /tiers/i.test(message)));
  assert.ok(missing.errors.some((message) => /images/i.test(message)));

  const parsed = parseCreateClosTopologyInput(leafSpine);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.request?.name, "clos6");
  assert.equal(parsed.request?.tiers.length, 2);
});

test("createClosTopology writes a generated Clos fabric and auto-layouts when annotations are omitted", async () => {
  const writes: Array<{ fileName: string; content: string }> = [];
  const result = await createClosTopology(leafSpine, {
    async writeTopologyFile(fileName, content) {
      writes.push({ fileName, content });
      return { topologyRef: topologyRef(fileName) };
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.fileName, "clos6.clab.yml");
  assert.equal(result.autoLayout, true);
  assert.equal(writes.length, 1);
  assert.match(writes[0]?.content ?? "", /name: clos6/);
  assert.match(writes[0]?.content ?? "", /node1-1/);
  assert.match(writes[0]?.content ?? "", /node2-1/);
  assert.match(writes[0]?.content ?? "", /endpoints:/);
});

test("createClosTopology writes annotations when provided", async () => {
  const annotationWrites: Array<{ path: string; content: string }> = [];
  const result = await createClosTopology(
    {
      ...leafSpine,
      annotations: {
        nodeAnnotations: [{ id: "node1-1", position: { x: 10, y: 20 } }],
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
  assert.match(annotationWrites[0]?.content ?? "", /"x": 10/);
});

test("createClosTopology rejects unsupported kinds from the generator", async () => {
  const result = await createClosTopology(
    {
      name: "bad",
      tiers: [{ count: 1, kind: "not_a_real_kind" }],
      images: { not_a_real_kind: "example/image:latest" },
    },
    {
      async writeTopologyFile(fileName) {
        return { topologyRef: topologyRef(fileName) };
      },
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((message) => /cannot be generated/i.test(message)));
});
