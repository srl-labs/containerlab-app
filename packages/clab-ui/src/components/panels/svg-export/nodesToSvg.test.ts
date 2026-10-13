import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Edge, Node } from "@xyflow/react";

import {
  getNodeBoxMetrics,
  NODE_BOX_LABEL_FONT_SIZE_PX,
  NODE_BOX_LABEL_FONT_WEIGHT,
  NODE_BOX_LABEL_LINE_HEIGHT_PX
} from "../../canvas/nodeBox";

import { renderEdgesToSvg } from "./edgesToSvg";
import { renderNodesToSvg } from "./nodesToSvg";

const ICON_SIZE = 40;
const box = getNodeBoxMetrics(ICON_SIZE);

function topologyNode(id: string, x: number, y: number, data: Record<string, unknown> = {}): Node {
  return { id, type: "topology-node", position: { x, y }, data: { label: id, ...data } };
}

function readNumberAttr(svg: string, element: string, attr: string): number {
  const match = new RegExp(`<${element}[^>]*\\s${attr}="([^"]+)"`).exec(svg);
  assert.ok(match, `missing ${attr} on <${element}>`);
  return Number(match[1]);
}

function readBoxRect(svg: string): { x: number; y: number; width: number; height: number } {
  const element = 'rect class="export-node-box"';
  return {
    x: readNumberAttr(svg, element, "x"),
    y: readNumberAttr(svg, element, "y"),
    width: readNumberAttr(svg, element, "width"),
    height: readNumberAttr(svg, element, "height")
  };
}

function readBoxLabel(svg: string): string {
  const match = /<text class="export-node-box-label"[^>]*>([^<]*)<\/text>/.exec(svg);
  assert.ok(match, "missing box label");
  return match[1];
}

function readEdgePoints(svg: string): { sx: number; sy: number; tx: number; ty: number } {
  const match = /<path d="M ([^\s"]+) ([^\s"]+) [LQ] (?:[^\s"]+ [^\s"]+ )?([^\s"]+) ([^\s"]+)"/.exec(
    svg
  );
  assert.ok(match, "missing edge path");
  const [sx, sy, tx, ty] = match.slice(1).map(Number);
  return { sx, sy, tx, ty };
}

describe("node SVG export", () => {
  it("keeps the icon style free of boxes", () => {
    const nodes = [topologyNode("srl1", 0, 0)];
    const defaultSvg = renderNodesToSvg(nodes);
    assert.equal(renderNodesToSvg(nodes, undefined, undefined, { nodeStyle: "icon" }), defaultSvg);
    assert.ok(!defaultSvg.includes("export-node-box"));
    assert.ok(defaultSvg.includes('filter="url(#text-shadow)"'));
  });

  it("draws the box behind the icon, inset by half the border", () => {
    const node = topologyNode("srl1", 100, 50);
    node.measured = { width: 60, height: ICON_SIZE };
    const svg = renderNodesToSvg([node], undefined, undefined, {
      nodeIconSize: ICON_SIZE,
      nodeStyle: "boxed"
    });
    const iconX = 100 + (60 - ICON_SIZE) / 2;
    assert.deepEqual(readBoxRect(svg), {
      x: iconX + box.offsetX + 0.5,
      y: 50 + box.offsetY + 0.5,
      width: box.width - 1,
      height: box.height - 1
    });
    assert.equal(readNumberAttr(svg, 'rect class="export-node-box"', "rx"), box.borderRadius - 0.5);
    assert.ok(svg.indexOf("export-node-box") < svg.indexOf('class="export-node-icon"'));
    assert.equal(readNumberAttr(svg, 'svg class="export-node-icon"', "x"), iconX);
    assert.equal(readNumberAttr(svg, 'svg class="export-node-icon"', "width"), ICON_SIZE);
  });

  it("draws built-in icons as a hex in the ink around a symbol in the icon color", () => {
    const svg = renderNodesToSvg(
      [topologyNode("leaf1", 0, 0, { role: "leaf", iconColor: "#ff6600" })],
      undefined,
      undefined,
      { iconInk: "#001135" }
    );
    assert.ok(svg.includes('stroke="#001135"'));
    assert.ok(svg.includes('color="#ff6600"'));
    // The hex has no tile behind it.
    assert.ok(!svg.includes('<rect x="0" y="0"'));
  });

  it("puts the name on one row at the bottom of the box", () => {
    const svg = renderNodesToSvg(
      [topologyNode("srl1", 100, 50, { labelPosition: "top", direction: "down" })],
      undefined,
      undefined,
      { nodeIconSize: ICON_SIZE, nodeStyle: "boxed" }
    );
    const rowTop =
      50 + box.offsetY + box.height - box.labelInset - NODE_BOX_LABEL_LINE_HEIGHT_PX;
    assert.equal(readNumberAttr(svg, "text", "x"), 100 + ICON_SIZE / 2);
    assert.equal(readNumberAttr(svg, "text", "y"), rowTop + NODE_BOX_LABEL_LINE_HEIGHT_PX / 2);
    assert.equal(readNumberAttr(svg, "text", "font-size"), NODE_BOX_LABEL_FONT_SIZE_PX);
    assert.equal(readNumberAttr(svg, "text", "font-weight"), NODE_BOX_LABEL_FONT_WEIGHT);
    assert.equal(readBoxLabel(svg), "srl1");
    // Boxed nodes keep the icon upright and drop the pill and text shadow.
    assert.ok(!/rotate\((?!0 )/.test(svg));
    assert.ok(!svg.includes("text-shadow"));
  });

  it("boxes network nodes too", () => {
    const node: Node = {
      id: "host:e1",
      type: "network-node",
      position: { x: 0, y: 0 },
      data: { label: "host:e1", nodeType: "host" }
    };
    const svg = renderNodesToSvg([node], undefined, undefined, { nodeStyle: "boxed" });
    assert.ok(svg.includes('class="export-node network-node"'));
    assert.equal(readBoxRect(svg).x, box.offsetX + 0.5);
    assert.equal(readBoxLabel(svg), "host:e1");
  });

  it("truncates long names in the middle and keeps the suffix", () => {
    const svg = renderNodesToSvg(
      [topologyNode("srl-datacenter1-leaf-01", 0, 0)],
      undefined,
      undefined,
      { nodeStyle: "boxed" }
    );
    const label = readBoxLabel(svg);
    const [head, tail] = label.split("…");
    assert.equal(tail, "eaf-01");
    assert.ok(head.length > 0 && "srl-datacenter1-leaf-01".startsWith(head));
    // Without a DOM the width estimate is 0.6em per character.
    assert.ok(Array.from(label).length * NODE_BOX_LABEL_FONT_SIZE_PX * 0.6 <= box.labelMaxWidth);
  });
});

describe("edge SVG export with boxed nodes", () => {
  const nodes = [topologyNode("a", 0, 0), topologyNode("b", 300, 0), topologyNode("c", 0, 300)];

  function render(edges: Edge[], options: Parameters<typeof renderEdgesToSvg>[4] = {}): string {
    return renderEdgesToSvg(edges, nodes, true, undefined, {
      nodeIconSize: ICON_SIZE,
      ...options
    });
  }

  it("attaches horizontal links to the box sides", () => {
    const edges: Edge[] = [{ id: "a-b", source: "a", target: "b" }];
    assert.deepEqual(readEdgePoints(render(edges)), { sx: 40, sy: 20, tx: 300, ty: 20 });
    const boxCenterY = box.offsetY + box.height / 2;
    assert.deepEqual(readEdgePoints(render(edges, { nodeStyle: "boxed" })), {
      sx: box.offsetX + box.width,
      sy: boxCenterY,
      tx: 300 + box.offsetX,
      ty: boxCenterY
    });
  });

  it("attaches vertical links to the box top and bottom", () => {
    const edges: Edge[] = [{ id: "a-c", source: "a", target: "c" }];
    const points = readEdgePoints(render(edges, { nodeStyle: "boxed" }));
    assert.equal(points.sy, box.offsetY + box.height);
    assert.equal(points.ty, 300 + box.offsetY);
  });

  it("starts loops on the box outline", () => {
    const edges: Edge[] = [{ id: "a-a", source: "a", target: "a" }];
    const match = /<path d="M (\S+) (\S+) C/.exec(render(edges, { nodeStyle: "boxed" }));
    assert.ok(match, "missing loop path");
    assert.equal(Number(match[1]), box.offsetX + box.width);
  });

  it("anchors telemetry bubbles outside the box", () => {
    const edges: Edge[] = [
      {
        id: "a-b",
        source: "a",
        target: "b",
        data: { sourceEndpoint: "e1-1", targetEndpoint: "e1-1" }
      }
    ];
    const svg = render(edges, { nodeStyle: "boxed", telemetryStyleLabels: true });
    const radius = readNumberAttr(svg, "circle", "r");
    const points = readEdgePoints(svg);
    assert.equal(points.sx, box.offsetX + box.width + radius + 1);
    assert.equal(points.tx, 300 + box.offsetX - radius - 1);
  });
});
