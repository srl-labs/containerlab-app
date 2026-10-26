import { parse } from "yaml";

/** The frame thumbnails are drawn in; the SVG scales it to the card, about one unit per pixel. */
export const LAB_THUMBNAIL_WIDTH = 288;
export const LAB_THUMBNAIL_HEIGHT = 162;
const PADDING = 12;
const MAX_NODES = 200;
/** The canvas's default node size. */
const CANVAS_NODE_SIZE = 40;
/** Room the canvas gives a node's name below its icon. */
const CANVAS_LABEL_HEIGHT = 16;
// A small lab is not blown up past a comfortable icon size.
const MAX_NODE_SIZE = 28;
const MIN_NODE_SIZE = 5;
/** Names show when icons are at least this big, there are few nodes and the names do not collide. */
const LABEL_MIN_NODE_SIZE = 12;
const LABEL_MAX_NODES = 24;
export const LAB_THUMBNAIL_LABEL_SIZE = 8;
const LABEL_MAX_CHARS = 14;
const MIN_TEXT_SIZE = 5;
const MAX_TEXT_SIZE = 16;
const GROUP_LABEL_SIZE = 7;
const BRIDGE_KINDS = new Set(["bridge", "ovs-bridge"]);
const NETWORK_ROLE = "cloud";

export interface LabThumbnailNode {
  id: string;
  /** Center. */
  x: number;
  y: number;
  /** The icon name the canvas draws, e.g. "router" or "pe". */
  role: string;
  iconColor?: string;
  label: string;
}

interface LabThumbnailBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LabThumbnailGroup extends LabThumbnailBox {
  label?: string;
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  dashed: boolean;
  radius: number;
}

interface LabThumbnailShape extends LabThumbnailBox {
  type: "rectangle" | "circle" | "line";
  /** For lines: from (x, y) to (x2, y2). */
  x2?: number;
  y2?: number;
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  dashed: boolean;
  radius: number;
}

interface LabThumbnailText {
  x: number;
  /** Top of the first line. */
  y: number;
  text: string;
  fontSize: number;
  color?: string;
}

export interface LabThumbnail {
  /** Icon size in frame units. */
  nodeSize: number;
  showLabels: boolean;
  nodes: LabThumbnailNode[];
  links: Array<{ source: string; target: string }>;
  groups: LabThumbnailGroup[];
  shapes: LabThumbnailShape[];
  texts: LabThumbnailText[];
}

type Point = { x: number; y: number };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type Record_ = Record<string, unknown>;

function record(value: unknown): Record_ {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record_ : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function finitePoint(value: unknown): Point | undefined {
  const { x, y } = record(value);
  const px = finiteNumber(x);
  const py = finiteNumber(y);
  return px !== undefined && py !== undefined ? { x: px, y: py } : undefined;
}

/** Saved canvas positions (top left), then the legacy graph-posX/graph-posY labels. */
function savedPositions(nodes: Record_, annotations: Record_): Map<string, Point> {
  const positions = new Map<string, Point>();
  for (const [id, node] of Object.entries(nodes)) {
    const labels = record(record(node).labels);
    const point = finitePoint({ x: labels["graph-posX"], y: labels["graph-posY"] });
    if (point) positions.set(id, point);
  }
  for (const entry of list(annotations.nodeAnnotations)) {
    const { id, position } = record(entry);
    const point = finitePoint(position);
    if (typeof id === "string" && id in nodes && point) positions.set(id, point);
  }
  return positions;
}

/** Labels and kind a node inherits from the topology's defaults, kinds and groups, as containerlab merges them. */
function inherited(topology: Record_, node: Record_): { kind?: string; labels: Record_ } {
  const defaults = record(topology.defaults);
  const group = record(record(topology.groups)[String(node.group ?? "")]);
  const kind = nonEmptyString(node.kind) ?? nonEmptyString(group.kind) ?? nonEmptyString(defaults.kind);
  const kindDefaults = kind === undefined ? {} : record(record(topology.kinds)[kind]);
  return {
    kind,
    labels: { ...record(defaults.labels), ...record(kindDefaults.labels), ...record(group.labels), ...record(node.labels) }
  };
}

/** The icon the canvas draws for a node: its annotation, its role label, then by kind. */
function nodeRole(topology: Record_, node: Record_, annotation: Record_): string {
  const { kind, labels } = inherited(topology, node);
  return nonEmptyString(annotation.icon) ??
    nonEmptyString(labels["topoViewer-role"]) ??
    (kind !== undefined && BRIDGE_KINDS.has(kind) ? "bridge" : "pe");
}

/** The drawing's node ids an endpoint can stand for: the whole endpoint (macvlan:, vxlan:), then node or host:iface. */
function endpointCandidates(value: unknown): string[] {
  if (typeof value === "string") {
    const separator = value.indexOf(":");
    if (separator <= 0) return [];
    return [value, value.slice(0, separator)];
  }
  const { node, interface: iface } = record(value);
  if (typeof node !== "string") return [];
  return typeof iface === "string" ? [`${node}:${iface}`, node] : [node];
}

function resolveEndpoint(value: unknown, nodeIds: ReadonlySet<string>): string | undefined {
  return endpointCandidates(value).find((candidate) => nodeIds.has(candidate));
}

function linksBetween(links: unknown, nodeIds: ReadonlySet<string>): LabThumbnail["links"] {
  const result: LabThumbnail["links"] = [];
  const seen = new Set<string>();
  for (const link of list(links)) {
    const endpoints = record(link).endpoints;
    if (!Array.isArray(endpoints) || endpoints.length < 2) continue;
    const source = resolveEndpoint(endpoints[0], nodeIds);
    const target = resolveEndpoint(endpoints[1], nodeIds);
    // Host, management and other special endpoints draw only when the canvas placed them.
    if (source === undefined || target === undefined || source === target) continue;
    const key = source < target ? `${source}\n${target}` : `${target}\n${source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ source, target });
  }
  return result;
}

/** Nodes without a saved position go on a circle around the positioned ones, or form one. */
function placeMissing(ids: string[], positions: Map<string, Point>): void {
  const missing = ids.filter((id) => !positions.has(id));
  if (missing.length === 0) return;
  const placed = [...positions.values()];
  const center = placed.length > 0
    ? { x: placed.reduce((sum, p) => sum + p.x, 0) / placed.length, y: placed.reduce((sum, p) => sum + p.y, 0) / placed.length }
    : { x: 0, y: 0 };
  const spread = placed.length > 0
    ? Math.max(...placed.map((p) => Math.hypot(p.x - center.x, p.y - center.y)), 120) * 1.25
    : Math.max(120, missing.length * 30);
  missing.forEach((id, index) => {
    const angle = (2 * Math.PI * index) / missing.length - Math.PI / 2;
    positions.set(id, { x: center.x + spread * Math.cos(angle), y: center.y + spread * Math.sin(angle) });
  });
}

function extend(bounds: Bounds, box: LabThumbnailBox): void {
  bounds.minX = Math.min(bounds.minX, box.x);
  bounds.minY = Math.min(bounds.minY, box.y);
  bounds.maxX = Math.max(bounds.maxX, box.x + box.width);
  bounds.maxY = Math.max(bounds.maxY, box.y + box.height);
}

const round = (value: number) => Math.round(value * 10) / 10;

function boxStyle(entry: Record_, defaultDashed: boolean) {
  const borderStyle = entry.borderStyle;
  return {
    fill: nonEmptyString(entry.backgroundColor) ?? nonEmptyString(entry.fillColor),
    fillOpacity: finiteNumber(entry.backgroundOpacity) ?? finiteNumber(entry.fillOpacity),
    stroke: nonEmptyString(entry.borderColor),
    dashed: borderStyle === undefined ? defaultDashed : borderStyle === "dashed" || borderStyle === "dotted"
  };
}

function readGroups(annotations: Record_): LabThumbnailGroup[] {
  const groups: LabThumbnailGroup[] = [];
  for (const entry of list(annotations.groupStyleAnnotations).map(record)) {
    const position = finitePoint(entry.position);
    const width = finiteNumber(entry.width);
    const height = finiteNumber(entry.height);
    if (!position || width === undefined || height === undefined || width <= 0 || height <= 0) continue;
    const opacity = finiteNumber(entry.backgroundOpacity);
    groups.push({
      ...position, width, height,
      label: nonEmptyString(entry.name),
      ...boxStyle(entry, true),
      // Group fills have percent opacities.
      fillOpacity: opacity === undefined ? undefined : opacity / 100,
      radius: finiteNumber(entry.borderRadius) ?? 8
    });
  }
  return groups;
}

function readShapes(annotations: Record_): LabThumbnailShape[] {
  const shapes: LabThumbnailShape[] = [];
  for (const entry of list(annotations.freeShapeAnnotations).map(record)) {
    const position = finitePoint(entry.position);
    const type = entry.shapeType;
    if (!position || (type !== "rectangle" && type !== "circle" && type !== "line")) continue;
    const style = boxStyle(entry, false);
    if (type === "line") {
      const end = finitePoint(entry.endPosition) ?? { x: position.x + 150, y: position.y };
      shapes.push({
        type, x: position.x, y: position.y, x2: end.x, y2: end.y,
        width: 0, height: 0, ...style, fill: undefined, radius: 0
      });
      continue;
    }
    shapes.push({
      type, ...position,
      width: finiteNumber(entry.width) ?? 100,
      height: finiteNumber(entry.height) ?? 100,
      ...style,
      radius: finiteNumber(entry.cornerRadius) ?? 0
    });
  }
  return shapes;
}

/** The first line of a text annotation, without Markdown marks. */
function plainText(value: string): string {
  const line = value.split("\n").map((part) => part.trim()).find((part) => part.length > 0) ?? "";
  return line.replace(/^#+\s*/, "").replace(/[*_`~]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").slice(0, 48);
}

function readTexts(annotations: Record_): Array<LabThumbnailText & { width: number; height: number }> {
  const texts: Array<LabThumbnailText & { width: number; height: number }> = [];
  for (const entry of list(annotations.freeTextAnnotations).map(record)) {
    const position = finitePoint(entry.position);
    const text = typeof entry.text === "string" ? plainText(entry.text) : "";
    if (!position || !text) continue;
    const fontSize = finiteNumber(entry.fontSize) ?? 14;
    texts.push({
      ...position, text, fontSize,
      color: nonEmptyString(entry.fontColor),
      width: text.length * fontSize * 0.55,
      height: fontSize * 1.3
    });
  }
  return texts;
}

/** Whether node names under the icons would run into each other. */
function labelsCollide(nodes: LabThumbnailNode[], nodeSize: number): boolean {
  const width = (node: LabThumbnailNode) => Math.min(node.label.length, LABEL_MAX_CHARS) * LAB_THUMBNAIL_LABEL_SIZE * 0.6 + 4;
  const height = LAB_THUMBNAIL_LABEL_SIZE + 3;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const [a, b] = [nodes[i], nodes[j]];
      const apart = Math.abs(a.x - b.x) >= (width(a) + width(b)) / 2;
      const labelsApart = Math.abs(a.y - b.y) >= height;
      // A name also must not run into the icon below it.
      const clearOfIcon = Math.abs(a.y - b.y) >= nodeSize / 2 + height || Math.abs(a.x - b.x) >= nodeSize / 2 + width(a) / 2;
      if (!apart && (!labelsApart || !clearOfIcon)) return true;
    }
  }
  return false;
}

interface DrawingInput {
  nodes: Array<Omit<LabThumbnailNode, "x" | "y"> & Point>;
  links: LabThumbnail["links"];
  groups: LabThumbnailGroup[];
  shapes: LabThumbnailShape[];
  texts: Array<LabThumbnailText & { width: number; height: number }>;
  canvasNodeSize: number;
}

/** Fits the drawing into the thumbnail frame, keeping its aspect ratio, as the canvas fits its view. */
function fitToFrame(input: DrawingInput): LabThumbnail {
  const half = input.canvasNodeSize / 2;
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const node of input.nodes) {
    extend(bounds, { x: node.x - half, y: node.y - half, width: 2 * half, height: 2 * half + CANVAS_LABEL_HEIGHT });
  }
  for (const group of input.groups) extend(bounds, group);
  for (const shape of input.shapes) {
    if (shape.type !== "line") extend(bounds, shape);
    else {
      extend(bounds, { x: Math.min(shape.x, shape.x2!), y: Math.min(shape.y, shape.y2!), width: Math.abs(shape.x2! - shape.x), height: Math.abs(shape.y2! - shape.y) });
    }
  }
  for (const text of input.texts) extend(bounds, text);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const innerWidth = LAB_THUMBNAIL_WIDTH - 2 * PADDING;
  const innerHeight = LAB_THUMBNAIL_HEIGHT - 2 * PADDING;
  const scale = Math.min(
    width > 0 ? innerWidth / width : Infinity,
    height > 0 ? innerHeight / height : Infinity,
    MAX_NODE_SIZE / input.canvasNodeSize
  );
  const offsetX = (LAB_THUMBNAIL_WIDTH - width * scale) / 2 - bounds.minX * scale;
  const offsetY = (LAB_THUMBNAIL_HEIGHT - height * scale) / 2 - bounds.minY * scale;
  const x = (value: number) => round(offsetX + value * scale);
  const y = (value: number) => round(offsetY + value * scale);
  const size = (value: number) => round(value * scale);

  const nodeSize = round(Math.min(MAX_NODE_SIZE, Math.max(MIN_NODE_SIZE, input.canvasNodeSize * scale)));
  const nodes = input.nodes.map((node) => ({ ...node, x: x(node.x), y: y(node.y) }));
  const showLabels = nodeSize >= LABEL_MIN_NODE_SIZE && nodes.length <= LABEL_MAX_NODES && !labelsCollide(nodes, nodeSize);
  const groups = input.groups.map((group) => {
    const scaled = { ...group, x: x(group.x), y: y(group.y), width: size(group.width), height: size(group.height), radius: size(group.radius) };
    // A label needs room inside the box.
    return scaled.height >= 3 * GROUP_LABEL_SIZE && scaled.width >= 6 * GROUP_LABEL_SIZE ? scaled : { ...scaled, label: undefined };
  });
  const shapes = input.shapes.map((shape) => ({
    ...shape,
    x: x(shape.x), y: y(shape.y), width: size(shape.width), height: size(shape.height), radius: size(shape.radius),
    ...(shape.type === "line" ? { x2: x(shape.x2!), y2: y(shape.y2!) } : {})
  }));
  const texts = input.texts
    .map(({ width: _width, height: _height, ...text }) => ({ ...text, x: x(text.x), y: y(text.y), fontSize: size(text.fontSize) }))
    .filter((text) => text.fontSize >= MIN_TEXT_SIZE)
    .map((text) => ({ ...text, fontSize: Math.min(MAX_TEXT_SIZE, text.fontSize) }));
  return { nodeSize, showLabels, nodes, links: input.links, groups, shapes, texts };
}

function parseJson(text: string | undefined): Record_ {
  try {
    return record(text !== undefined && text.trim() !== "" ? JSON.parse(text) : undefined);
  } catch {
    return {};
  }
}

/** Network endpoints (host, mgmt-net, macvlan, vxlan) the canvas placed, drawn as clouds. */
function networkNodes(annotations: Record_): DrawingInput["nodes"] {
  const nodes: DrawingInput["nodes"] = [];
  for (const entry of list(annotations.networkNodeAnnotations).map(record)) {
    const id = nonEmptyString(entry.id);
    const position = finitePoint(entry.position);
    if (id === undefined || !position) continue;
    nodes.push({ id, ...position, role: NETWORK_ROLE, label: nonEmptyString(entry.label) ?? id });
  }
  return nodes;
}

function canvasNodeSizeOf(annotations: Record_): number {
  const value = finiteNumber(record(annotations.viewerSettings).telemetryNodeSizePx);
  return value === undefined ? CANVAS_NODE_SIZE : Math.max(12, Math.min(240, value));
}

/**
 * A miniature of a topology from its YAML and annotations: node icons at their saved
 * positions, links, groups, shapes and text, without the editor's graph model.
 * Undefined when the file has no nodes to draw.
 */
export function buildLabThumbnail(yaml: string, annotations?: string): LabThumbnail | undefined {
  let topology: Record_;
  try {
    topology = record(record(parse(yaml, { maxAliasCount: 100 })).topology);
  } catch {
    return undefined;
  }
  const yamlNodes = record(topology.nodes);
  const ids = Object.keys(yamlNodes).slice(0, MAX_NODES);
  if (ids.length === 0) return undefined;
  const data = parseJson(annotations);
  const canvasNodeSize = canvasNodeSizeOf(data);
  const nodeAnnotations = new Map<string, Record_>();
  for (const entry of list(data.nodeAnnotations).map(record)) {
    if (typeof entry.id === "string") nodeAnnotations.set(entry.id, entry);
  }
  const positions = savedPositions(yamlNodes, data);
  placeMissing(ids, positions);
  const half = canvasNodeSize / 2;
  const nodes: DrawingInput["nodes"] = ids.map((id) => {
    const annotation = nodeAnnotations.get(id) ?? {};
    const position = positions.get(id)!;
    const iconColor = nonEmptyString(annotation.iconColor);
    return {
      id,
      x: position.x + half,
      y: position.y + half,
      role: nodeRole(topology, record(yamlNodes[id]), annotation),
      ...(iconColor !== undefined ? { iconColor } : {}),
      label: id
    };
  });
  const yamlIds = new Set(ids);
  for (const network of networkNodes(data)) {
    if (!yamlIds.has(network.id)) nodes.push({ ...network, x: network.x + half, y: network.y + half });
  }
  const links = linksBetween(topology.links, new Set(nodes.map((node) => node.id)));
  // Network endpoints no link uses any more are left over from earlier edits.
  const linked = new Set(links.flatMap((link) => [link.source, link.target]));
  const drawn = nodes.filter((node) => yamlIds.has(node.id) || linked.has(node.id));
  return fitToFrame({
    nodes: drawn,
    links,
    groups: readGroups(data),
    shapes: readShapes(data),
    texts: readTexts(data),
    canvasNodeSize
  });
}

/** Running nodes on a circle, for labs without a readable topology file. */
export function circleThumbnail(nodeIds: string[]): LabThumbnail | undefined {
  const ids = nodeIds.slice(0, MAX_NODES);
  if (ids.length === 0) return undefined;
  const positions = new Map<string, Point>();
  placeMissing(ids, positions);
  return fitToFrame({
    nodes: ids.map((id) => ({ id, ...positions.get(id)!, role: "pe", label: id })),
    links: [],
    groups: [],
    shapes: [],
    texts: [],
    canvasNodeSize: CANVAS_NODE_SIZE
  });
}
