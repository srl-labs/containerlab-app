import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatLabUptime,
  isContainerReady,
  labNodeRunState,
  labRunState,
  parseDockerUptime
} from "./labsOverview";
import { buildLabThumbnail, circleThumbnail, LAB_THUMBNAIL_HEIGHT, LAB_THUMBNAIL_WIDTH } from "./labThumbnail";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("a node is ready once it runs and its health check passed", () => {
  assert.equal(isContainerReady({ state: "running", status: "Up 5 minutes" }), true);
  assert.equal(isContainerReady({ state: "running", status: "Up 5 minutes (healthy)" }), true);
  assert.equal(isContainerReady({ state: "running", status: "Up 3 seconds (health: starting)" }), false);
  assert.equal(isContainerReady({ state: "running", status: "Up 2 hours (unhealthy)" }), false);
  assert.equal(isContainerReady({ state: "exited", status: "Exited (0) 1 minute ago" }), false);
  assert.equal(labNodeRunState({ state: "running", status: "Up 3 seconds (health: starting)" }), "starting");
  assert.equal(labNodeRunState({ state: "exited", status: "Exited (137) 1 minute ago" }), "down");
});

test("lab state follows how many of its containers run", () => {
  const up = { state: "running", status: "Up 1 minute" };
  const stopped = { state: "exited", status: "Exited (0) 2 minutes ago" };
  const crashed = { state: "exited", status: "Exited (1) 2 minutes ago" };
  assert.equal(labRunState([up, up]), "running");
  assert.equal(labRunState([up, stopped]), "partial");
  assert.equal(labRunState([stopped, stopped]), "stopped");
  assert.equal(labRunState([stopped, crashed]), "failed");
  assert.equal(labRunState([{ state: "dead", status: "Dead" }]), "failed");
  assert.equal(labRunState([]), "stopped");
});

test("Docker status text yields the uptime and the unit it is rounded to", () => {
  assert.deepEqual(parseDockerUptime("Up 5 minutes (healthy)"), { ms: 5 * MINUTE, precisionMs: MINUTE });
  assert.deepEqual(parseDockerUptime("Up About a minute"), { ms: MINUTE, precisionMs: MINUTE });
  assert.deepEqual(parseDockerUptime("Up About an hour"), { ms: HOUR, precisionMs: HOUR });
  assert.deepEqual(parseDockerUptime("Up 2 hours (Paused)"), { ms: 2 * HOUR, precisionMs: HOUR });
  assert.deepEqual(parseDockerUptime("Up 3 days"), { ms: 3 * DAY, precisionMs: DAY });
  assert.deepEqual(parseDockerUptime("Up Less than a second"), { ms: 0, precisionMs: 1000 });
  assert.deepEqual(parseDockerUptime("Up 1 second"), { ms: 1000, precisionMs: 1000 });
  assert.equal(parseDockerUptime("Exited (0) 3 minutes ago"), undefined);
  assert.equal(parseDockerUptime(""), undefined);
});

test("uptime is never shown finer than it is known", () => {
  assert.equal(formatLabUptime(2 * HOUR + 16 * MINUTE), "2 h 16 min");
  assert.equal(formatLabUptime(2 * HOUR + 16 * MINUTE, HOUR), "2 h");
  assert.equal(formatLabUptime(2 * HOUR), "2 h");
  assert.equal(formatLabUptime(16 * MINUTE + 30_000), "16 min");
  assert.equal(formatLabUptime(20_000, 1000), "<1 min");
  assert.equal(formatLabUptime(3 * DAY + 4 * HOUR, HOUR), "3 d 4 h");
  assert.equal(formatLabUptime(3 * DAY + 4 * HOUR, DAY), "3 d");
});

const YAML = `
name: demo
topology:
  nodes:
    srl1: { kind: nokia_srlinux }
    srl2: { kind: nokia_srlinux }
    client:
      kind: linux
  links:
    - endpoints: ["srl1:e1-1", "srl2:e1-1"]
    - endpoints: ["srl2:e1-1", "srl1:e1-1"]
    - endpoints:
        - { node: client, interface: eth1 }
        - { node: srl1, interface: e1-2 }
    - endpoints: ["client:eth2", "host:client-eth2"]
    - type: host
      endpoint: { node: client, interface: eth3 }
`;

test("thumbnails use saved positions and skip links to special endpoints", () => {
  const annotations = JSON.stringify({
    nodeAnnotations: [
      { id: "srl1", position: { x: 0, y: 0 } },
      { id: "srl2", position: { x: 400, y: 0 } },
      { id: "client", position: { x: 200, y: 200 } },
      { id: "not-in-yaml", position: { x: 9000, y: 9000 } }
    ]
  });
  const thumbnail = buildLabThumbnail(YAML, annotations);
  assert.ok(thumbnail);
  assert.deepEqual(thumbnail.nodes.map((node) => node.id), ["srl1", "srl2", "client"]);
  assert.deepEqual(thumbnail.links, [
    { source: "srl1", target: "srl2" },
    { source: "client", target: "srl1" }
  ]);
  const [srl1, srl2, client] = thumbnail.nodes;
  assert.equal(srl1.y, srl2.y);
  assert.ok(srl1.x < client.x && client.x < srl2.x);
  assert.ok(client.y > srl1.y);
  for (const node of thumbnail.nodes) {
    assert.ok(node.x >= 0 && node.x <= LAB_THUMBNAIL_WIDTH, `${node.id} x inside the frame`);
    assert.ok(node.y >= 0 && node.y <= LAB_THUMBNAIL_HEIGHT, `${node.id} y inside the frame`);
  }
});

test("thumbnails place nodes without saved positions and tolerate bad input", () => {
  const thumbnail = buildLabThumbnail(YAML, "not json");
  assert.ok(thumbnail);
  assert.equal(new Set(thumbnail.nodes.map((node) => `${node.x},${node.y}`)).size, 3);
  assert.equal(buildLabThumbnail("topology: {}"), undefined);
  assert.equal(buildLabThumbnail("topology: [unclosed"), undefined);
  const single = buildLabThumbnail("topology:\n  nodes:\n    one: {}\n");
  assert.equal(single?.nodes.length, 1);
  assert.equal(single.nodes[0].x, LAB_THUMBNAIL_WIDTH / 2);
  // The icon is centered with room for its name below.
  assert.ok(Math.abs(single.nodes[0].y - LAB_THUMBNAIL_HEIGHT / 2) < 10);
  assert.equal(circleThumbnail([])?.nodes.length, undefined);
  assert.equal(circleThumbnail(["a", "b", "c"])?.nodes.length, 3);
});

test("thumbnail nodes draw the icon the canvas picks, by annotation, role label, then kind", () => {
  const yaml = `
topology:
  defaults: { labels: { topoViewer-role: router } }
  kinds:
    linux: { labels: { topoViewer-role: server } }
  groups:
    spines: { labels: { topoViewer-role: spine } }
  nodes:
    r1: {}
    host1: { kind: linux }
    spine1: { kind: linux, group: spines }
    leaf1: { kind: linux, labels: { topoViewer-role: leaf } }
    br: { kind: bridge }
    custom: { kind: linux }
`;
  const annotations = JSON.stringify({ nodeAnnotations: [{ id: "custom", icon: "firewall", iconColor: "#ff0000" }] });
  const roles = Object.fromEntries(buildLabThumbnail(yaml, annotations)!.nodes.map((node) => [node.id, node.role]));
  assert.deepEqual(roles, { r1: "router", host1: "server", spine1: "spine", leaf1: "leaf", br: "router", custom: "firewall" });
  const bare = buildLabThumbnail("topology:\n  nodes:\n    a: {}\n    b: { kind: ovs-bridge }\n")!;
  assert.deepEqual(bare.nodes.map((node) => node.role), ["pe", "bridge"]);
  const custom = buildLabThumbnail(yaml, annotations)!.nodes.find((node) => node.id === "custom");
  assert.equal(custom?.iconColor, "#ff0000");
});

test("thumbnails show names for a few spread nodes and hide them when crowded", () => {
  const spread = JSON.stringify({
    nodeAnnotations: [
      { id: "srl1", position: { x: 0, y: 0 } },
      { id: "srl2", position: { x: 400, y: 0 } },
      { id: "client", position: { x: 200, y: 200 } }
    ]
  });
  const roomy = buildLabThumbnail(YAML, spread)!;
  assert.equal(roomy.showLabels, true);
  assert.ok(roomy.nodeSize >= 14 && roomy.nodeSize <= 28);
  const crowded = JSON.stringify({
    nodeAnnotations: [
      { id: "srl1", position: { x: 0, y: 0 } },
      { id: "srl2", position: { x: 30, y: 0 } },
      { id: "client", position: { x: 4000, y: 3000 } }
    ]
  });
  assert.equal(buildLabThumbnail(YAML, crowded)!.showLabels, false);
  const many = Array.from({ length: 80 }, (_, index) => `    n${index}: {}`).join("\n");
  const big = buildLabThumbnail(`topology:\n  nodes:\n${many}\n`)!;
  assert.equal(big.showLabels, false);
  assert.ok(big.nodeSize < 12);
  for (const node of big.nodes) {
    assert.ok(node.x >= 0 && node.x <= LAB_THUMBNAIL_WIDTH && node.y >= 0 && node.y <= LAB_THUMBNAIL_HEIGHT);
  }
});

test("thumbnails draw groups, shapes, text and placed network endpoints in the same frame", () => {
  const annotations = JSON.stringify({
    nodeAnnotations: [
      { id: "srl1", position: { x: 0, y: 0 } },
      { id: "srl2", position: { x: 400, y: 0 } },
      { id: "client", position: { x: 200, y: 200 } }
    ],
    networkNodeAnnotations: [
      { id: "host:client-eth2", type: "host", position: { x: 200, y: 400 } },
      { id: "mgmt-net:unused", type: "mgmt-net", position: { x: 9000, y: 9000 } }
    ],
    groupStyleAnnotations: [
      { id: "dc:1", name: "dc", level: "1", position: { x: -40, y: -40 }, width: 520, height: 140, backgroundOpacity: 30, borderStyle: "solid" }
    ],
    freeShapeAnnotations: [
      { id: "s1", shapeType: "circle", position: { x: 300, y: 250 }, width: 80, height: 80 },
      { id: "s2", shapeType: "line", position: { x: 0, y: 300 }, endPosition: { x: 100, y: 300 } }
    ],
    freeTextAnnotations: [{ id: "t1", text: "## **Fabric** notes\nsecond line", position: { x: -40, y: -90 }, fontSize: 20 }]
  });
  const thumbnail = buildLabThumbnail(YAML, annotations)!;
  assert.deepEqual(thumbnail.nodes.map((node) => node.id), ["srl1", "srl2", "client", "host:client-eth2"]);
  assert.equal(thumbnail.nodes[3].role, "cloud");
  assert.ok(thumbnail.links.some((link) => link.source === "client" && link.target === "host:client-eth2"));
  const [group] = thumbnail.groups;
  assert.equal(group.label, "dc");
  assert.equal(group.fillOpacity, 0.3);
  assert.equal(group.dashed, false);
  assert.ok(group.x < thumbnail.nodes[0].x && group.x + group.width > thumbnail.nodes[1].x);
  assert.deepEqual(thumbnail.shapes.map((shape) => shape.type), ["circle", "line"]);
  assert.equal(thumbnail.texts[0].text, "Fabric notes");
  assert.ok(thumbnail.texts[0].y >= 0);
  for (const box of [...thumbnail.groups, ...thumbnail.shapes.filter((shape) => shape.type !== "line")]) {
    assert.ok(box.x >= 0 && box.x + box.width <= LAB_THUMBNAIL_WIDTH + 0.5, "inside the frame horizontally");
    assert.ok(box.y >= 0 && box.y + box.height <= LAB_THUMBNAIL_HEIGHT + 0.5, "inside the frame vertically");
  }
});
