import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRoundedPolylinePath,
  fitPortPositions,
  getPointAlongPolyline,
  parseLinkStyle,
  routeElbowLinks,
  type ElbowLinkInput
} from "./elbowRouting";

const SIZE = 40;

function rect(x: number, y: number) {
  return { x, y, width: SIZE, height: SIZE };
}

function link(id: string, source: string, target: string, from: [number, number], to: [number, number]) {
  return {
    id,
    source,
    target,
    sourceRect: rect(...from),
    targetRect: rect(...to)
  } satisfies ElbowLinkInput;
}

function isOrthogonal(points: { x: number; y: number }[]): boolean {
  return points.every((point, i) => i === 0 || point.x === points[i - 1].x || point.y === points[i - 1].y);
}

test("parseLinkStyle accepts only known styles", () => {
  assert.equal(parseLinkStyle("elbow"), "elbow");
  assert.equal(parseLinkStyle("straight"), "straight");
  assert.equal(parseLinkStyle("curved"), null);
  assert.equal(parseLinkStyle(undefined), null);
});

test("aligned nodes get one straight segment", () => {
  const routes = routeElbowLinks([link("a", "s", "t", [0, 0], [0, 200])]);
  assert.deepEqual(routes.get("a")?.points, [
    { x: 20, y: 40 },
    { x: 20, y: 200 }
  ]);
});

test("offset nodes bend through the middle of the gap with right angles", () => {
  const route = routeElbowLinks([link("a", "s", "t", [0, 0], [200, 200])]).get("a");
  assert.ok(route);
  assert.equal(route.points.length, 4);
  assert.ok(isOrthogonal(route.points));
  assert.equal(route.points[1].y, 120);
  assert.equal(route.sourceSide, "bottom");
  assert.equal(route.targetSide, "top");
});

test("nodes side by side leave through their facing sides", () => {
  const route = routeElbowLinks([link("a", "s", "t", [0, 0], [200, 10])]).get("a");
  assert.ok(route);
  assert.equal(route.sourceSide, "right");
  assert.equal(route.targetSide, "left");
});

test("diagonal links in a layered lab drop through the layer gap", () => {
  const routes = routeElbowLinks([
    link("down1", "spine", "leaf1", [0, 0], [0, 200]),
    link("down2", "spine2", "leaf2", [400, 0], [400, 200]),
    link("cross", "spine", "leaf2", [0, 0], [400, 200])
  ]);
  const cross = routes.get("cross");
  assert.ok(cross);
  assert.equal(cross.sourceSide, "bottom");
});

test("links sharing a side get separate ports ordered by where they head", () => {
  const routes = routeElbowLinks([
    link("right", "spine", "leaf2", [200, 0], [400, 200]),
    link("left", "spine", "leaf1", [200, 0], [0, 200])
  ]);
  const left = routes.get("left");
  const right = routes.get("right");
  assert.ok(left && right);
  assert.ok(left.points[0].x < right.points[0].x);
});

test("parallel links keep apart and do not cross", () => {
  const routes = routeElbowLinks([
    link("p1", "a", "b", [0, 0], [200, 200]),
    link("p2", "a", "b", [0, 0], [200, 200])
  ]);
  const p1 = routes.get("p1")?.points;
  const p2 = routes.get("p2")?.points;
  assert.ok(p1 && p2);
  assert.notEqual(p1[0].x, p2[0].x);
  assert.notEqual(p1[1].y, p2[1].y);
  // The left link heading right takes the lower track, so the two nest.
  assert.ok(p1[0].x < p2[0].x);
  assert.ok(p1[1].y > p2[1].y);
});

test("loops are left to the loop renderer", () => {
  const routes = routeElbowLinks([link("loop", "a", "a", [0, 0], [0, 0])]);
  assert.equal(routes.size, 0);
});

test("rounded path keeps its ends and rounds each bend", () => {
  const path = buildRoundedPolylinePath(
    [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 100, y: 50 }
    ],
    8
  );
  assert.equal(path, "M 0 0 L 0 42 Q 0 50 8 50 L 100 50");
});

test("point along polyline walks across bends and clamps at the end", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 20, y: 10 }
  ];
  assert.deepEqual(getPointAlongPolyline(points, 15), { x: 5, y: 10 });
  assert.deepEqual(getPointAlongPolyline(points, 100), { x: 20, y: 10 });
});

test("fitPortPositions keeps order and spacing and stays inside the side", () => {
  assert.deepEqual(fitPortPositions([5, 5, 5], 2, 0, 10), [3, 5, 7]);
  assert.deepEqual(fitPortPositions([-10, 0, 20], 2, 0, 10), [0, 2, 10]);
  assert.deepEqual(fitPortPositions([0, 4, 8], 2, 0, 10), [0, 4, 8]);
});

test("facing nodes get a straight link even when one side holds more links", () => {
  // spine has links down-left, straight down and down-right; leaf below also
  // takes a link from a second spine on the right.
  const routes = routeElbowLinks([
    link("left", "spine", "leafL", [200, 0], [0, 200]),
    link("down", "spine", "leaf", [200, 0], [200, 200]),
    link("right", "spine", "leafR", [200, 0], [400, 200]),
    link("other", "spine2", "leaf", [600, 0], [200, 200])
  ]);
  const down = routes.get("down");
  assert.ok(down);
  assert.equal(down.points.length, 2);
  assert.equal(down.points[0].x, down.points[1].x);
});

test("links from a crowded side still run straight to the node they face", () => {
  const inputs = Array.from({ length: 12 }, (_, i) =>
    link(`l${i}`, "spine", `leaf${i}`, [400, 0], [i * 80, 300])
  );
  const routes = routeElbowLinks(inputs);
  const facing = routes.get("l5"); // leaf5 sits right under the spine
  assert.ok(facing);
  assert.equal(facing.points.length, 2);
});

test("bends stay past the node name and the endpoint labels", () => {
  const routes = routeElbowLinks(
    [
      {
        ...link("a", "s", "t", [0, 0], [200, 300]),
        sourceLabelLength: 30,
        targetLabelLength: 30
      }
    ],
    { bottomClearance: 16 }
  );
  const points = routes.get("a")?.points;
  assert.ok(points);
  const bendY = points[1].y;
  // node bottom 40 + name 16 + label 30 + air 6
  assert.ok(bendY >= 40 + 16 + 36, `bend at ${bendY}`);
  // target top 300 - label 30 - air 6
  assert.ok(bendY <= 300 - 36, `bend at ${bendY}`);
});

test("many crossing links share the gap instead of piling up at its edges", () => {
  // Eight overlapping links through a 70px gap need more than the usual track spacing.
  const inputs = Array.from({ length: 8 }, (_, i) =>
    link(`l${i}`, `a${i}`, `b${i}`, [i * 10, 0], [100 + i * 10, 110])
  );
  const routes = routeElbowLinks(inputs);
  const bends = [...routes.values()].map((route) => route.points[1].y);
  assert.equal(new Set(bends).size, bends.length);
  assert.ok(bends.every((y) => y > 40 && y < 110));
});

test("bends get tighter where neighbouring links run close", () => {
  const lone = routeElbowLinks([link("a", "s", "t", [0, 0], [200, 200])]).get("a");
  assert.equal(lone?.cornerRadius, 8);

  const crowded = routeElbowLinks(
    Array.from({ length: 8 }, (_, i) => link(`l${i}`, "s", `t${i}`, [0, 0], [200 + i * 60, 200]))
  );
  for (const route of crowded.values()) {
    assert.ok(route.cornerRadius < 8, `radius ${route.cornerRadius}`);
    assert.ok(route.cornerRadius >= 2);
  }
});
