import assert from "node:assert/strict";
import test from "node:test";

import type { TopologyRef } from "@containerlab/clab-ui/session";

import { createClosTopology, parseCreateClosTopologyInput } from "./createClosTopology";
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

test("parseCreateClosTopologyInput rejects fabrics over the size limits", () => {
  const images = { nokia_srlinux: "ghcr.io/nokia/srlinux:latest" };
  const tooManyInTier = parseCreateClosTopologyInput({
    name: "big",
    tiers: [{ count: 5000 }, { count: 5000 }],
    images,
  });
  assert.equal(tooManyInTier.request, undefined);
  assert.ok(tooManyInTier.errors.some((message) => /from 1 to 256/.test(message)));

  const tooManyLinks = parseCreateClosTopologyInput({
    name: "big",
    tiers: [{ count: 256 }, { count: 256 }],
    images,
  });
  assert.equal(tooManyLinks.request, undefined);
  assert.ok(tooManyLinks.errors.some((message) => /65536 links/.test(message)));

  const tooManyNodes = parseCreateClosTopologyInput({
    name: "big",
    tiers: Array.from({ length: 9 }, () => ({ count: 256 })).map((tier, index) =>
      index % 2 === 0 ? tier : { count: 1 },
    ),
    images,
  });
  assert.ok(tooManyNodes.errors.some((message) => /nodes; the limit/.test(message)));
});

test("parseCreateClosTopologyInput needs an image for every kind in the tiers", () => {
  const parsed = parseCreateClosTopologyInput({
    name: "mixed",
    tiers: [{ count: 2, kind: "linux" }, { count: 2 }],
    images: { linux: "ghcr.io/srl-labs/network-multitool:latest" },
  });
  assert.equal(parsed.request, undefined);
  assert.deepEqual(parsed.errors, ['images has no entry for kind "nokia_srlinux".']);
});

test("createClosTopology writes a generated Clos fabric and auto-layouts when annotations are omitted", async () => {
  const { writes, files } = recordingStore();
  const result = await createClosTopology(leafSpine, { files });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.fileName, "clos6.clab.yml");
  assert.equal(result.autoLayout, true);
  assert.deepEqual([...writes.keys()], ["clos6.clab.yml"]);
  const yaml = writes.get("clos6.clab.yml") ?? "";
  assert.match(yaml, /name: clos6/);
  assert.match(yaml, /node1-1/);
  assert.match(yaml, /node2-1/);
  assert.match(yaml, /endpoints:/);
});

test("createClosTopology writes annotations when provided", async () => {
  const { writes, files } = recordingStore();
  const result = await createClosTopology(
    {
      ...leafSpine,
      annotations: {
        nodeAnnotations: [{ id: "node1-1", position: { x: 10, y: 20 } }],
      },
    },
    { files },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.autoLayout, false);
  assert.match(writes.get("clos6.clab.yml.annotations.json") ?? "", /"x": 10/);
});

test("createClosTopology rejects unsupported kinds from the generator", async () => {
  const result = await createClosTopology(
    {
      name: "bad",
      tiers: [{ count: 1, kind: "not_a_real_kind" }],
      images: { not_a_real_kind: "example/image:latest" },
    },
    recordingStore(),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.some((message) => /cannot be generated/i.test(message)));
});
