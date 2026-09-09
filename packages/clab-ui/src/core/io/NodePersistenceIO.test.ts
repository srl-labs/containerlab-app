import assert from "node:assert/strict";
import test from "node:test";

import * as YAML from "yaml";

import { addLinkToDoc } from "./LinkPersistenceIO";
import { addNodeToDoc } from "./NodePersistenceIO";

test("adding nodes and links to an empty document emits block-style topology YAML", () => {
  const doc = YAML.parseDocument("");

  assert.deepEqual(addNodeToDoc(doc, {
    id: "srl1",
    name: "srl1",
    extraData: {
      kind: "nokia_srlinux",
      type: "ixr-d1",
      image: "ghcr.io/nokia/srlinux:latest"
    }
  }), { success: true });

  assert.deepEqual(addNodeToDoc(doc, {
    id: "client1",
    name: "client1",
    extraData: {
      kind: "linux",
      image: "ghcr.io/srl-labs/network-multitool:latest"
    }
  }), { success: true });

  assert.deepEqual(addLinkToDoc(doc, {
    id: "srl1:e1-1--client1:eth1",
    source: "srl1",
    sourceEndpoint: "e1-1",
    target: "client1",
    targetEndpoint: "eth1"
  }), { success: true });

  assert.equal(
    doc.toString(),
    `topology:
  nodes:
    srl1:
      kind: nokia_srlinux
      type: ixr-d1
      image: ghcr.io/nokia/srlinux:latest
    client1:
      kind: linux
      image: ghcr.io/srl-labs/network-multitool:latest
  links:
    - endpoints: [ "srl1:e1-1", "client1:eth1" ]
`
  );
});
