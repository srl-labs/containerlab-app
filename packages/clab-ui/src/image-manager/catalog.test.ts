import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKindImageCatalog,
  collectKindImageReferencesFromYaml,
  pullableImagesForEntry,
  pullableMissingImagesForEntry
} from "./catalog";

test("collects effective node images through containerlab inheritance", () => {
  const refs = collectKindImageReferencesFromYaml(`
name: inherit
topology:
  defaults:
    kind: linux
    image: alpine:3.20
  kinds:
    nokia_srlinux:
      image: ghcr.io/nokia/srlinux:24.10
  groups:
    leaves:
      kind: nokia_srlinux
  nodes:
    leaf1:
      group: leaves
    host1: {}
`);

  assert.deepEqual(
    refs.map((ref) => [ref.kind, ref.image, ref.source, ref.nodeName]),
    [
      ["nokia_srlinux", "ghcr.io/nokia/srlinux:24.10", "topology-kind", undefined],
      ["linux", "alpine:3.20", "topology-defaults", undefined],
      ["nokia_srlinux", "ghcr.io/nokia/srlinux:24.10", "topology-kind", "leaf1"],
      ["linux", "alpine:3.20", "topology-defaults", "host1"]
    ]
  );
});

test("marks referenced images as local or missing by kind", () => {
  const catalog = buildKindImageCatalog(
    {
      kinds: ["linux"],
      typesByKind: {},
      srosComponentTypes: { sfm: [], cpm: [], card: [], mda: [], xiom: [], xiomMda: [] }
    },
    [
      {
        id: "sha256:abcdef1234567890",
        shortId: "abcdef123456",
        repoTags: ["alpine:3.20"],
        repoDigests: []
      }
    ],
    [
      { kind: "linux", image: "alpine:3.20", source: "topology-node", label: "host1" },
      { kind: "linux", image: "busybox:latest", source: "pinned", label: "Pinned" }
    ]
  );

  assert.equal(catalog.entries[0]?.localImages.length, 1);
  assert.deepEqual(catalog.entries[0]?.missingImages, ["busybox:latest"]);
  assert.equal(catalog.unreferencedLocalImages.length, 0);
});

test("matches documented SR Linux images to the nokia_srlinux kind", () => {
  const catalog = buildKindImageCatalog(
    {
      kinds: ["nokia_srlinux"],
      typesByKind: {},
      srosComponentTypes: { sfm: [], cpm: [], card: [], mda: [], xiom: [], xiomMda: [] }
    },
    [
      {
        id: "sha256:srlinux",
        shortId: "srlinux",
        repoTags: ["ghcr.io/nokia/srlinux:24.10.1"],
        repoDigests: []
      }
    ],
    []
  );

  assert.equal(catalog.entries[0]?.kind, "nokia_srlinux");
  assert.equal(catalog.entries[0]?.localImages.length, 1);
  assert.equal(catalog.entries[0]?.guidance.preparation.mode, "direct-pull");
  assert.deepEqual(catalog.entries[0]?.missingImages, []);
  assert.equal(catalog.unreferencedLocalImages.length, 0);
});

test("marks vrnetlab-prepared kinds with vrnetlab guidance", () => {
  const catalog = buildKindImageCatalog(
    {
      kinds: ["cisco_xrv9k"],
      typesByKind: {},
      srosComponentTypes: { sfm: [], cpm: [], card: [], mda: [], xiom: [], xiomMda: [] }
    },
    [],
    []
  );

  assert.equal(catalog.entries[0]?.guidance.preparation.mode, "vrnetlab");
  assert.equal(catalog.entries[0]?.guidance.preparation.docsUrl, "https://containerlab.dev/manual/vrnetlab/");
});

test("does not treat vendor imported images as registry pull candidates", () => {
  const catalog = buildKindImageCatalog(
    {
      kinds: ["arista_ceos", "linux"],
      typesByKind: {},
      srosComponentTypes: { sfm: [], cpm: [], card: [], mda: [], xiom: [], xiomMda: [] }
    },
    [],
    [
      { kind: "arista_ceos", image: "ceos:4.32.0F", source: "topology-node", label: "leaf1" },
      { kind: "linux", image: "busybox:latest", source: "topology-node", label: "host1" }
    ]
  );

  const ceos = catalog.entries.find((entry) => entry.kind === "arista_ceos");
  const linux = catalog.entries.find((entry) => entry.kind === "linux");

  assert.deepEqual(ceos ? pullableMissingImagesForEntry(ceos) : [], []);
  assert.deepEqual(ceos ? pullableImagesForEntry(ceos) : [], []);
  assert.deepEqual(linux ? pullableMissingImagesForEntry(linux) : [], ["busybox:latest"]);
  assert.deepEqual(linux ? pullableImagesForEntry(linux) : [], ["busybox:latest"]);
});

test("does not mark unreferenced recommended images as missing", () => {
  const catalog = buildKindImageCatalog(
    {
      kinds: ["rare", "vyosnetworks_vyos"],
      typesByKind: {},
      srosComponentTypes: { sfm: [], cpm: [], card: [], mda: [], xiom: [], xiomMda: [] }
    },
    [],
    []
  );

  const rare = catalog.entries.find((entry) => entry.kind === "rare");
  const vyos = catalog.entries.find((entry) => entry.kind === "vyosnetworks_vyos");

  assert.deepEqual(rare?.missingImages, []);
  assert.deepEqual(rare ? pullableImagesForEntry(rare) : [], [
    "ghcr.io/rare-freertr/freertr-containerlab:latest"
  ]);
  assert.deepEqual(vyos?.missingImages, []);
  assert.equal(vyos?.guidance.preparation.mode, "vendor-import");
  assert.deepEqual(vyos ? pullableImagesForEntry(vyos) : [], []);
});
