import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Edge, Node } from "@xyflow/react";

import type { FreeShapeAnnotation, GroupStyleAnnotation } from "../../../core/types/topology";

import { buildDrawioXml, type DrawioExportOptions } from "./drawioExport";

const ICON_SIZE = 40;
const PAGE_MARGIN = 40;

function topologyNode(id: string, x: number, y: number, data: Record<string, unknown> = {}): Node {
  return { id, type: "topology-node", position: { x, y }, data: { label: id, role: "pe", ...data } };
}

function link(id: string, source: string, target: string, data: Record<string, unknown> = {}): Edge {
  return {
    id,
    source,
    target,
    data: { sourceEndpoint: "e1-1", targetEndpoint: "e1-2", ...data }
  };
}

function group(id: string, x: number, y: number, extra: Partial<GroupStyleAnnotation> = {}) {
  return {
    id,
    name: id,
    level: "1",
    position: { x, y },
    width: 400,
    height: 300,
    ...extra
  } satisfies GroupStyleAnnotation;
}

function exportXml(options: Partial<DrawioExportOptions>): string {
  return buildDrawioXml({
    name: "lab",
    nodes: [],
    edges: [],
    includeEdgeLabels: true,
    ...options
  });
}

/** The opening tag of a cell, and what follows until the cell ends. */
function cellXml(xml: string, id: string): string {
  const start = xml.indexOf(`id="${id}"`);
  assert.ok(start >= 0, `cell ${id} exists`);
  const end = xml.indexOf("</mxCell>", start);
  return xml.slice(start, end);
}

function attribute(xml: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(xml)?.[1];
}

/** Style values, split as Draw.io splits them. */
function styleOf(cell: string): Record<string, string> {
  const style = attribute(cell, "style") ?? "";
  const entries = style.split(";").filter((entry) => entry.includes("="));
  return Object.fromEntries(
    entries.map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)])
  );
}

describe("buildDrawioXml", () => {
  it("draws a node as one movable cell with its icon embedded", () => {
    const xml = exportXml({
      nodes: [topologyNode("srl1", 100, 200, { kind: "nokia_srlinux", image: "srlinux:latest" })],
      renderOptions: { iconInk: "#000000" }
    });
    const cell = cellXml(xml, "node-srl1");
    const style = styleOf(cell);

    assert.equal(attribute(cell, "label"), "srl1");
    assert.equal(attribute(cell, "kind"), "nokia_srlinux");
    assert.equal(attribute(cell, "image"), "srlinux:latest");
    assert.equal(style.shape, "image");
    assert.ok(style.image.startsWith("data:image/svg+xml,"));
    // `;base64` would end the style entry early, so Draw.io's short form has none.
    assert.ok(!style.image.includes(";"));
    assert.ok(atob(style.image.split(",")[1]).startsWith("<svg"));
    assert.equal(attribute(cell, "width"), String(ICON_SIZE));
  });

  it("starts the page at a margin, wherever the lab sits on the canvas", () => {
    const xml = exportXml({ nodes: [topologyNode("a", -500, 900), topologyNode("b", 100, 1000)] });
    assert.equal(attribute(cellXml(xml, "node-a"), "x"), String(PAGE_MARGIN));
    assert.equal(attribute(cellXml(xml, "node-a"), "y"), String(PAGE_MARGIN));
    assert.equal(attribute(cellXml(xml, "node-b"), "x"), String(PAGE_MARGIN + 600));
  });

  it("connects links to their nodes, so they follow when a node moves", () => {
    const xml = exportXml({
      nodes: [topologyNode("a", 0, 0), topologyNode("b", 300, 0)],
      edges: [link("l1", "a", "b")]
    });
    const cell = cellXml(xml, "link-l1");
    assert.equal(attribute(cell, "edge"), "1");
    assert.equal(attribute(cell, "source"), "node-a");
    assert.equal(attribute(cell, "target"), "node-b");
    assert.ok(!cell.includes("<Array"), "a single link has no fixed points");
    assert.equal(styleOf(cell).exitX, undefined, "its ends meet the node outline wherever it moves");
  });

  it("bends parallel links around a point, and keeps the middle one straight", () => {
    const xml = exportXml({
      nodes: [topologyNode("a", 0, 0), topologyNode("b", 300, 0)],
      edges: [link("l1", "a", "b"), link("l2", "a", "b"), link("l3", "a", "b")]
    });
    const first = cellXml(xml, "link-l1");
    const middle = cellXml(xml, "link-l2");
    const last = cellXml(xml, "link-l3");
    assert.equal(styleOf(first).curved, "1");
    assert.ok(first.includes('<Array as="points">'));
    const yOf = (cell: string) => Number(/<mxPoint x="[^"]*" y="([^"]*)"\/>/.exec(cell)?.[1]);
    assert.notEqual(yOf(first), yOf(last));
    assert.equal((yOf(first) + yOf(last)) / 2, yOf(middle), "the bends mirror around the middle link");
  });

  it("attaches endpoint labels to their link", () => {
    const nodes = [topologyNode("a", 0, 0), topologyNode("b", 300, 0)];
    const edges = [link("l1", "a", "b")];
    const xml = exportXml({ nodes, edges });
    const source = cellXml(xml, "link-l1-label-0");
    const target = cellXml(xml, "link-l1-label-1");
    assert.equal(attribute(source, "parent"), "link-l1");
    assert.equal(attribute(source, "value"), "e1-1");
    assert.equal(attribute(target, "value"), "e1-2");
    assert.equal(attribute(source, "relative"), "1");
    assert.ok(Number(attribute(source, "x")) < 0, "the source label sits toward the start");
    assert.ok(Number(attribute(target, "x")) > 0, "the target label sits toward the end");

    const withoutLabels = exportXml({ nodes, edges, includeEdgeLabels: false });
    assert.ok(!withoutLabels.includes("link-l1-label"));
  });

  it("pins telemetry-style links to the interface bubbles", () => {
    const xml = exportXml({
      nodes: [topologyNode("a", 0, 0), topologyNode("b", 300, 0)],
      edges: [link("l1", "a", "b")],
      renderOptions: { telemetryStyleLabels: true }
    });
    const style = styleOf(cellXml(xml, "link-l1"));
    assert.equal(style.exitPerimeter, "0");
    assert.equal(style.entryPerimeter, "0");
    assert.ok(Number(style.exitX) > 1, "the link leaves from the bubble right of the node");
    assert.ok(Number(style.entryX) < 0, "and arrives at the bubble left of the node");
    assert.ok((attribute(cellXml(xml, "link-l1-label-0"), "style") ?? "").startsWith("ellipse;"));
  });

  it("gives a self link two bend points on the node's side", () => {
    const xml = exportXml({
      nodes: [topologyNode("a", 0, 0)],
      edges: [link("l1", "a", "a")]
    });
    const cell = cellXml(xml, "link-l1");
    assert.equal(attribute(cell, "source"), "node-a");
    assert.equal(attribute(cell, "target"), "node-a");
    assert.equal(styleOf(cell).exitX, "1");
    assert.equal(cell.match(/<mxPoint /g)?.length, 2);
  });

  it("nests group members, with coordinates relative to the group", () => {
    const outer = group("outer", 0, 0);
    const inner = group("inner", 50, 60, { parentId: "outer", width: 100, height: 100 });
    const xml = exportXml({
      nodes: [topologyNode("a", 110, 130, { groupId: "inner" }), topologyNode("b", 500, 0)],
      annotations: { groups: [outer, inner], textAnnotations: [], shapeAnnotations: [] }
    });
    assert.equal(styleOf(cellXml(xml, "group-outer")).container, "1");
    assert.equal(attribute(cellXml(xml, "group-outer"), "parent"), "1");
    assert.equal(attribute(cellXml(xml, "group-inner"), "parent"), "group-outer");
    assert.equal(attribute(cellXml(xml, "group-inner"), "x"), "50");
    assert.equal(attribute(cellXml(xml, "node-a"), "parent"), "group-inner");
    assert.equal(attribute(cellXml(xml, "node-a"), "x"), "60");
    assert.equal(attribute(cellXml(xml, "node-a"), "y"), "70");
    assert.equal(attribute(cellXml(xml, "node-b"), "parent"), "1");
  });

  it("puts a link in the innermost group holding both ends", () => {
    const annotations = {
      groups: [group("g1", 100, 100), group("g2", 600, 100)],
      textAnnotations: [],
      shapeAnnotations: []
    };
    const nodes = [
      topologyNode("a", 120, 120, { groupId: "g1" }),
      topologyNode("b", 220, 120, { groupId: "g1" }),
      topologyNode("c", 620, 120, { groupId: "g2" })
    ];
    const xml = exportXml({
      nodes,
      annotations,
      edges: [link("inside", "a", "b"), link("across", "b", "c")]
    });
    assert.equal(attribute(cellXml(xml, "link-inside"), "parent"), "group-g1");
    assert.equal(attribute(cellXml(xml, "link-across"), "parent"), "1");
  });

  it("moves a group from a parent cycle to the root instead of losing it", () => {
    const xml = exportXml({
      annotations: {
        groups: [group("a", 0, 0, { parentId: "b" }), group("b", 10, 10, { parentId: "a" })],
        textAnnotations: [],
        shapeAnnotations: []
      }
    });
    assert.equal(xml.match(/id="group-a"/g)?.length, 1);
    assert.equal(xml.match(/id="group-b"/g)?.length, 1);
    assert.ok(xml.includes('parent="1"'));
  });

  it("does not duplicate a group that names itself as parent", () => {
    const xml = exportXml({
      annotations: {
        groups: [group("a", 0, 0, { parentId: "a" })],
        textAnnotations: [],
        shapeAnnotations: []
      }
    });
    assert.equal(xml.match(/id="group-a"/g)?.length, 1);
    assert.equal(attribute(cellXml(xml, "group-a"), "parent"), "1");
  });

  it("draws a line as a free connector with its arrows", () => {
    const shape: FreeShapeAnnotation = {
      id: "line",
      shapeType: "line",
      position: { x: 0, y: 0 },
      endPosition: { x: 100, y: 50 },
      lineEndArrow: true,
      lineArrowSize: 12,
      borderStyle: "dashed"
    };
    const xml = exportXml({
      annotations: { groups: [], textAnnotations: [], shapeAnnotations: [shape] }
    });
    const cell = cellXml(xml, "shape-line");
    const style = styleOf(cell);
    assert.equal(attribute(cell, "edge"), "1");
    assert.equal(style.startArrow, "none");
    assert.equal(style.endArrow, "block");
    assert.equal(style.endSize, "12");
    assert.equal(style.dashPattern, "8 4");
    assert.ok(cell.includes('as="sourcePoint"'));
    assert.ok(cell.includes('as="targetPoint"'));
  });

  it("leaves groups, shapes and text out when annotations are off", () => {
    const xml = exportXml({ nodes: [topologyNode("a", 0, 0, { groupId: "g1" })] });
    assert.equal(attribute(cellXml(xml, "node-a"), "parent"), "1");
    assert.ok(!xml.includes("group-"));
  });

  it("stacks a group above a shape of the same z, so the shape does not cover its members", () => {
    const shape: FreeShapeAnnotation = {
      id: "s1",
      shapeType: "rectangle",
      position: { x: 0, y: 0 },
      width: 50,
      height: 50
    };
    const xml = exportXml({
      annotations: { groups: [group("g1", 0, 0)], textAnnotations: [], shapeAnnotations: [shape] }
    });
    assert.ok(xml.indexOf('id="shape-s1"') < xml.indexOf('id="group-g1"'));
  });

  it("splits CSS colors into what Draw.io takes", () => {
    const shape = (id: string, fillColor: string): FreeShapeAnnotation => ({
      id,
      shapeType: "rectangle",
      position: { x: 0, y: 0 },
      fillColor,
      fillOpacity: 0.25,
      borderColor: "rgb(10, 20, 30)"
    });
    const xml = exportXml({
      annotations: {
        groups: [group("clear", 0, 0, { backgroundColor: "transparent" })],
        textAnnotations: [],
        shapeAnnotations: [shape("hex", "#ff0000"), shape("short", "#f00")]
      }
    });
    const hex = styleOf(cellXml(xml, "shape-hex"));
    assert.equal(hex.fillColor, "#ff0000");
    assert.equal(hex.fillOpacity, "25");
    assert.equal(hex.strokeColor, "#0a141e");
    assert.equal(styleOf(cellXml(xml, "group-clear")).fillColor, "none");
  });

  it("flattens a translucent name background onto the page", () => {
    const nodes = [topologyNode("a", 0, 0)];
    const onWhite = exportXml({ nodes, background: "#ffffff" });
    // rgba(0, 0, 0, 0.7) over white
    assert.equal(styleOf(cellXml(onWhite, "node-a")).labelBackgroundColor, "#4d4d4d");
    assert.ok(onWhite.includes('background="#ffffff"'));
    assert.ok(onWhite.includes('adaptiveColors="none"'));
  });

  it("escapes names for both the XML and the HTML parser", () => {
    const xml = exportXml({
      name: 'a"<b>&lab',
      nodes: [topologyNode("x", 0, 0, { label: "<img src=x>&" })],
      annotations: {
        groups: [group("g", 0, 0, { name: "Outer <&> group" })],
        textAnnotations: [],
        shapeAnnotations: []
      }
    });
    assert.ok(xml.includes('name="a&quot;&lt;b&gt;&amp;lab"'));
    assert.equal(
      attribute(cellXml(xml, "node-x"), "label"),
      "&amp;lt;img src=x&amp;gt;&amp;amp;"
    );
    assert.equal(
      attribute(cellXml(xml, "group-g"), "value"),
      "Outer &amp;lt;&amp;amp;&amp;gt; group"
    );
  });

  it("keeps a custom icon's data, whichever way it is encoded", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100%"><title>é</title></svg>';
    const icons = new Map([
      ["png", "data:image/png;base64,iVBORw0KGgo="],
      ["utf8", `data:image/svg+xml;utf8,${svg}`],
      ["percent", `data:image/svg+xml,${encodeURIComponent(svg)}`],
      ["mixed", `data:image/svg+xml;utf8,${svg.replace("<title>", '<title id="%23t">')}`]
    ]);
    const xml = exportXml({
      nodes: [
        topologyNode("a", 0, 0, { role: "png" }),
        topologyNode("b", 100, 0, { role: "utf8" }),
        topologyNode("c", 200, 0, { role: "percent" }),
        topologyNode("d", 300, 0, { role: "mixed" })
      ],
      customIcons: icons
    });
    const imageOf = (id: string) => styleOf(cellXml(xml, id)).image;
    const decoded = (image: string) =>
      new TextDecoder().decode(
        Uint8Array.from(atob(image.split(",")[1]), (char) => char.charCodeAt(0))
      );
    assert.equal(imageOf("node-a"), "data:image/png,iVBORw0KGgo=");
    assert.equal(decoded(imageOf("node-b")), svg);
    assert.equal(decoded(imageOf("node-c")), svg);
    // Like a browser: %23 is decoded, while the % of 100% stays.
    assert.equal(decoded(imageOf("node-d")), svg.replace("<title>", '<title id="#t">'));
  });

  it("turns only the image of a node with a direction, not its label", () => {
    const xml = exportXml({ nodes: [topologyNode("a", 0, 0, { direction: "down" })] });
    const style = styleOf(cellXml(xml, "node-a"));
    assert.equal(style.rotation, undefined);
    assert.ok(atob(style.image.split(",")[1]).includes("rotate(90"));
  });

  it("puts a boxed node's icon and name in one box, with the name shortened like the canvas", () => {
    const xml = exportXml({
      nodes: [topologyNode("a-very-long-node-name-that-goes-on", 0, 0)],
      renderOptions: { nodeStyle: "boxed", nodeIconSize: ICON_SIZE }
    });
    const cell = cellXml(xml, "node-a-very-long-node-name-that-goes-on");
    const style = styleOf(cell);
    assert.ok((attribute(cell, "style") ?? "").startsWith("shape=label;"));
    assert.equal(style.imageWidth, String(ICON_SIZE));
    assert.equal(attribute(cell, "label")?.includes("…"), true);
    assert.equal(attribute(cell, "name"), "a-very-long-node-name-that-goes-on");
    assert.equal(attribute(cell, "width"), attribute(cell, "height"));
    assert.ok(Number(attribute(cell, "width")) > ICON_SIZE);
  });

  it("skips annotation nodes on the canvas", () => {
    const xml = exportXml({
      nodes: [topologyNode("a", 0, 0), { ...topologyNode("note", 0, 0), type: "free-text-annotation" }],
      annotationNodeTypes: new Set(["free-text-annotation"])
    });
    assert.ok(xml.includes('id="node-a"'));
    assert.ok(!xml.includes('id="node-note"'));
  });
});
