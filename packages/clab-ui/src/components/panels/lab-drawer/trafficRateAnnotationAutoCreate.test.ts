import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, Node } from "@xyflow/react";

import { nodesToAnnotations } from "../../../annotations";
import { AUTO_CREATED_TRAFFIC_RATE_LABEL } from "../../../annotations/constants";

import {
  ensureTrafficRateAnnotationsForLinks,
  syncRateLabelAnnotationsForLinks
} from "./trafficRateAnnotationAutoCreate";

const baseNodes: Node[] = [
  {
    id: "srl1",
    type: "topology-node",
    position: { x: 0, y: 0 },
    width: 40,
    height: 40,
    data: {}
  },
  {
    id: "srl2",
    type: "topology-node",
    position: { x: 200, y: 0 },
    width: 40,
    height: 40,
    data: {}
  }
];

const baseEdges: Edge[] = [
  {
    id: "srl1:e1-1--srl2:e1-2",
    source: "srl1",
    target: "srl2",
    data: {
      sourceEndpoint: "e1-1",
      targetEndpoint: "e1-2"
    }
  }
];

test("auto-creates text TX traffic-rate annotations for both link endpoints", () => {
  const result = ensureTrafficRateAnnotationsForLinks(baseNodes, baseEdges);

  assert.equal(result.createdCount, 2);
  assert.equal(result.removedCount, 0);

  const annotations = nodesToAnnotations(result.nodes).trafficRateAnnotations;
  assert.deepEqual(
    annotations.map((annotation) => [annotation.nodeId, annotation.interfaceName]),
    [
      ["srl1", "e1-1"],
      ["srl2", "e1-2"]
    ]
  );
  assert.equal(annotations[0]?.mode, "text");
  assert.equal(annotations[0]?.label, AUTO_CREATED_TRAFFIC_RATE_LABEL);
  assert.equal(annotations[0]?.textMetric, "tx");
  assert.equal(annotations[0]?.width, 50);
  assert.equal(annotations[0]?.height, 30);
  assert.equal(annotations[0]?.borderWidth, 0);
  assert.deepEqual(annotations[0]?.position, { x: 65, y: 5 });
  assert.equal(annotations[1]?.label, AUTO_CREATED_TRAFFIC_RATE_LABEL);
  assert.deepEqual(annotations[1]?.position, { x: 125, y: 5 });
});

test("auto-create skips endpoints that already have traffic-rate annotations", () => {
  const first = ensureTrafficRateAnnotationsForLinks(baseNodes, baseEdges);
  const second = ensureTrafficRateAnnotationsForLinks(first.nodes, baseEdges);

  assert.equal(second.createdCount, 0);
  assert.equal(second.removedCount, 0);
  assert.equal(second.nodes, first.nodes);
});

test("sync removes only auto-created traffic-rate annotations when rate labels are hidden", () => {
  const created = syncRateLabelAnnotationsForLinks(baseNodes, baseEdges, true);
  const manualTrafficRateNode: Node = {
    id: "manual-traffic-rate",
    type: "traffic-rate-node",
    position: { x: 0, y: 80 },
    data: {
      nodeId: "srl1",
      interfaceName: "e1-3",
      mode: "text",
      textMetric: "tx",
      width: 50,
      height: 30
    }
  };

  const hidden = syncRateLabelAnnotationsForLinks(
    [...created.nodes, manualTrafficRateNode],
    baseEdges,
    false
  );

  assert.equal(hidden.createdCount, 0);
  assert.equal(hidden.removedCount, 2);
  assert.deepEqual(
    nodesToAnnotations(hidden.nodes).trafficRateAnnotations.map((annotation) => annotation.id),
    ["manual-traffic-rate"]
  );
});
