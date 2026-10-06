import type { XYPosition } from "@xyflow/react";

import type { NodeRect } from "./edgeGeometry";

export type LinkStyle = "straight" | "elbow";

export const DEFAULT_LINK_STYLE: LinkStyle = "straight";

export function parseLinkStyle(value: unknown): LinkStyle | null {
  return value === "straight" || value === "elbow" ? value : null;
}

export type ElbowSide = "top" | "right" | "bottom" | "left";

type Axis = "horizontal" | "vertical";

export interface ElbowRoute {
  points: XYPosition[];
  sourceSide: ElbowSide;
  targetSide: ElbowSide;
  /** Rounding of the bends; tighter where neighbouring links run close, so their curves stay apart. */
  cornerRadius: number;
}

export interface ElbowLinkInput {
  id: string;
  source: string;
  target: string;
  sourceRect: NodeRect;
  targetRect: NodeRect;
  /** Length of the endpoint label along the link; the link stays straight past it. */
  sourceLabelLength?: number;
  targetLabelLength?: number;
}

// Default room between links that leave the same side of a node.
const DEFAULT_PORT_GAP = 12;
// Share of a side that ports may spread across, so links stay clear of corners.
const PORT_SPAN_RATIO = 0.8;
// Room between middle segments that would otherwise run on top of each other.
const TRACK_GAP = 10;
const MAX_CORNER_RADIUS = 8;
const MIN_CORNER_RADIUS = 2;
// Shortest straight run out of a node before the first bend.
const MIN_STUB = 12;
// Passes that pull ports of facing nodes into line, so links between them run straight.
const ALIGN_ROUNDS = 4;
const ALIGN_EPSILON = 0.5;
// How much more a port that can line up with its other end counts than one keeping its spread.
const ALIGN_WEIGHT = 100;
// Below this spacing a side is a solid band of links and port order no longer shows.
const CROWDED_PITCH = 5;
// Smallest gap between two nodes that still fits a bend in the lab's main direction.
const FLOW_MIN_GAP = MIN_STUB * 2;
// Air on each side of an endpoint label before the link may bend.
const LABEL_AIR = 3;
const OVERLAP_EPSILON = 1;

interface Route {
  id: string;
  axis: Axis;
  sourceSide: ElbowSide;
  targetSide: ElbowSide;
  sourceRect: NodeRect;
  targetRect: NodeRect;
  /** Port position along the side: x on top/bottom sides, y on left/right sides. */
  sourcePort: number;
  targetPort: number;
  /** Position of the middle segment: x for horizontal links, y for vertical links. */
  mid: number;
  /** Spacing to the neighbouring middle segments in the same channel. */
  trackGap: number;
  sourcePitch: number;
  targetPitch: number;
  /** Straight run kept past each end for the node name and the endpoint label. */
  sourceClearance: number;
  targetClearance: number;
}

export interface ElbowRouteOptions {
  /** Preferred room between links that leave the same side of a node. */
  portGap?: number;
  /** Room under each node kept free of bends, for the node name. */
  bottomClearance?: number;
}

interface PortRequest {
  route: Route;
  end: "source" | "target";
  sortKey: number;
}

function getCenter(rect: NodeRect): XYPosition {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function isHorizontalSide(side: ElbowSide): boolean {
  return side === "top" || side === "bottom";
}

function getSideLine(rect: NodeRect, side: ElbowSide): number {
  switch (side) {
    case "top":
      return rect.y;
    case "bottom":
      return rect.y + rect.height;
    case "left":
      return rect.x;
    case "right":
      return rect.x + rect.width;
  }
}

function getSideSpan(rect: NodeRect, side: ElbowSide): { center: number; half: number } {
  return isHorizontalSide(side)
    ? { center: rect.x + rect.width / 2, half: (rect.width / 2) * PORT_SPAN_RATIO }
    : { center: rect.y + rect.height / 2, half: (rect.height / 2) * PORT_SPAN_RATIO };
}

function getGaps(sourceRect: NodeRect, targetRect: NodeRect): { gapX: number; gapY: number } {
  const source = getCenter(sourceRect);
  const target = getCenter(targetRect);
  return {
    gapX: Math.abs(target.x - source.x) - (sourceRect.width + targetRect.width) / 2,
    gapY: Math.abs(target.y - source.y) - (sourceRect.height + targetRect.height) / 2
  };
}

/** The direction most links in the lab run: top to bottom for layered fabrics. */
function getFlowAxis(inputs: ElbowLinkInput[]): Axis {
  let vertical = 0;
  for (const input of inputs) {
    const { gapX, gapY } = getGaps(input.sourceRect, input.targetRect);
    if (gapY >= gapX) vertical++;
  }
  return vertical * 2 >= inputs.length ? "vertical" : "horizontal";
}

/**
 * Follow the lab's main direction whenever the nodes leave room for a bend
 * that way, so links in a layered fabric drop through the gap between layers.
 * Nodes side by side fall back to the wider gap.
 */
function chooseAxis(sourceRect: NodeRect, targetRect: NodeRect, flowAxis: Axis): Axis {
  const { gapX, gapY } = getGaps(sourceRect, targetRect);
  const flowGap = flowAxis === "vertical" ? gapY : gapX;
  if (flowGap >= FLOW_MIN_GAP || gapX === gapY) return flowAxis;
  return gapX > gapY ? "horizontal" : "vertical";
}

function getEndClearance(side: ElbowSide, labelLength: number, nameClearance: number): number {
  const name = side === "bottom" ? nameClearance : 0;
  return name + (labelLength > 0 ? labelLength + LABEL_AIR * 2 : 0);
}

function createRoute(input: ElbowLinkInput, flowAxis: Axis, bottomClearance: number): Route {
  const axis = chooseAxis(input.sourceRect, input.targetRect, flowAxis);
  const source = getCenter(input.sourceRect);
  const target = getCenter(input.targetRect);
  let sourceSide: ElbowSide;
  let targetSide: ElbowSide;
  if (axis === "horizontal") {
    sourceSide = target.x >= source.x ? "right" : "left";
    targetSide = sourceSide === "right" ? "left" : "right";
  } else {
    sourceSide = target.y >= source.y ? "bottom" : "top";
    targetSide = sourceSide === "bottom" ? "top" : "bottom";
  }
  return {
    id: input.id,
    axis,
    sourceSide,
    targetSide,
    sourceRect: input.sourceRect,
    targetRect: input.targetRect,
    sourcePort: getSideSpan(input.sourceRect, sourceSide).center,
    targetPort: getSideSpan(input.targetRect, targetSide).center,
    mid: 0,
    trackGap: TRACK_GAP,
    sourcePitch: 0,
    targetPitch: 0,
    sourceClearance: getEndClearance(sourceSide, input.sourceLabelLength ?? 0, bottomClearance),
    targetClearance: getEndClearance(targetSide, input.targetLabelLength ?? 0, bottomClearance)
  };
}

/**
 * Order links on one side by where they head, so neighbours do not cross.
 * Links that bend sooner sit further out, which is what the slope measures.
 */
function getPortSortKey(rect: NodeRect, side: ElbowSide, otherRect: NodeRect): number {
  const own = getCenter(rect);
  const other = getCenter(otherRect);
  const along = isHorizontalSide(side) ? other.x - own.x : other.y - own.y;
  const across = isHorizontalSide(side) ? Math.abs(other.y - own.y) : Math.abs(other.x - own.x);
  return along / Math.max(across, 1);
}

type PortEnd = "source" | "target";

interface SideGroup {
  requests: PortRequest[];
  low: number;
  high: number;
  pitch: number;
  defaults: number[];
}

function getPort(route: Route, end: PortEnd): number {
  return end === "source" ? route.sourcePort : route.targetPort;
}

function setPort(route: Route, end: PortEnd, value: number): void {
  if (end === "source") route.sourcePort = value;
  else route.targetPort = value;
}

/** Whether one straight line can join the two sides. */
function canRunStraight(route: Route): boolean {
  const source = getSideSpan(route.sourceRect, route.sourceSide);
  const target = getSideSpan(route.targetRect, route.targetSide);
  return (
    Math.max(source.center - source.half, target.center - target.half) <=
    Math.min(source.center + source.half, target.center + target.half)
  );
}

/**
 * Closest positions to the wanted ones that keep the given order, at least
 * `pitch` apart and inside [low, high]. Weighted least squares through pooled
 * blocks, then pushed inside the bounds.
 */
export function fitPortPositions(
  wanted: number[],
  pitch: number,
  low: number,
  high: number,
  weights: number[] = wanted.map(() => 1)
): number[] {
  const blocks: { sum: number; weight: number; count: number }[] = [];
  wanted.forEach((value, index) => {
    const weight = weights[index];
    let block = { sum: (value - index * pitch) * weight, weight, count: 1 };
    let last = blocks.at(-1);
    while (last && last.sum / last.weight > block.sum / block.weight) {
      blocks.pop();
      block = {
        sum: block.sum + last.sum,
        weight: block.weight + last.weight,
        count: block.count + last.count
      };
      last = blocks.at(-1);
    }
    blocks.push(block);
  });

  const positions: number[] = [];
  for (const block of blocks) {
    const mean = block.sum / block.weight;
    for (let i = 0; i < block.count; i++) positions.push(mean + positions.length * pitch);
  }

  const last = positions.length - 1;
  positions[0] = Math.max(positions[0], low);
  for (let i = 1; i <= last; i++) positions[i] = Math.max(positions[i], positions[i - 1] + pitch);
  positions[last] = Math.min(positions[last], high);
  for (let i = last - 1; i >= 0; i--) positions[i] = Math.min(positions[i], positions[i + 1] - pitch);
  return positions;
}

function buildSideGroups(
  routes: Route[],
  inputs: Map<string, ElbowLinkInput>,
  portGap: number
): SideGroup[] {
  const requestsBySide = new Map<string, PortRequest[]>();
  const addRequest = (nodeId: string, side: ElbowSide, request: PortRequest) => {
    const key = `${nodeId}\u0000${side}`;
    const list = requestsBySide.get(key);
    if (list) list.push(request);
    else requestsBySide.set(key, [request]);
  };

  for (const route of routes) {
    const input = inputs.get(route.id);
    if (!input) continue;
    addRequest(input.source, route.sourceSide, {
      route,
      end: "source",
      sortKey: getPortSortKey(route.sourceRect, route.sourceSide, route.targetRect)
    });
    addRequest(input.target, route.targetSide, {
      route,
      end: "target",
      sortKey: getPortSortKey(route.targetRect, route.targetSide, route.sourceRect)
    });
  }

  const groups: SideGroup[] = [];
  for (const requests of requestsBySide.values()) {
    requests.sort((a, b) => a.sortKey - b.sortKey || a.route.id.localeCompare(b.route.id));
    const first = requests[0];
    const rect = first.end === "source" ? first.route.sourceRect : first.route.targetRect;
    const side = first.end === "source" ? first.route.sourceSide : first.route.targetSide;
    const { center, half } = getSideSpan(rect, side);
    const count = requests.length;
    const pitch = count > 1 ? Math.min(portGap, (half * 2) / (count - 1)) : 0;
    const defaults = requests.map((_, index) => center + (index - (count - 1) / 2) * pitch);
    requests.forEach((request, index) => {
      setPort(request.route, request.end, defaults[index]);
      if (request.end === "source") request.route.sourcePitch = pitch;
      else request.route.targetPitch = pitch;
    });
    groups.push({ requests, low: center - half, high: center + half, pitch, defaults });
  }
  return groups;
}

/**
 * Spread links along each side, then line up the ends of links whose nodes
 * face each other so those links run straight. Other links keep their even
 * spread unless a straight neighbour needs the room.
 */
function assignPorts(
  routes: Route[],
  inputs: Map<string, ElbowLinkInput>,
  portGap: number
): void {
  const groups = buildSideGroups(routes, inputs, portGap);
  const straight = new Set(routes.filter(canRunStraight));

  for (let round = 0; round < ALIGN_ROUNDS; round++) {
    for (const group of groups) {
      const wanted = group.requests.map((request, index) => {
        if (!straight.has(request.route)) return group.defaults[index];
        const other = getPort(request.route, request.end === "source" ? "target" : "source");
        return Math.min(group.high, Math.max(group.low, other));
      });
      const weights = group.requests.map((request) =>
        straight.has(request.route) ? ALIGN_WEIGHT : 1
      );
      const fitted = fitPortPositions(wanted, group.pitch, group.low, group.high, weights);
      group.requests.forEach((request, index) => setPort(request.route, request.end, fitted[index]));
    }
  }

  for (const route of straight) {
    snapStraight(route);
  }
}

/**
 * Finish lining up a straight link. On a crowded side the links already
 * merge into a band, so its port may step out of order to meet the other end.
 */
function snapStraight(route: Route): void {
  if (Math.abs(route.sourcePort - route.targetPort) < ALIGN_EPSILON) {
    route.targetPort = route.sourcePort;
    return;
  }
  const source = getSideSpan(route.sourceRect, route.sourceSide);
  const target = getSideSpan(route.targetRect, route.targetSide);
  if (route.sourcePitch < CROWDED_PITCH && Math.abs(route.targetPort - source.center) <= source.half) {
    route.sourcePort = route.targetPort;
  } else if (
    route.targetPitch < CROWDED_PITCH &&
    Math.abs(route.sourcePort - target.center) <= target.half
  ) {
    route.targetPort = route.sourcePort;
  }
}

/** Where the link may first bend: past the node name and the endpoint label. */
function getExitLine(route: Route, end: PortEnd): number {
  const rect = end === "source" ? route.sourceRect : route.targetRect;
  const side = end === "source" ? route.sourceSide : route.targetSide;
  const clearance = end === "source" ? route.sourceClearance : route.targetClearance;
  const line = getSideLine(rect, side);
  return side === "bottom" || side === "right" ? line + clearance : line - clearance;
}

/**
 * The stretch where the middle segment may run. When the two ends need more
 * straight run than the gap holds, the link bends halfway between the nodes.
 */
function getChannel(route: Route): { start: number; end: number } {
  const sourceLine = getSideLine(route.sourceRect, route.sourceSide);
  const targetLine = getSideLine(route.targetRect, route.targetSide);
  const sourceExit = getExitLine(route, "source");
  const targetExit = getExitLine(route, "target");
  if (Math.sign(targetExit - sourceExit) !== Math.sign(targetLine - sourceLine)) {
    const middle = (sourceLine + targetLine) / 2;
    return { start: middle, end: middle };
  }
  return { start: Math.min(sourceExit, targetExit), end: Math.max(sourceExit, targetExit) };
}

function isSourceFirst(route: Route): boolean {
  return (
    getSideLine(route.sourceRect, route.sourceSide) <=
    getSideLine(route.targetRect, route.targetSide)
  );
}

function clampToChannel(route: Route, value: number): number {
  const { start, end } = getChannel(route);
  if (end - start <= MIN_STUB * 2) return (start + end) / 2;
  return Math.min(end - MIN_STUB, Math.max(start + MIN_STUB, value));
}

interface TrackCandidate {
  route: Route;
  nominal: number;
  low: number;
  high: number;
  order: number;
}

function toTrackCandidate(route: Route): TrackCandidate | null {
  if (route.sourcePort === route.targetPort) return null;
  const { start, end } = getChannel(route);
  // The end nearer the channel start leads; links that head the same way nest
  // without crossing when the trailing one takes the far track.
  const sourceFirst = isSourceFirst(route);
  const leadPort = sourceFirst ? route.sourcePort : route.targetPort;
  const trailPort = sourceFirst ? route.targetPort : route.sourcePort;
  const heading = Math.sign(trailPort - leadPort);
  return {
    route,
    nominal: (start + end) / 2,
    low: Math.min(route.sourcePort, route.targetPort),
    high: Math.max(route.sourcePort, route.targetPort),
    order: heading * leadPort
  };
}

function intervalsOverlap(a: TrackCandidate, b: TrackCandidate): boolean {
  return a.low < b.high + OVERLAP_EPSILON && b.low < a.high + OVERLAP_EPSILON;
}

function assignClusterTracks(cluster: TrackCandidate[]): void {
  const mean = cluster.reduce((sum, candidate) => sum + candidate.nominal, 0) / cluster.length;
  const ordered = [...cluster].sort(
    (a, b) => b.order - a.order || a.route.id.localeCompare(b.route.id)
  );
  const levels = new Map<TrackCandidate, number>();
  let maxLevel = 0;
  for (const candidate of ordered) {
    let level = 0;
    for (const [placed, placedLevel] of levels) {
      if (intervalsOverlap(candidate, placed)) level = Math.max(level, placedLevel + 1);
    }
    levels.set(candidate, level);
    maxLevel = Math.max(maxLevel, level);
  }
  // Squeeze the tracks when there are more than the narrowest channel holds,
  // so they share it evenly instead of piling up at its edges.
  const room = Math.min(
    ...cluster.map((candidate) => {
      const { start, end } = getChannel(candidate.route);
      return end - start - MIN_STUB * 2;
    })
  );
  const gap = maxLevel > 0 ? Math.min(TRACK_GAP, Math.max(room, 0) / maxLevel) : 0;
  for (const [candidate, level] of levels) {
    candidate.route.mid = clampToChannel(candidate.route, mean + (level - maxLevel / 2) * gap);
    if (maxLevel > 0) candidate.route.trackGap = gap;
  }
}

/** Give overlapping middle segments their own track so they do not run on top of each other. */
function assignTracks(routes: Route[]): void {
  for (const route of routes) {
    const { start, end } = getChannel(route);
    route.mid = (start + end) / 2;
  }

  for (const axis of ["horizontal", "vertical"] as const) {
    const candidates = routes
      .filter((route) => route.axis === axis)
      .map(toTrackCandidate)
      .filter((candidate): candidate is TrackCandidate => candidate !== null)
      .sort((a, b) => a.nominal - b.nominal);

    let cluster: TrackCandidate[] = [];
    for (const candidate of candidates) {
      const last = cluster.at(-1);
      if (last && candidate.nominal - last.nominal > TRACK_GAP) {
        assignClusterTracks(cluster);
        cluster = [];
      }
      cluster.push(candidate);
    }
    if (cluster.length > 0) assignClusterTracks(cluster);
  }
}

/**
 * Bends of neighbouring links sit one spacing apart; rounding them by more
 * than that makes the curves run into each other.
 */
function getCornerRadius(route: Route): number {
  const spacings = [route.trackGap, route.sourcePitch, route.targetPitch].filter(
    (spacing) => spacing > 0
  );
  const radius = Math.min(MAX_CORNER_RADIUS, ...spacings);
  return Math.max(MIN_CORNER_RADIUS, radius);
}

function getPortPoint(rect: NodeRect, side: ElbowSide, port: number): XYPosition {
  const line = getSideLine(rect, side);
  return isHorizontalSide(side) ? { x: port, y: line } : { x: line, y: port };
}

function toPolyline(route: Route): XYPosition[] {
  const start = getPortPoint(route.sourceRect, route.sourceSide, route.sourcePort);
  const end = getPortPoint(route.targetRect, route.targetSide, route.targetPort);
  if (route.sourcePort === route.targetPort) return [start, end];
  if (route.axis === "horizontal") {
    return [start, { x: route.mid, y: start.y }, { x: route.mid, y: end.y }, end];
  }
  return [start, { x: start.x, y: route.mid }, { x: end.x, y: route.mid }, end];
}

/**
 * Route links as right-angle elbows. Each link leaves the side of its node that
 * faces the other node; links sharing a side spread out along it, and middle
 * segments that would overlap get separate tracks.
 */
export function routeElbowLinks(
  inputs: ElbowLinkInput[],
  options: ElbowRouteOptions = {}
): Map<string, ElbowRoute> {
  const portGap = options.portGap ?? DEFAULT_PORT_GAP;
  const bottomClearance = options.bottomClearance ?? 0;
  const links = inputs.filter((input) => input.source !== input.target);
  const flowAxis = getFlowAxis(links);
  const inputById = new Map<string, ElbowLinkInput>();
  const routes: Route[] = [];
  for (const input of links) {
    inputById.set(input.id, input);
    routes.push(createRoute(input, flowAxis, bottomClearance));
  }

  assignPorts(routes, inputById, portGap);
  assignTracks(routes);

  const result = new Map<string, ElbowRoute>();
  for (const route of routes) {
    result.set(route.id, {
      points: toPolyline(route),
      sourceSide: route.sourceSide,
      targetSide: route.targetSide,
      cornerRadius: getCornerRadius(route)
    });
  }
  return result;
}

function distance(a: XYPosition, b: XYPosition): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Build an SVG path through the points, rounding each bend. */
export function buildRoundedPolylinePath(points: XYPosition[], radius: number): string {
  if (points.length === 0) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const inLength = distance(previous, corner);
    const outLength = distance(corner, next);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r <= 0) {
      path += ` L ${corner.x} ${corner.y}`;
      continue;
    }
    const enter = {
      x: corner.x + ((previous.x - corner.x) / inLength) * r,
      y: corner.y + ((previous.y - corner.y) / inLength) * r
    };
    const exit = {
      x: corner.x + ((next.x - corner.x) / outLength) * r,
      y: corner.y + ((next.y - corner.y) / outLength) * r
    };
    path += ` L ${enter.x} ${enter.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

/** Point at the given distance along the polyline, clamped to its ends. */
export function getPointAlongPolyline(points: XYPosition[], offset: number): XYPosition {
  if (points.length === 0) return { x: 0, y: 0 };
  let remaining = Math.max(0, offset);
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const length = distance(from, to);
    if (length > 0 && remaining <= length) {
      const ratio = remaining / length;
      return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
    }
    remaining -= length;
  }
  return points[points.length - 1];
}

export function getPolylineLength(points: XYPosition[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

/** Rounded rectangular loop out of the right side of a node. */
export function getElbowLoopPolyline(rect: NodeRect, loopIndex: number, size: number): XYPosition[] {
  const right = rect.x + rect.width;
  const centerY = rect.y + rect.height / 2;
  const reach = size * 0.6 + loopIndex * TRACK_GAP;
  const spread = rect.height / 4 + loopIndex * (TRACK_GAP / 2);
  return [
    { x: right, y: centerY - spread },
    { x: right + reach, y: centerY - spread },
    { x: right + reach, y: centerY + spread },
    { x: right, y: centerY + spread }
  ];
}
