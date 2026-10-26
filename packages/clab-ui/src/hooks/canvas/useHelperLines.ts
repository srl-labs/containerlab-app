/**
 * Helper lines hook for node alignment during drag
 *
 * Provides visual alignment guides that appear when dragging nodes,
 * helping to align nodes horizontally and vertically with other nodes
 * and to space nodes in a row or column evenly. The dragged node snaps
 * to the closest guide.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import type { Node } from "@xyflow/react";

/** Distance threshold in pixels for triggering alignment snap */
const SNAP_THRESHOLD = 5;
/** Snapped positions and gaps this close count as the same */
const GUIDE_TOLERANCE = 0.5;
/** Node types whose spacing is matched; groups and annotations span or overlap nodes */
const SPACING_NODE_TYPES = new Set(["topology-node", "network-node"]);

type Axis = "x" | "y";

/** An equal gap between neighbouring nodes in the dragged node's row or column */
export interface GapMarker {
  /** "x" for a gap between nodes in a row, "y" for one in a column */
  axis: Axis;
  /** Where the gap starts and ends on its axis */
  start: number;
  end: number;
  /** Position of the marker on the other axis */
  offset: number;
}

/** Types of alignment detected */
export interface HelperLinePositions {
  /** Horizontal line Y position (when node centers align horizontally) */
  horizontal: number | null;
  /** Vertical line X position (when node centers align vertically) */
  vertical: number | null;
  /** Horizontal midpoint line Y position (when node is centered between two nodes vertically) */
  horizontalMidpoint: number | null;
  /** Vertical midpoint line X position (when node is centered between two nodes horizontally) */
  verticalMidpoint: number | null;
  /** Equal gaps around the dragged node, including its own */
  gaps: GapMarker[];
}

/** Snapped node position per axis; null where no guide holds the node */
export interface GuideSnap {
  x: number | null;
  y: number | null;
}

/** Alignment result with the guides to show and the position they snap to */
export interface AlignmentResult {
  lines: HelperLinePositions;
  snap: GuideSnap;
}

interface NodeBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
  centerX: number;
  centerY: number;
}

/** Guide targets of the nodes a dragged node can align with, built once per drag */
export interface AlignmentIndex {
  /** Sorted left, center and right edges */
  xTargets: number[];
  /** Sorted top, center and bottom edges */
  yTargets: number[];
  /** Nodes whose spacing can be matched */
  spacingBoxes: NodeBox[];
}

const EMPTY_HELPER_LINES: HelperLinePositions = {
  horizontal: null,
  vertical: null,
  horizontalMidpoint: null,
  verticalMidpoint: null,
  gaps: []
};

const NO_GUIDE_SNAP: GuideSnap = { x: null, y: null };

function areGapMarkersEqual(left: GapMarker[], right: GapMarker[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((marker, index) => {
    const other = right[index];
    return (
      marker.axis === other.axis &&
      marker.start === other.start &&
      marker.end === other.end &&
      marker.offset === other.offset
    );
  });
}

function areHelperLinesEqual(left: HelperLinePositions, right: HelperLinePositions): boolean {
  return (
    left.horizontal === right.horizontal &&
    left.vertical === right.vertical &&
    left.horizontalMidpoint === right.horizontalMidpoint &&
    left.verticalMidpoint === right.verticalMidpoint &&
    areGapMarkersEqual(left.gaps, right.gaps)
  );
}

function hasHelperLines(lines: HelperLinePositions): boolean {
  return (
    lines.horizontal !== null ||
    lines.vertical !== null ||
    lines.horizontalMidpoint !== null ||
    lines.verticalMidpoint !== null ||
    lines.gaps.length > 0
  );
}

/** Get node dimensions with defaults */
function getNodeDimensions(node: Node): { width: number; height: number } {
  return {
    width: node.measured?.width ?? node.width ?? 40,
    height: node.measured?.height ?? node.height ?? 40
  };
}

function boxAt(
  position: { x: number; y: number },
  dims: { width: number; height: number }
): NodeBox {
  return {
    top: position.y,
    right: position.x + dims.width,
    bottom: position.y + dims.height,
    left: position.x,
    centerX: position.x + dims.width / 2,
    centerY: position.y + dims.height / 2
  };
}

/** Get node edges (top, right, bottom, left) */
function getNodeEdges(node: Node): NodeBox {
  return boxAt(node.position, getNodeDimensions(node));
}

function startOf(box: NodeBox, axis: Axis): number {
  return axis === "x" ? box.left : box.top;
}

function endOf(box: NodeBox, axis: Axis): number {
  return axis === "x" ? box.right : box.bottom;
}

function centerOf(box: NodeBox, axis: Axis): number {
  return axis === "x" ? box.centerX : box.centerY;
}

function crossAxis(axis: Axis): Axis {
  return axis === "x" ? "y" : "x";
}

/**
 * Index the nodes the dragged node can align with. Nodes moving with the drag
 * (the selection, group members) never act as guides.
 */
export function buildAlignmentIndex(
  allNodes: Node[],
  excludeIds: ReadonlySet<string>
): AlignmentIndex {
  const xTargets: number[] = [];
  const yTargets: number[] = [];
  const spacingBoxes: NodeBox[] = [];
  for (const node of allNodes) {
    if (excludeIds.has(node.id) || node.hidden === true) continue;
    const edges = getNodeEdges(node);
    xTargets.push(edges.left, edges.centerX, edges.right);
    yTargets.push(edges.top, edges.centerY, edges.bottom);
    if (SPACING_NODE_TYPES.has(node.type ?? "")) spacingBoxes.push(edges);
  }
  xTargets.sort((a, b) => a - b);
  yTargets.sort((a, b) => a - b);
  return { xTargets, yTargets, spacingBoxes };
}

type AxisCandidate = {
  /** Snapped node coordinate on the axis */
  snap: number;
  distance: number;
};

type AlignmentCandidate = AxisCandidate & { line: number };

type GapCandidate = AxisCandidate & { size: number };

function lowerBound(sorted: number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sorted[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function findClosestAxisAlignment(
  dragPositions: Array<{ value: number; snapOffset: number }>,
  sortedTargets: number[],
  threshold: number
): AlignmentCandidate | null {
  let best: AlignmentCandidate | null = null;

  for (const drag of dragPositions) {
    // The closest target is next to where the value would be inserted.
    const insertAt = lowerBound(sortedTargets, drag.value);
    const last = Math.min(sortedTargets.length - 1, insertAt);
    for (let index = Math.max(0, insertAt - 1); index <= last; index++) {
      const target = sortedTargets[index];
      const distance = Math.abs(drag.value - target);
      if (distance <= threshold && (best === null || distance < best.distance)) {
        best = { snap: target + drag.snapOffset, distance, line: target };
      }
    }
  }

  return best;
}

/** Nodes sharing the dragged node's row (axis "x") or column (axis "y"), in order along the axis */
function collectLane(box: NodeBox, axis: Axis, spacingBoxes: NodeBox[]): NodeBox[] {
  const cross = crossAxis(axis);
  const lane = spacingBoxes.filter(
    (other) => startOf(other, cross) < endOf(box, cross) && endOf(other, cross) > startOf(box, cross)
  );
  return lane.sort((a, b) => startOf(a, axis) - startOf(b, axis));
}

interface LaneGap {
  start: number;
  end: number;
  from: NodeBox;
  to: NodeBox;
}

/** Uncovered stretches between consecutive nodes of a lane sorted by start */
function collectLaneGaps(lane: NodeBox[], axis: Axis): LaneGap[] {
  const gaps: LaneGap[] = [];
  let reach: NodeBox | null = null;
  for (const box of lane) {
    if (reach !== null && startOf(box, axis) > endOf(reach, axis)) {
      gaps.push({ start: endOf(reach, axis), end: startOf(box, axis), from: reach, to: box });
    }
    if (reach === null || endOf(box, axis) > endOf(reach, axis)) reach = box;
  }
  return gaps;
}

interface LaneNeighbours {
  before: NodeBox | null;
  after: NodeBox | null;
}

/** The closest lane nodes on either side of the dragged node */
function findLaneNeighbours(
  box: NodeBox,
  axis: Axis,
  lane: NodeBox[],
  threshold: number
): LaneNeighbours {
  let before: NodeBox | null = null;
  let after: NodeBox | null = null;
  const center = centerOf(box, axis);
  for (const other of lane) {
    const otherCenter = centerOf(other, axis);
    if (otherCenter < center && endOf(other, axis) <= startOf(box, axis) + threshold) {
      if (before === null || endOf(other, axis) > endOf(before, axis)) before = other;
    } else if (otherCenter > center && startOf(other, axis) >= endOf(box, axis) - threshold) {
      if (after === null || startOf(other, axis) < startOf(after, axis)) after = other;
    }
  }
  return { before, after };
}

/**
 * Snap that repeats a gap of the lane next to the dragged node, or centers
 * the node with equal gaps to both neighbours.
 */
function findEqualGapSnap(
  box: NodeBox,
  size: number,
  axis: Axis,
  lane: NodeBox[],
  neighbours: LaneNeighbours,
  threshold: number
): GapCandidate | null {
  const { before, after } = neighbours;
  if (before === null && after === null) return null;

  const position = startOf(box, axis);
  let best: GapCandidate | null = null;
  const consider = (snap: number, gapSize: number) => {
    const distance = Math.abs(snap - position);
    if (gapSize > 0 && distance <= threshold && (best === null || distance < best.distance)) {
      best = { snap, distance, size: gapSize };
    }
  };

  for (const gap of collectLaneGaps(lane, axis)) {
    // The gap the dragged node sits in is the room it is being placed into.
    if (gap.start < endOf(box, axis) + threshold && gap.end > position - threshold) continue;
    const gapSize = gap.end - gap.start;
    if (before !== null) consider(endOf(before, axis) + gapSize, gapSize);
    if (after !== null) consider(startOf(after, axis) - gapSize - size, gapSize);
  }

  if (before !== null && after !== null) {
    const gapSize = (startOf(after, axis) - endOf(before, axis) - size) / 2;
    consider(endOf(before, axis) + gapSize, gapSize);
  }

  return best;
}

/** Snap that centers the dragged node between its neighbours' centers */
function findMidpointSnap(
  box: NodeBox,
  size: number,
  axis: Axis,
  neighbours: LaneNeighbours,
  threshold: number
): AlignmentCandidate | null {
  const { before, after } = neighbours;
  if (before === null || after === null) return null;
  const line = (centerOf(before, axis) + centerOf(after, axis)) / 2;
  const snap = line - size / 2;
  const distance = Math.abs(snap - startOf(box, axis));
  return distance <= threshold ? { snap, distance, line } : null;
}

interface AxisGuides {
  /** Snapped node coordinate, or null when no guide is in range */
  snap: number | null;
  /** Edge or center alignment line through the snapped node */
  line: number | null;
  /** Midpoint line between the neighbours' centers */
  midpoint: number | null;
  /** Gap size repeated by the snap, with the lane it is measured in */
  gap: { size: number; lane: NodeBox[] } | null;
}

const NO_AXIS_GUIDES: AxisGuides = { snap: null, line: null, midpoint: null, gap: null };

/** Pick the closest guide on one axis and every guide that holds at that position. */
function resolveAxisGuides(
  axis: Axis,
  box: NodeBox,
  size: number,
  index: AlignmentIndex,
  matchSpacing: boolean,
  threshold: number
): AxisGuides {
  const dragPositions = [
    { value: startOf(box, axis), snapOffset: 0 },
    { value: centerOf(box, axis), snapOffset: -size / 2 },
    { value: endOf(box, axis), snapOffset: -size }
  ];
  const alignment = findClosestAxisAlignment(
    dragPositions,
    axis === "x" ? index.xTargets : index.yTargets,
    threshold
  );

  let midpoint: AlignmentCandidate | null = null;
  let gap: GapCandidate | null = null;
  let lane: NodeBox[] = [];
  if (matchSpacing) {
    lane = collectLane(box, axis, index.spacingBoxes);
    const neighbours = findLaneNeighbours(box, axis, lane, threshold);
    midpoint = findMidpointSnap(box, size, axis, neighbours, threshold);
    gap = findEqualGapSnap(box, size, axis, lane, neighbours, threshold);
  }

  // Closest wins; ties prefer edge alignment, then midpoints.
  let best: AxisCandidate | null = alignment;
  for (const candidate of [midpoint, gap]) {
    if (candidate !== null && (best === null || candidate.distance < best.distance)) {
      best = candidate;
    }
  }
  if (best === null) return NO_AXIS_GUIDES;

  const snap = best.snap;
  const holds = (candidate: AxisCandidate) => Math.abs(candidate.snap - snap) <= GUIDE_TOLERANCE;
  return {
    snap,
    line: alignment !== null && holds(alignment) ? alignment.line : null,
    midpoint: midpoint !== null && holds(midpoint) ? midpoint.line : null,
    gap: gap !== null && holds(gap) ? { size: gap.size, lane } : null
  };
}

/** Marker position on the other axis: the middle of the two nodes' overlap */
function gapMarkerOffset(from: NodeBox, to: NodeBox, axis: Axis): number {
  const cross = crossAxis(axis);
  const low = Math.max(startOf(from, cross), startOf(to, cross));
  const high = Math.min(endOf(from, cross), endOf(to, cross));
  return low <= high ? (low + high) / 2 : (centerOf(from, cross) + centerOf(to, cross)) / 2;
}

/** Every gap of the lane, with the snapped node in it, that matches the snapped gap */
function collectGapMarkers(axis: Axis, box: NodeBox, guides: AxisGuides): GapMarker[] {
  if (guides.gap === null) return [];
  const { size, lane } = guides.gap;
  const sorted = [...lane, box].sort((a, b) => startOf(a, axis) - startOf(b, axis));
  const markers = collectLaneGaps(sorted, axis)
    .filter((gap) => Math.abs(gap.end - gap.start - size) <= GUIDE_TOLERANCE)
    .map((gap) => ({
      axis,
      start: gap.start,
      end: gap.end,
      offset: gapMarkerOffset(gap.from, gap.to, axis)
    }));
  return markers.length >= 2 ? markers : [];
}

/**
 * Calculate alignment helper lines and snap position for a dragged node
 *
 * @param draggingNode - The node being dragged (with current drag position)
 * @param index - Guide targets of the other nodes (see buildAlignmentIndex)
 * @param threshold - Pixel threshold for snapping
 * @returns Alignment result with helper line positions and the snapped position per axis
 */
export function calculateAlignments(
  draggingNode: Node,
  index: AlignmentIndex,
  threshold: number = SNAP_THRESHOLD
): AlignmentResult {
  const dims = getNodeDimensions(draggingNode);
  const box = boxAt(draggingNode.position, dims);
  const matchSpacing = SPACING_NODE_TYPES.has(draggingNode.type ?? "");

  const x = resolveAxisGuides("x", box, dims.width, index, matchSpacing, threshold);
  const y = resolveAxisGuides("y", box, dims.height, index, matchSpacing, threshold);
  const snappedBox = boxAt({ x: x.snap ?? box.left, y: y.snap ?? box.top }, dims);

  return {
    lines: {
      horizontal: y.line,
      vertical: x.line,
      horizontalMidpoint: y.midpoint,
      verticalMidpoint: x.midpoint,
      gaps: [...collectGapMarkers("x", snappedBox, x), ...collectGapMarkers("y", snappedBox, y)]
    },
    snap: { x: x.snap, y: y.snap }
  };
}

/**
 * Hook to manage helper lines state during node dragging
 */
export function useHelperLines() {
  const [helperLines, setHelperLines] = useState<HelperLinePositions>(EMPTY_HELPER_LINES);

  // Track if we're currently showing lines (to avoid unnecessary state updates)
  const hasLinesRef = useRef(false);
  const helperLinesRef = useRef<HelperLinePositions>(EMPTY_HELPER_LINES);
  const pendingLinesRef = useRef<HelperLinePositions | null>(null);
  const rafIdRef = useRef<number | null>(null);
  // Other nodes stay put during a drag, so their guides are indexed once.
  const indexRef = useRef<AlignmentIndex | null>(null);

  const flushPendingLines = useCallback(() => {
    rafIdRef.current = null;
    const pending = pendingLinesRef.current;
    if (!pending) return;
    pendingLinesRef.current = null;
    if (areHelperLinesEqual(helperLinesRef.current, pending)) return;
    helperLinesRef.current = pending;
    setHelperLines(pending);
  }, []);

  const scheduleHelperLineUpdate = useCallback(
    (nextLines: HelperLinePositions) => {
      pendingLinesRef.current = nextLines;
      if (rafIdRef.current !== null) return;
      rafIdRef.current = window.requestAnimationFrame(flushPendingLines);
    },
    [flushPendingLines]
  );

  useEffect(
    () => () => {
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
      }
    },
    []
  );

  /** Index the nodes the dragged node can align with (call on drag start) */
  const beginHelperLines = useCallback((allNodes: Node[], excludeIds: ReadonlySet<string>) => {
    indexRef.current = buildAlignmentIndex(allNodes, excludeIds);
  }, []);

  /**
   * Update helper lines based on dragged node position
   * Returns the snapped position per axis
   */
  const updateHelperLines = useCallback(
    (draggingNode: Node): GuideSnap => {
      const index = indexRef.current;
      if (!index) return NO_GUIDE_SNAP;
      const { lines, snap } = calculateAlignments(draggingNode, index);
      const hasLines = hasHelperLines(lines);

      // Only update state if lines changed
      if (hasLines || hasLinesRef.current) {
        scheduleHelperLineUpdate(lines);
        hasLinesRef.current = hasLines;
      }

      return snap;
    },
    [scheduleHelperLineUpdate]
  );

  /** Clear helper lines (call on drag end) */
  const clearHelperLines = useCallback(() => {
    indexRef.current = null;
    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    pendingLinesRef.current = null;

    if (!hasLinesRef.current && areHelperLinesEqual(helperLinesRef.current, EMPTY_HELPER_LINES)) {
      return;
    }

    helperLinesRef.current = EMPTY_HELPER_LINES;
    setHelperLines(EMPTY_HELPER_LINES);
    hasLinesRef.current = false;
  }, []);

  return {
    helperLines,
    beginHelperLines,
    updateHelperLines,
    clearHelperLines
  };
}
