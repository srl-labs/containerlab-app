// Dashed arrows between nodes for their wait-for dependencies (stages).
import React, { useCallback, useMemo } from "react";
import { ViewportPortal, useStore } from "@xyflow/react";
import type { ReactFlowState } from "@xyflow/react";

import { useGraphStore } from "../../stores/graphStore";
import {
  useNodeBoxSpacing,
  useNodeStyle,
  useTopoViewerStore
} from "../../stores/topoViewerStore";
import { getNodeWaitForDependencies } from "../../core/utilities/nodeStages";
import type { WaitForDependency } from "../../core/utilities/nodeStages";
import { clampTelemetryNodeSizePx } from "../../utils/telemetryInterfaceLabels";

import { getEdgePoints, type NodeRect } from "./edgeGeometry";
import { getNodeConnectionRect } from "./nodeBox";

const NODE_ICON_SIZE = 40;
const ARROW_COLOR = "var(--topoviewer-wait-for-color, #d97706)";
const LABEL_BG_COLOR = "var(--topoviewer-edge-label-background)";
const LABEL_TEXT_COLOR = "var(--topoviewer-edge-label-foreground)";
/** How far the curve bows away from the straight link between the same nodes */
const CURVE_OFFSET = 28;
const ARROW_MARKER_ID = "clab-wait-for-arrow";

/** One arrow: every wait-for from `node` on `dependsOn`, drawn dependsOn -> node */
interface WaitForArrow {
  key: string;
  from: string;
  to: string;
  labels: string[];
  titles: string[];
}

function groupArrows(dependencies: WaitForDependency[]): WaitForArrow[] {
  const arrows = new Map<string, WaitForArrow>();
  for (const dep of dependencies) {
    const key = `${dep.dependsOn}->${dep.node}`;
    const arrow = arrows.get(key) ?? {
      key,
      from: dep.dependsOn,
      to: dep.node,
      labels: [],
      titles: []
    };
    const stage = dep.dependsOnStage || "?";
    arrow.labels.push(`${stage} → ${dep.nodeStage}`);
    arrow.titles.push(
      `${dep.node} enters ${dep.nodeStage} after ${dep.dependsOn} finishes ${stage}`
    );
    arrows.set(key, arrow);
  }
  return [...arrows.values()];
}

// Node data keeps its extraData object while a node is dragged, so the parsed
// dependencies are cached per object instead of parsed on every move.
const dependencyCache = new WeakMap<Record<string, unknown>, Map<string, WaitForDependency[]>>();

function getCachedDependencies(
  nodeId: string,
  extraData: Record<string, unknown> | undefined
): WaitForDependency[] {
  if (!extraData) return [];
  const byId = dependencyCache.get(extraData) ?? new Map<string, WaitForDependency[]>();
  dependencyCache.set(extraData, byId);
  let dependencies = byId.get(nodeId);
  if (!dependencies) {
    dependencies = getNodeWaitForDependencies(nodeId, extraData);
    byId.set(nodeId, dependencies);
  }
  return dependencies;
}

function useWaitForArrows(): WaitForArrow[] {
  const nodes = useGraphStore((state) => state.nodes);
  return useMemo(
    () =>
      groupArrows(
        nodes
          .filter((node) => node.type === "topology-node")
          .flatMap((node) => {
            const data = node.data as { extraData?: Record<string, unknown> } | undefined;
            return getCachedDependencies(node.id, data?.extraData);
          })
          .filter((dep) => dep.node !== dep.dependsOn)
      ),
    [nodes]
  );
}

/** Position and width of the given nodes, as a string so the selector result compares by value */
function useNodeGeometryKey(nodeIds: string[]): string {
  const selector = useCallback(
    (state: ReactFlowState) =>
      nodeIds
        .map((id) => {
          const node = state.nodeLookup.get(id);
          if (!node || node.hidden === true) return "";
          const { x, y } = node.internals.positionAbsolute;
          return `${id}|${x}|${y}|${node.measured.width ?? NODE_ICON_SIZE}`;
        })
        .join("\n"),
    [nodeIds]
  );
  return useStore(selector);
}

function parseGeometry(key: string): Map<string, { x: number; y: number; width: number }> {
  const result = new Map<string, { x: number; y: number; width: number }>();
  for (const line of key.split("\n")) {
    if (line === "") continue;
    const [id, x, y, width] = line.split("|");
    result.set(id, { x: Number(x), y: Number(y), width: Number(width) });
  }
  return result;
}

interface ArrowPath {
  arrow: WaitForArrow;
  path: string;
  labelX: number;
  labelY: number;
}

function buildArrowPath(arrow: WaitForArrow, source: NodeRect, target: NodeRect): ArrowPath {
  const { sx: sourceX, sy: sourceY, tx: targetX, ty: targetY } = getEdgePoints(source, target);
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const length = Math.hypot(dx, dy) || 1;
  // Bow to the left of the travel direction, so A->B and B->A do not overlap
  const midX = (sourceX + targetX) / 2 - (dy / length) * CURVE_OFFSET;
  const midY = (sourceY + targetY) / 2 + (dx / length) * CURVE_OFFSET;
  // Control point that makes the quadratic curve pass through (midX, midY)
  const controlX = 2 * midX - (sourceX + targetX) / 2;
  const controlY = 2 * midY - (sourceY + targetY) / 2;
  return {
    arrow,
    path: `M ${sourceX} ${sourceY} Q ${controlX} ${controlY} ${targetX} ${targetY}`,
    labelX: midX,
    labelY: midY
  };
}

const LABEL_FONT_SIZE = 9;
const LABEL_LINE_HEIGHT = 11;
/** Rough glyph width of the label font, enough to size the background */
const LABEL_CHAR_WIDTH = 5.2;
const LABEL_PADDING_X = 4;
const LABEL_PADDING_Y = 2;

/** Stage pairs on a solid pill, so the dashed line does not run through the text */
const WaitForLabel: React.FC<{ labels: string[]; x: number; y: number }> = ({ labels, x, y }) => {
  const longest = Math.max(...labels.map((label) => label.length));
  const width = longest * LABEL_CHAR_WIDTH + LABEL_PADDING_X * 2;
  const height = labels.length * LABEL_LINE_HEIGHT + LABEL_PADDING_Y * 2;
  const firstLineY = y - ((labels.length - 1) * LABEL_LINE_HEIGHT) / 2;
  return (
    <>
      <rect
        x={x - width / 2}
        y={y - height / 2}
        width={width}
        height={height}
        rx={3}
        fill={LABEL_BG_COLOR}
        stroke={ARROW_COLOR}
        strokeWidth={0.75}
      />
      <text
        x={x}
        y={firstLineY}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={LABEL_FONT_SIZE}
        fill={LABEL_TEXT_COLOR}
      >
        {labels.map((label, index) => (
          <tspan key={label} x={x} dy={index === 0 ? 0 : LABEL_LINE_HEIGHT}>
            {label}
          </tspan>
        ))}
      </text>
    </>
  );
};

const WaitForArrows: React.FC<{ arrows: WaitForArrow[] }> = ({ arrows }) => {
  const nodeStyle = useNodeStyle();
  const nodeBoxSpacing = useNodeBoxSpacing();
  const iconSize = useTopoViewerStore((state) =>
    state.linkLabelMode === "telemetry-style"
      ? clampTelemetryNodeSizePx(state.telemetryNodeSizePx)
      : NODE_ICON_SIZE
  );
  const nodeIds = useMemo(
    () => [...new Set(arrows.flatMap((arrow) => [arrow.from, arrow.to]))].sort(),
    [arrows]
  );
  const geometryKey = useNodeGeometryKey(nodeIds);

  const paths = useMemo(() => {
    const geometry = parseGeometry(geometryKey);
    const rectOf = (id: string): NodeRect | undefined => {
      const node = geometry.get(id);
      if (!node) return undefined;
      return getNodeConnectionRect(
        {
          x: node.x + (node.width - iconSize) / 2,
          y: node.y,
          width: iconSize,
          height: iconSize
        },
        nodeStyle,
        iconSize,
        nodeBoxSpacing
      );
    };
    const result: ArrowPath[] = [];
    for (const arrow of arrows) {
      const source = rectOf(arrow.from);
      const target = rectOf(arrow.to);
      if (source && target) result.push(buildArrowPath(arrow, source, target));
    }
    return result;
  }, [arrows, geometryKey, iconSize, nodeStyle, nodeBoxSpacing]);

  if (paths.length === 0) return null;

  return (
    <svg
      data-testid="wait-for-overlay"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        overflow: "visible",
        pointerEvents: "none"
      }}
    >
      <defs>
        <marker
          id={ARROW_MARKER_ID}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={ARROW_COLOR} />
        </marker>
      </defs>
      {paths.map(({ arrow, path, labelX, labelY }) => (
        <g key={arrow.key} data-testid="wait-for-arrow" data-from={arrow.from} data-to={arrow.to}>
          <title>{arrow.titles.join("\n")}</title>
          <path
            d={path}
            fill="none"
            stroke={ARROW_COLOR}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            markerEnd={`url(#${ARROW_MARKER_ID})`}
          />
          <WaitForLabel labels={arrow.labels} x={labelX} y={labelY} />
        </g>
      ))}
    </svg>
  );
};

const WaitForOverlayContent: React.FC = () => {
  const arrows = useWaitForArrows();
  if (arrows.length === 0) return null;
  return (
    <ViewportPortal>
      <WaitForArrows arrows={arrows} />
    </ViewportPortal>
  );
};

/** Wait-for arrows in flow coordinates; shown when turned on in the Links menu */
export const WaitForOverlay: React.FC = () => {
  const show = useTopoViewerStore((state) => state.showWaitFor);
  return show ? <WaitForOverlayContent /> : null;
};
