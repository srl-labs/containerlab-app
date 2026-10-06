import assert from "node:assert/strict";
import test from "node:test";

import * as YAML from "yaml";

import { addLinkToDoc } from "./LinkPersistenceIO";
import type { NodeAnnotation } from "../types/topology";

import { addNodeToDoc, applyAnnotationData } from "./NodePersistenceIO";

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

test("applyAnnotationData sets, updates and clears the box appearance", () => {
  const annotation: NodeAnnotation = { id: "srl1", iconColor: "#ff0000" };

  applyAnnotationData(annotation, { box: { color: "#112233", opacity: 60, blur: 8 } });
  assert.deepEqual(annotation.box, { color: "#112233", opacity: 60, blur: 8 });

  // Updates replace the whole box, and defaults are not stored.
  applyAnnotationData(annotation, { box: { color: "#445566", opacity: 100, shadow: false } });
  assert.deepEqual(annotation.box, { color: "#445566", shadow: false });

  // Absent leaves the box alone.
  applyAnnotationData(annotation, { iconColor: "#00ff00" });
  assert.deepEqual(annotation.box, { color: "#445566", shadow: false });

  applyAnnotationData(annotation, { box: null });
  assert.equal("box" in annotation, false);
  assert.equal(annotation.iconColor, "#00ff00");
});

test("applyAnnotationData drops a box that only holds defaults", () => {
  const annotation: NodeAnnotation = { id: "srl1", box: { color: "#112233" } };
  applyAnnotationData(annotation, { box: { opacity: 100, borderWidth: 1, shadow: true } });
  assert.equal("box" in annotation, false);
});
