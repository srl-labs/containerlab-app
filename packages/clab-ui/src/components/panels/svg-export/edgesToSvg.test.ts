import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Edge, Node } from "@xyflow/react";

import { layoutEdges, renderEdgesToSvg, type EdgeSvgRenderOptions } from "./edgesToSvg";

const ICON_SIZE = 40;

function topologyNode(id: string, x: number, y: number): Node {
  return { id, type: "topology-node", position: { x, y }, data: { label: id } };
}

function link(id: string, source: string, target: string): Edge {
  return { id, source, target, data: { sourceEndpoint: "e1-1", targetEndpoint: "e1-2" } };
}

// a sits above and left of b, so links leave a downwards and enter b from the top.
const nodes = [topologyNode("a", 0, 0), topologyNode("b", 200, 300)];

function render(edges: Edge[], options: EdgeSvgRenderOptions): string {
  return renderEdgesToSvg(edges, nodes, true, undefined, { nodeIconSize: ICON_SIZE, ...options });
}

function layout(edges: Edge[], options: EdgeSvgRenderOptions) {
  return layoutEdges(edges, nodes, true, undefined, { nodeIconSize: ICON_SIZE, ...options });
}

/** Every `<path>` of the edge group, in drawing order. */
function readPaths(svg: string): { d: string; stroke: string; width: number; opacity?: number }[] {
  return Array.from(svg.matchAll(/<path d="([^"]+)"[^>]*?stroke="([^"]+)"\s*stroke-width="([^"]+)"(?:\s*opacity="([^"]+)")?/g)).map(
    (match) => ({
      d: match[1],
      stroke: match[2],
      width: Number(match[3]),
      opacity: match[4] === undefined ? undefined : Number(match[4])
    })
  );
}

function readRotations(svg: string): number[] {
  return Array.from(svg.matchAll(/<g class="edge-label" transform="rotate\((\S+) /g)).map((match) =>
    Number(match[1])
  );
}

describe("edge SVG export with elbow and curved links", () => {
  it("keeps straight links as they were", () => {
    const [path] = readPaths(render([link("a-b", "a", "b")], {}));
    assert.equal(path.width, 4);
    assert.equal(path.opacity, 0.5);
    assert.match(path.d, /^M \S+ \S+ L \S+ \S+$/);
  });

  it("draws elbow links with right-angle bends and labels along them", () => {
    const svg = render([link("a-b", "a", "b")], { linkStyle: "elbow" });
    const [path] = readPaths(svg);
    assert.equal(path.width, 2.5);
    // Every straight run is horizontal or vertical; only the corners are rounded.
    const runs = Array.from(path.d.matchAll(/(\S+) (\S+) L (\S+) (\S+)/g));
    assert.equal(runs.length, 3);
    for (const [, x1, y1, x2, y2] of runs) assert.ok(x1 === x2 || y1 === y2, `${x1},${y1} to ${x2},${y2}`);
    // Leaves the bottom of a at its center and enters the top of b.
    assert.match(path.d, /^M 20 40 /);
    assert.match(path.d, / 220 300$/);
    assert.deepEqual(readRotations(svg), [-90, -90]);
  });

  it("draws curved links that leave and enter their nodes head on", () => {
    const svg = render([link("a-b", "a", "b")], { linkStyle: "curve", linkCurvature: 0.5 });
    const [path] = readPaths(svg);
    const points = Array.from(path.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)).map((match) => ({
      x: Number(match[1]),
      y: Number(match[2])
    }));
    assert.ok(points.length > 10, "traced as a smooth curve");
    assert.deepEqual(points[0], { x: 20, y: 40 });
    assert.deepEqual(points[points.length - 1], { x: 220, y: 300 });
    // Head on: the first and last steps run straight down.
    assert.ok(Math.abs(points[1].x - points[0].x) < 0.5);
    assert.ok(Math.abs(points[points.length - 1].x - points[points.length - 2].x) < 0.5);
    const rotations = readRotations(svg);
    assert.equal(rotations.length, 2);
    for (const rotation of rotations) assert.ok(rotation >= -90 && rotation < 90, "never upside down");
  });

  it("blends routed links into a known background and outlines them in it", () => {
    const svg = render([link("a-b", "a", "b")], { linkStyle: "curve", linkBackground: "#000000" });
    const [casing, path] = readPaths(svg);
    assert.equal(casing.stroke, "#000000");
    assert.equal(casing.width, 2.5 + 1.5 * 2);
    assert.equal(path.d, casing.d);
    // 70% of the default link color #969799 over black.
    assert.equal(path.stroke, "#696a6b");
    assert.equal(path.opacity, 1);
  });

  it("leaves routed links see-through on a transparent background", () => {
    const paths = readPaths(render([link("a-b", "a", "b")], { linkStyle: "elbow" }));
    assert.equal(paths.length, 1);
    assert.equal(paths[0].stroke, "#969799");
    assert.equal(paths[0].opacity, 0.7);
  });

  it("draws loops as rounded rectangles with elbow links", () => {
    const loop: Edge = { id: "a-a", source: "a", target: "a" };
    const [elbowLoop] = readPaths(render([loop], { linkStyle: "elbow" }));
    assert.doesNotMatch(elbowLoop.d, / C /);
    const [curveLoop] = readPaths(render([loop], { linkStyle: "curve" }));
    assert.match(curveLoop.d, / C /);
  });

  it("lays out elbow links as rounded corners at their bends", () => {
    const [edge] = layout([link("a-b", "a", "b")], { linkStyle: "elbow" });
    assert.equal(edge.shape, "elbow");
    assert.ok(edge.cornerRadius > 0);
    assert.equal(edge.bends.length, 2);
    assert.equal(edge.bends[0].x, 20);
    assert.equal(edge.bends[1].x, 220);
    assert.equal(edge.bends[0].y, edge.bends[1].y);
    assert.ok(edge.startPinned && edge.endPinned);
    assert.deepEqual(
      edge.labels.map((label) => label.rotation),
      [-90, -90]
    );
  });

  it("lays out curved links as a few points along the curve", () => {
    const [edge] = layout([link("a-b", "a", "b")], { linkStyle: "curve" });
    assert.equal(edge.shape, "curve");
    assert.ok(edge.bends.length >= 5 && edge.bends.length <= 40, `${edge.bends.length} bends`);
    for (let i = 1; i < edge.bends.length; i++) {
      const step = Math.hypot(
        edge.bends[i].x - edge.bends[i - 1].x,
        edge.bends[i].y - edge.bends[i - 1].y
      );
      assert.ok(step >= 12 - 1e-6, "points stay apart, so the link is easy to edit");
    }
    assert.equal(edge.strokeWidth, 2.5);
  });
});
