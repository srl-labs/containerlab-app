import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_TEXT_NODE_TYPE,
  GROUP_NODE_TYPE
} from "../../annotations/annotationNodeConverters";

import { filterClipboardDataForPaste, type ClipboardData } from "./useClipboard";

const clipboardData: ClipboardData = {
  version: "1.0",
  origin: { x: 100, y: 100 },
  timestamp: 1234,
  nodes: [
    {
      id: "leaf1",
      type: "topology-node",
      data: { name: "leaf1" },
      position: { x: 0, y: 0 },
      relativePosition: { x: -50, y: 0 }
    },
    {
      id: "freeText_1",
      type: FREE_TEXT_NODE_TYPE,
      data: { text: "note" },
      position: { x: 100, y: 100 },
      relativePosition: { x: 0, y: 0 }
    },
    {
      id: "group_1",
      type: GROUP_NODE_TYPE,
      data: { label: "group" },
      position: { x: 200, y: 100 },
      relativePosition: { x: 100, y: 0 }
    }
  ],
  edges: [
    {
      id: "leaf1:e1--leaf2:e1",
      source: "leaf1",
      target: "leaf2",
      data: { sourceEndpoint: "e1", targetEndpoint: "e1" }
    }
  ]
};

test("filterClipboardDataForPaste returns the original clipboard data by default", () => {
  assert.equal(filterClipboardDataForPaste(clipboardData), clipboardData);
});

test("filterClipboardDataForPaste keeps only annotations for annotation-only paste", () => {
  const filtered = filterClipboardDataForPaste(clipboardData, { annotationsOnly: true });

  assert.deepEqual(
    filtered.nodes.map((node) => node.id),
    ["freeText_1", "group_1"]
  );
  assert.deepEqual(filtered.edges, []);
  assert.equal(clipboardData.nodes.length, 3);
  assert.equal(clipboardData.edges.length, 1);
});
