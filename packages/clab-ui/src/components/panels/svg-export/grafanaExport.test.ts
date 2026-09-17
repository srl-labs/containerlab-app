import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, Node } from "@xyflow/react";

import { TRAFFIC_RATE_NODE_TYPE } from "../../../annotations/annotationNodeConverters";

import {
  buildGrafanaPanelYaml,
  collectGrafanaEdgeCellMappings,
  collectGrafanaTrafficRateLabelPlacements
} from "./grafanaExport";

const annotationNodeTypes = new Set<string>([TRAFFIC_RATE_NODE_TYPE]);

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function requireNumber(value: number | undefined): number {
  if (typeof value !== "number") {
    assert.fail("Expected a number");
  }
  return value;
}

test("traffic-rate annotations provide Grafana label placement and metric refs", () => {
  const nodes: Node[] = [
    { id: "srl1", type: "topology-node", position: { x: 0, y: 0 }, data: {} },
    { id: "srl2", type: "topology-node", position: { x: 200, y: 0 }, data: {} },
    {
      id: "rate-source",
      type: TRAFFIC_RATE_NODE_TYPE,
      position: { x: 10, y: 20 },
      width: 50,
      height: 30,
      data: { nodeId: "srl1", interfaceName: "e1-1", textMetric: "rx" }
    },
    {
      id: "rate-target",
      type: TRAFFIC_RATE_NODE_TYPE,
      position: { x: 200, y: 20 },
      width: 100,
      height: 30,
      data: { nodeId: "srl2", interfaceName: "e1-2", textMetric: "combined" }
    }
  ];
  const edges: Edge[] = [
    {
      id: "edge-1",
      source: "srl1",
      target: "srl2",
      data: {
        sourceEndpoint: "e1-1",
        targetEndpoint: "e1-2"
      }
    }
  ];

  const mappings = collectGrafanaEdgeCellMappings(edges, nodes, annotationNodeTypes);
  const placements = collectGrafanaTrafficRateLabelPlacements(nodes, mappings);

  assert.equal(mappings.length, 1);
  assert.deepEqual(
    placements.map(({ labelCellId, x, y, dataRef }) => ({ labelCellId, x, y, dataRef })),
    [
      {
        labelCellId: "link_id:srl1:e1-1:srl2:e1-2:label",
        x: 35,
        y: 35,
        dataRef: "srl1:e1-1:in"
      },
      {
        labelCellId: "link_id:srl2:e1-2:srl1:e1-1:label",
        x: 250,
        y: 35,
        dataRef: "srl2:e1-2:out"
      }
    ]
  );
  assert.deepEqual(placements.map((placement) => rounded(requireNumber(placement.fontSize))), [
    5.914,
    12.634
  ]);
  assert.ok(requireNumber(placements[1]!.fontSize) > requireNumber(placements[0]!.fontSize));

  const yaml = buildGrafanaPanelYaml(mappings, { trafficRateLabelPlacements: placements });
  assert.ok(
    yaml.includes('"link_id:srl1:e1-1:srl2:e1-2:label":\n    dataRef: "srl1:e1-1:in"')
  );
  assert.ok(
    yaml.includes('"link_id:srl2:e1-2:srl1:e1-1:label":\n    dataRef: "srl2:e1-2:out"')
  );
});

test("traffic-rate placement font size can be derived from node data dimensions", () => {
  const nodes: Node[] = [
    { id: "srl1", type: "topology-node", position: { x: 0, y: 0 }, data: {} },
    { id: "srl2", type: "topology-node", position: { x: 200, y: 0 }, data: {} },
    {
      id: "rate-source",
      type: TRAFFIC_RATE_NODE_TYPE,
      position: { x: 10, y: 20 },
      data: { nodeId: "srl1", interfaceName: "e1-1", textMetric: "tx", width: 150, height: 60 }
    }
  ];
  const edges: Edge[] = [
    {
      id: "edge-1",
      source: "srl1",
      target: "srl2",
      data: {
        sourceEndpoint: "e1-1",
        targetEndpoint: "e1-2"
      }
    }
  ];

  const mappings = collectGrafanaEdgeCellMappings(edges, nodes, annotationNodeTypes);
  const placements = collectGrafanaTrafficRateLabelPlacements(nodes, mappings);

  assert.equal(placements.length, 1);
  assert.equal(placements[0]!.x, 85);
  assert.equal(placements[0]!.y, 50);
  assert.equal(rounded(requireNumber(placements[0]!.fontSize)), 19.355);
});
