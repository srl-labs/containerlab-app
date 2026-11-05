/** Where a fabric's drawing puts everything: a row per tier, clients under the nodes they hang off. */
import { natural } from "./fabricFormat";
import type { FabricAttachedClient, FabricTopology } from "./fabricTypes";

export interface FabricPoint {
  x: number;
  y: number;
}

const TIERS = ["core", "gateway", "spine", "leaf", "unclassified"];

export const NODE_WIDTH = 164;
const BASE_NODE_HEIGHT = 54;
const LINE_HEIGHT = 14;
export const CLIENT_WIDTH = 124;
export const CLIENT_HEIGHT = 30;
const NODE_GAP = 28;
const CLIENT_GAP = 14;
const ROW_HEIGHT = 168;
const PADDING = 32;
const LABEL_WIDTH = 72;
/** Room above the first row: cables along a row arc upwards. */
const ARC_ROOM = 44;
const COMPONENT_TITLE = 36;

interface FabricTopologyLabel {
  key: string;
  text: string;
  x: number;
  y: number;
}

export interface FabricTopologyLayout {
  nodes: Map<string, FabricPoint>;
  clients: Map<string, FabricPoint>;
  labels: FabricTopologyLabel[];
  titles: Array<{ name: string; y: number }>;
  nodeHeight: number;
  width: number;
  height: number;
}

function rowWidth(count: number, width: number, gap: number): number {
  return count * width + Math.max(0, count - 1) * gap;
}

interface PlacedClient {
  client: FabricAttachedClient;
  want: number;
}

/** Each client at the mean of its nodes, pushed apart where they would collide. */
function placeClients(own: readonly PlacedClient[], y: number): Map<string, FabricPoint> {
  const spacing = CLIENT_WIDTH + CLIENT_GAP;
  const xs: number[] = [];
  for (const { want } of own) {
    const previous = xs[xs.length - 1];
    xs.push(previous === undefined ? want : Math.max(want, previous + spacing));
  }
  const shift = own.length ? own.reduce((sum, item, index) => sum + ((xs[index] ?? 0) - item.want), 0) / own.length : 0;
  return new Map(own.map(({ client }, index) => [client.id, { x: (xs[index] ?? 0) - shift, y }]));
}

function nodeHeightOf(graph: FabricTopology): number {
  const lines = Number(graph.nodes.some((node) => node.asn !== null && node.asn !== undefined)) +
    Number(graph.nodes.some((node) => Boolean(node.ipv6)));
  return BASE_NODE_HEIGHT + LINE_HEIGHT * lines;
}

/** One block per component of the fabric, stacked; clients are left out unless shown. */
export function layoutTopology(graph: FabricTopology, showClients: boolean): FabricTopologyLayout {
  const nodeHeight = nodeHeightOf(graph);
  const tierOf = new Map(graph.nodes.map((node) => [node.name, node.tier]));
  const layout: FabricTopologyLayout = {
    nodes: new Map(),
    clients: new Map(),
    labels: [],
    titles: [],
    nodeHeight,
    width: 0,
    height: 0
  };
  const components = graph.components.length > 0
    ? graph.components
    : [{ name: "", nodes: graph.nodes.map((node) => node.name) }];
  let y = PADDING + ARC_ROOM;
  for (const component of components) {
    if (components.length > 1) {
      layout.titles.push({ name: component.name, y: y - 8 });
      y += COMPONENT_TITLE;
    }
    const members = new Set(component.nodes);
    const known = new Set(TIERS);
    const rows = [...TIERS.map((tier) => ({
      tier,
      names: component.nodes.filter((name) => tierOf.get(name) === tier).sort(natural)
    })), {
      tier: "other",
      names: component.nodes.filter((name) => !known.has(tierOf.get(name) ?? "")).sort(natural)
    }].filter((row) => row.names.length > 0);
    const inner = Math.max(0, ...rows.map((row) => rowWidth(row.names.length, NODE_WIDTH, NODE_GAP)));
    const placed = new Map<string, FabricPoint>();
    rows.forEach((row, rowIndex) => {
      const start = (inner - rowWidth(row.names.length, NODE_WIDTH, NODE_GAP)) / 2;
      row.names.forEach((name, index) => {
        placed.set(name, { x: start + index * (NODE_WIDTH + NODE_GAP) + NODE_WIDTH / 2, y: y + rowIndex * ROW_HEIGHT });
      });
      layout.labels.push({ key: `${component.name}|${row.tier}`, text: row.tier, x: PADDING, y: y + rowIndex * ROW_HEIGHT });
    });
    y += Math.max(0, rows.length - 1) * ROW_HEIGHT;

    const own = showClients
      ? graph.clients
        .filter((client) => client.nodes.some((name) => members.has(name)))
        .map((client) => {
          const xs = client.nodes.flatMap((name) => {
            const point = placed.get(name);
            return point ? [point.x] : [];
          });
          return { client, want: xs.reduce((sum, x) => sum + x, 0) / Math.max(1, xs.length) };
        })
        .sort((a, b) => a.want - b.want || natural(a.client.id, b.client.id))
      : [];
    const clientY = y + ROW_HEIGHT * 0.9;
    const placedClients = placeClients(own, clientY);
    if (own.length > 0) layout.labels.push({ key: `${component.name}|clients`, text: "clients", x: PADDING, y: clientY });

    // The block starts after the row labels.
    const points = [
      ...[...placed.values()].map((point) => [point.x - NODE_WIDTH / 2, point.x + NODE_WIDTH / 2] as const),
      ...[...placedClients.values()].map((point) => [point.x - CLIENT_WIDTH / 2, point.x + CLIENT_WIDTH / 2] as const)
    ];
    const left = Math.min(0, ...points.map(([from]) => from));
    const right = Math.max(0, ...points.map(([, to]) => to));
    const shift = PADDING + LABEL_WIDTH - left;
    for (const [name, point] of placed) layout.nodes.set(name, { x: point.x + shift, y: point.y });
    for (const [id, point] of placedClients) layout.clients.set(id, { x: point.x + shift, y: point.y });
    layout.width = Math.max(layout.width, right + shift + PADDING);
    y += own.length > 0 ? ROW_HEIGHT * 0.9 + CLIENT_HEIGHT + PADDING + ARC_ROOM : nodeHeight + PADDING + ARC_ROOM;
  }
  layout.height = y - ARC_ROOM;
  return layout;
}

export interface FabricCablePath {
  d: string;
  /** Each half, from one end to the middle: coloured by what that end sends. */
  halves: [string, string];
  mid: FabricPoint;
}

function quadratic(from: FabricPoint, control: FabricPoint, to: FabricPoint): string {
  return `M${from.x},${from.y} Q${control.x},${control.y} ${to.x},${to.y}`;
}

function line(from: FabricPoint, to: FabricPoint): string {
  return `M${from.x},${from.y} L${to.x},${to.y}`;
}

/** A cable between two nodes: straight between rows, an arc along one. */
export function cablePath(a: FabricPoint, b: FabricPoint, nodeHeight: number): FabricCablePath {
  if (Math.abs(a.y - b.y) < 1) {
    const top = a.y - nodeHeight / 2;
    const lift = 30 + Math.abs(a.x - b.x) * 0.12;
    const control = { x: (a.x + b.x) / 2, y: top - lift };
    const mid = { x: (a.x + 2 * control.x + b.x) / 4, y: (top + 2 * control.y + top) / 4 };
    const half = (end: FabricPoint) => quadratic(
      { x: end.x, y: top },
      { x: (end.x + control.x) / 2, y: (top + control.y) / 2 },
      mid
    );
    return { d: quadratic({ x: a.x, y: top }, control, { x: b.x, y: top }), halves: [half(a), half(b)], mid };
  }
  const edge = (from: FabricPoint, to: FabricPoint) => ({
    x: from.x,
    y: from.y + (from.y < to.y ? nodeHeight / 2 : -nodeHeight / 2)
  });
  const start = edge(a, b);
  const end = edge(b, a);
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return { d: line(start, end), halves: [line(start, mid), line(end, mid)], mid };
}

/** The view that shows the whole drawing in a viewport, never larger than life. */
export function fitView(
  layout: Pick<FabricTopologyLayout, "width" | "height">,
  viewport: { width: number; height: number }
): { x: number; y: number; k: number } {
  if (layout.width <= 0 || viewport.width <= 0 || viewport.height <= 0) return { x: 0, y: 0, k: 1 };
  const k = Math.min(1, viewport.width / layout.width, viewport.height / layout.height);
  return { x: (viewport.width - layout.width * k) / 2, y: Math.max(0, (viewport.height - layout.height * k) / 2), k };
}

/** A view zoomed by a factor around a point of the viewport, within the limits a drawing stays readable. */
export function zoomView(
  view: { x: number; y: number; k: number },
  factor: number,
  at: FabricPoint
): { x: number; y: number; k: number } {
  const k = Math.min(3, Math.max(0.2, view.k * factor));
  const scale = k / view.k;
  return { x: at.x - (at.x - view.x) * scale, y: at.y - (at.y - view.y) * scale, k };
}

export type FabricTrafficLevel = "none" | "low" | "medium" | "high" | "full";

/** How full a cable's direction is against the rate it counts as full at. */
export function trafficLevel(bps: number | null | undefined, fullBps: number): FabricTrafficLevel {
  if (bps === null || bps === undefined) return "none";
  const share = bps / fullBps;
  if (share < 0.25) return "low";
  if (share < 0.5) return "medium";
  return share < 0.75 ? "high" : "full";
}
