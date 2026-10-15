import assert from "node:assert/strict";
import test from "node:test";

import * as YAML from "yaml";

import { addNodeToDoc, deleteNodeFromDoc } from "./NodePersistenceIO";
import { extractNodeYamlSources, type NodeYamlSource } from "./NodeYamlClone";

const LAB_YAML = `name: copy-lab
topology:
  defaults:
    image: ghcr.io/example/default:1.0
    labels:
      owner: lab-team
  kinds:
    nokia_srlinux:
      image: ghcr.io/nokia/srlinux:25.10
      type: ixr-d3l
    linux:
      labels:
        role: host
  groups:
    spines:
      kind: nokia_srlinux
      image: ghcr.io/nokia/srlinux:24.10
  nodes:
    # spine one
    srl1:
      kind: nokia_srlinux
      hostname: srl1
      mgmt-net: oob # second management network
      mgmt-ipv4: 172.20.20.11
      mgmt-ipv6: 3fff:172:20:20::11
      credentials:
        username: admin
        password: NokiaSrl1!
      volumes:
        - data:/data
      components:
        - slot: A
          type: cpm2-ixr-e
      labels:
        peer: srl1
        site: dc1
      startup-config: configs/srl1.cfg
      ports:
        - 50080:80
        - 127.0.0.1:50443:443/tcp
        - "8000-8001:9000-9001"
        - 22
    # frr router
    frr1:
      kind: frr
      image: quay.io/frrouting/frr:10.2.1
      daemons: [bgpd, ospfd]
    spine1:
      group: spines
    host1:
      kind: linux
    ceos1:
      kind: arista_ceos
      image: ceos:4.33
      copy-to-flash:
        - flash/license.json
    shorthand:
  links: []
`;

const EMPTY_LAB_YAML = `name: other-lab
topology:
  nodes: {}
  links: []
`;

function copyNode(yamlContent: string, name: string): NodeYamlSource {
  const source = extractNodeYamlSources(yamlContent, [name]).get(name);
  assert.ok(source, `expected YAML for node "${name}"`);
  return source;
}

function pasteNode(
  doc: YAML.Document.Parsed,
  source: NodeYamlSource,
  newName: string,
  extraData: Record<string, unknown> = {}
): void {
  assert.deepEqual(
    addNodeToDoc(doc, { id: newName, name: newName, extraData, yamlSource: source }),
    { success: true }
  );
}

function nodeJs(doc: YAML.Document.Parsed, name: string): unknown {
  return (doc.toJS() as { topology: { nodes: Record<string, unknown> } }).topology.nodes[name];
}

test("paste keeps every own key, including kind-specific ones", () => {
  const doc = YAML.parseDocument(LAB_YAML);
  pasteNode(doc, copyNode(LAB_YAML, "srl1"), "srl2", {
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:25.10",
    type: "ixr-d3l",
    labels: { owner: "lab-team", peer: "srl1", site: "dc1" }
  });

  const pasted = nodeJs(doc, "srl2") as Record<string, unknown>;
  assert.equal(pasted.kind, "nokia_srlinux");
  assert.equal(pasted["mgmt-net"], "oob");
  assert.deepEqual(pasted.credentials, { username: "admin", password: "NokiaSrl1!" });
  assert.deepEqual(pasted.volumes, ["data:/data"]);
  assert.deepEqual(pasted.components, [{ slot: "A", type: "cpm2-ixr-e" }]);
  assert.equal(pasted["startup-config"], "configs/srl1.cfg");

  // Inherited values stay inherited
  assert.equal("image" in pasted, false);
  assert.equal("type" in pasted, false);
  assert.deepEqual(pasted.labels, { peer: "srl2", site: "dc1" });

  // Comments travel with the node
  assert.match(doc.toString(), /srl2:\n(?: {6}.*\n)* {6}mgmt-net: oob # second management network/);

  // The source node is untouched
  assert.deepEqual(nodeJs(doc, "srl1"), nodeJs(YAML.parseDocument(LAB_YAML), "srl1"));
});

test("paste renames identity fields, drops mgmt addresses and moves taken host ports", () => {
  const doc = YAML.parseDocument(LAB_YAML);
  pasteNode(doc, copyNode(LAB_YAML, "srl1"), "srl2");

  const pasted = nodeJs(doc, "srl2") as Record<string, unknown>;
  assert.equal(pasted.hostname, "srl2");
  assert.equal("mgmt-ipv4" in pasted, false);
  assert.equal("mgmt-ipv6" in pasted, false);
  assert.deepEqual(pasted.ports, [
    "50081:80",
    "127.0.0.1:50444:443/tcp",
    "8002-8003:9000-9001",
    22
  ]);

  // A second paste picks the next free ports again
  pasteNode(doc, copyNode(LAB_YAML, "srl1"), "srl3");
  const third = nodeJs(doc, "srl3") as Record<string, unknown>;
  assert.equal(third.hostname, "srl3");
  assert.deepEqual(third.ports, [
    "50082:80",
    "127.0.0.1:50445:443/tcp",
    "8004-8005:9000-9001",
    22
  ]);
});

test("a custom hostname is kept as written", () => {
  const yaml = `topology:
  nodes:
    r1:
      kind: linux
      image: alpine:3
      hostname: edge-router
`;
  const doc = YAML.parseDocument(yaml);
  pasteNode(doc, copyNode(yaml, "r1"), "r2");
  assert.equal((nodeJs(doc, "r2") as Record<string, unknown>).hostname, "edge-router");
});

test("paste keeps frr daemons and ceos copy-to-flash", () => {
  const doc = YAML.parseDocument(LAB_YAML);
  pasteNode(doc, copyNode(LAB_YAML, "frr1"), "frr2");
  pasteNode(doc, copyNode(LAB_YAML, "ceos1"), "ceos2");

  assert.deepEqual(nodeJs(doc, "frr2"), {
    kind: "frr",
    image: "quay.io/frrouting/frr:10.2.1",
    daemons: ["bgpd", "ospfd"]
  });
  assert.deepEqual(nodeJs(doc, "ceos2"), {
    kind: "arista_ceos",
    image: "ceos:4.33",
    "copy-to-flash": ["flash/license.json"]
  });
  assert.match(
    doc.toString(),
    /# frr router\n {4}frr2:\n {6}kind: frr\n {6}image: [^\n]+\n {6}daemons: \[ bgpd, ospfd \]/
  );
});

test("values inherited from groups, kinds and defaults are not baked in", () => {
  const doc = YAML.parseDocument(LAB_YAML);
  // extraData carries the resolved values, as the graph does
  pasteNode(doc, copyNode(LAB_YAML, "spine1"), "spine2", {
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:24.10",
    group: "spines",
    labels: { owner: "lab-team" }
  });
  pasteNode(doc, copyNode(LAB_YAML, "host1"), "host2", {
    kind: "linux",
    image: "ghcr.io/example/default:1.0",
    labels: { role: "host" }
  });
  pasteNode(doc, copyNode(LAB_YAML, "shorthand"), "shorthand2", {
    kind: "nokia_srlinux",
    image: "ghcr.io/example/default:1.0"
  });

  assert.deepEqual(nodeJs(doc, "spine2"), { group: "spines" });
  assert.deepEqual(nodeJs(doc, "host2"), { kind: "linux" });
  // `shorthand:` has no own keys; containerlab needs a kind, so the effective one is written
  assert.deepEqual(nodeJs(doc, "shorthand2"), { kind: "nokia_srlinux" });
});

test("cross-lab paste writes the effective kind and image only when the target cannot resolve them", () => {
  const doc = YAML.parseDocument(EMPTY_LAB_YAML);
  pasteNode(doc, copyNode(LAB_YAML, "spine1"), "spine1", {
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:24.10"
  });
  pasteNode(doc, copyNode(LAB_YAML, "srl1"), "srl1", {
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:25.10"
  });

  // The group does not exist in the target, so kind and image are written
  assert.deepEqual(nodeJs(doc, "spine1"), {
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:24.10",
    group: "spines"
  });
  const srl1 = nodeJs(doc, "srl1") as Record<string, unknown>;
  assert.equal(srl1.image, "ghcr.io/nokia/srlinux:25.10");
  // Same name in the target: hostname, labels and free host ports stay as they were
  assert.equal(srl1.hostname, "srl1");
  assert.deepEqual(srl1.labels, { peer: "srl1", site: "dc1" });
  assert.deepEqual(srl1.ports, ["50080:80", "127.0.0.1:50443:443/tcp", "8000-8001:9000-9001", 22]);
  assert.equal("mgmt-ipv4" in srl1, false);
});

test("cross-lab paste uses the target's kinds when they provide the image", () => {
  const target = `topology:
  kinds:
    NOKIA_SRLINUX:
      image: ghcr.io/nokia/srlinux:23.10
  nodes:
    a:
      kind: nokia_srlinux
`;
  const doc = YAML.parseDocument(target);
  pasteNode(doc, copyNode(LAB_YAML, "srl1"), "b", {
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:25.10"
  });
  assert.equal("image" in (nodeJs(doc, "b") as Record<string, unknown>), false);
});

test("aliases in the copied node are resolved and anchors are dropped", () => {
  const yaml = `topology:
  nodes:
    r1:
      kind: linux
      image: &img alpine:3
      env: &env
        A: "1"
    r2:
      kind: linux
      image: *img
      env: *env
`;
  const doc = YAML.parseDocument(yaml);
  pasteNode(doc, copyNode(yaml, "r2"), "r3");
  pasteNode(doc, copyNode(yaml, "r1"), "r4");

  assert.deepEqual(nodeJs(doc, "r3"), { kind: "linux", image: "alpine:3", env: { A: "1" } });
  assert.deepEqual(nodeJs(doc, "r4"), { kind: "linux", image: "alpine:3", env: { A: "1" } });
  const text = doc.toString();
  assert.equal(text.match(/&img/g)?.length, 1);
  assert.equal(text.match(/&env/g)?.length, 1);
});

test("nodes without copied YAML still use node data", () => {
  const doc = YAML.parseDocument(EMPTY_LAB_YAML);
  assert.deepEqual(
    addNodeToDoc(doc, {
      id: "n1",
      name: "n1",
      extraData: { kind: "linux", image: "alpine:3" },
      yamlSource: { name: "old", yaml: "kind: [" }
    }),
    { success: true }
  );
  assert.deepEqual(nodeJs(doc, "n1"), { kind: "linux", image: "alpine:3" });
});

test("deleting a node and re-adding its copied YAML restores it exactly", () => {
  const doc = YAML.parseDocument(LAB_YAML);
  const source = copyNode(LAB_YAML, "frr1");
  assert.deepEqual(deleteNodeFromDoc(doc, "frr1"), { success: true });
  pasteNode(doc, source, "frr1");
  assert.deepEqual(nodeJs(doc, "frr1"), nodeJs(YAML.parseDocument(LAB_YAML), "frr1"));
});
