import assert from "node:assert/strict";
import test from "node:test";
import { prepareViewer } from "./prepareViewer";

test("legacy graph labels retain positions and icons without a host session", () => {
  const { snapshot } = prepareViewer(`name: legacy
topology:
  nodes:
    router:
      kind: linux
      labels: {graph-posX: "140", graph-posY: "280", graph-icon: spine}
`);
  assert.deepEqual(snapshot.nodes[0].position, { x: 140, y: 280 });
  assert.equal(snapshot.nodes[0].data.role, "spine");
  assert.deepEqual(snapshot.annotations.nodeAnnotations?.[0].position, { x: 140, y: 280 });
});

test("saved link label offsets override the global value, including explicitly disabled offsets", () => {
  const yaml = `name: labels
topology:
  nodes: {a: {kind: linux}, b: {kind: linux}}
  links:
    - endpoints: [a:eth1, b:eth1]
    - endpoints: [a:eth2, b:eth2]
`;
  const { snapshot } = prepareViewer(yaml, JSON.stringify({
    viewerSettings: { endpointLabelOffset: 55 },
    edgeAnnotations: [
      { source: "a", target: "b", sourceEndpoint: "eth1", targetEndpoint: "eth1", endpointLabelOffset: 45 },
      { source: "a", target: "b", sourceEndpoint: "eth2", targetEndpoint: "eth2", endpointLabelOffsetEnabled: false }
    ]
  }));
  assert.equal(snapshot.edges[0].data?.endpointLabelOffset, 45);
  assert.equal(snapshot.edges[1].data?.endpointLabelOffset, 0);
  assert.equal(snapshot.edges[1].data?.endpointLabelOffsetEnabled, false);
});

test("invalid annotation collections fail with an actionable error", () => {
  const yaml = "topology: {nodes: {a: {kind: linux}}}";
  for (const annotations of ["null", "[]", '{"nodeAnnotations":{}}', '{"nodeAnnotations":[null]}', '{"viewerSettings":[]}']) {
    assert.throws(() => prepareViewer(yaml, annotations), /Topology annotations must be/);
  }
});
