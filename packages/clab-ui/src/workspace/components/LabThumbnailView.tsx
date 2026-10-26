import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import Box from "@mui/material/Box";
import { useTheme, type Theme } from "@mui/material/styles";

import { DEFAULT_ICON_COLOR, getRoleIcon } from "../../core/types/graph";
import { useIconInk } from "../../icons/iconInk";
import { generateEncodedSVG } from "../../icons/SvgGenerator";
import { CPU_LOAD_COLORS, cpuLoadLevel, formatPercent } from "../../utils/resourceUsage";
import type { LabNodeRunState, LabOverviewCard, LabThumbnailSources } from "../state/labsOverview";
import {
  buildLabThumbnail,
  circleThumbnail,
  LAB_THUMBNAIL_HEIGHT,
  LAB_THUMBNAIL_LABEL_SIZE,
  LAB_THUMBNAIL_WIDTH,
  type LabThumbnail,
  type LabThumbnailNode
} from "../state/labThumbnail";
import type { LabNodeUsage } from "../state/labUsage";

/** Below this size an icon is a colored square. */
const ICON_MIN_SIZE = 10;
const LABEL_MAX_CHARS = 14;
const CPU_BAR_HEIGHT = 2.5;
const CPU_BAR_GAP = 2;
// Parsed thumbnails of the current sources revision; older revisions are dropped.
const cache = new Map<string, Promise<LabThumbnail | undefined>>();
let cachedRevision = -1;

function loadThumbnail(
  card: LabOverviewCard,
  revision: number,
  loadSources: (card: LabOverviewCard) => Promise<LabThumbnailSources | undefined>
): Promise<LabThumbnail | undefined> {
  if (revision !== cachedRevision) {
    cache.clear();
    cachedRevision = revision;
  }
  const key = `${card.id}\n${card.path ?? ""}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = loadSources(card)
      .then((sources) => (sources ? buildLabThumbnail(sources.yaml, sources.annotations) : undefined))
      .catch(() => undefined);
    cache.set(key, pending);
  }
  return pending;
}

function shortLabel(label: string): string {
  return label.length > LABEL_MAX_CHARS ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…` : label;
}

function stateColor(theme: Theme, state: LabNodeRunState | undefined): string | undefined {
  if (state === "starting") return theme.palette.warning.main;
  if (state === "down") return theme.palette.error.main;
  return undefined;
}

interface NodeMarkProps {
  node: LabThumbnailNode;
  size: number;
  ink: string;
  showLabel: boolean;
  /** Undefined for labs nobody deployed. */
  state: LabNodeRunState | undefined;
  usage: LabNodeUsage | undefined;
  theme: Theme;
}

/** A node as the canvas draws it: its icon, a dot when it is not ready, its CPU load and name. */
function NodeMark({ node, size, ink, showLabel, state, usage, theme }: NodeMarkProps) {
  const half = size / 2;
  const color = node.iconColor ?? DEFAULT_ICON_COLOR;
  const cpu = usage?.cpuPercent;
  const loadColor = cpu === undefined ? undefined : CPU_LOAD_COLORS[cpuLoadLevel(cpu)];
  const dotColor = stateColor(theme, state);
  const title = [node.label, cpu === undefined ? undefined : `CPU ${formatPercent(cpu)}`].filter(Boolean).join(" · ");
  const opacity = state === "down" ? 0.4 : 1;
  if (size < ICON_MIN_SIZE) {
    return (
      <rect
        data-node={node.id}
        x={node.x - half}
        y={node.y - half}
        width={size}
        height={size}
        rx={size / 4}
        style={{ fill: dotColor ?? loadColor ?? color }}
        opacity={opacity}
      >
        <title>{title}</title>
      </rect>
    );
  }
  const barY = node.y + half + CPU_BAR_GAP;
  const labelY = (loadColor !== undefined ? barY + CPU_BAR_HEIGHT : node.y + half) + 2 + LAB_THUMBNAIL_LABEL_SIZE * 0.85;
  return (
    <g data-node={node.id} data-cpu={cpu === undefined ? undefined : Math.round(cpu)}>
      <title>{title}</title>
      {/* Links end at the icon, as on the canvas, instead of showing through it. */}
      <circle cx={node.x} cy={node.y} r={half * 0.86} style={{ fill: theme.palette.background.default }} />
      <image
        href={generateEncodedSVG(getRoleIcon(node.role), color, ink)}
        x={node.x - half}
        y={node.y - half}
        width={size}
        height={size}
        opacity={opacity}
      />
      {dotColor !== undefined ? (
        <circle
          cx={node.x + half * 0.8}
          cy={node.y - half * 0.8}
          r={Math.max(2, Math.min(3.5, size * 0.15))}
          style={{ fill: dotColor, stroke: theme.palette.background.default }}
          strokeWidth={1}
        />
      ) : null}
      {loadColor !== undefined && cpu !== undefined ? (
        <g data-testid="lab-thumbnail-cpu">
          <rect x={node.x - half} y={barY} width={size} height={CPU_BAR_HEIGHT} rx={1} style={{ fill: theme.palette.text.disabled }} opacity={0.35} />
          <rect x={node.x - half} y={barY} width={size * Math.min(100, cpu) / 100} height={CPU_BAR_HEIGHT} rx={1} style={{ fill: loadColor }} />
        </g>
      ) : null}
      {showLabel ? (
        <text
          x={node.x}
          y={labelY}
          textAnchor="middle"
          fontSize={LAB_THUMBNAIL_LABEL_SIZE}
          style={{
            fill: theme.palette.text.secondary,
            stroke: theme.palette.background.default,
            strokeWidth: 2.5,
            paintOrder: "stroke",
            strokeLinejoin: "round"
          }}
        >
          {shortLabel(node.label)}
        </text>
      ) : null}
    </g>
  );
}

function Annotations({ thumbnail, theme }: { thumbnail: LabThumbnail; theme: Theme }) {
  return (
    <>
      {thumbnail.groups.map((group, index) => (
        <g key={`group-${index}`} data-group="">
          <rect
            x={group.x}
            y={group.y}
            width={group.width}
            height={group.height}
            rx={group.radius}
            style={{ fill: group.fill ?? theme.palette.action.hover, stroke: group.stroke ?? theme.palette.text.secondary }}
            fillOpacity={group.fill === undefined ? 1 : group.fillOpacity ?? 0.2}
            strokeOpacity={0.55}
            strokeWidth={1}
            strokeDasharray={group.dashed ? "3 2" : undefined}
          />
          {group.label !== undefined ? (
            <text
              x={group.x + 4}
              y={group.y + 9}
              fontSize={7}
              style={{ fill: theme.palette.text.secondary, stroke: theme.palette.background.default, strokeWidth: 2, paintOrder: "stroke" }}
            >
              {group.label}
            </text>
          ) : null}
        </g>
      ))}
      {thumbnail.shapes.map((shape, index) => {
        const stroke = shape.stroke ?? theme.palette.text.secondary;
        const paint = {
          style: { fill: shape.fill ?? "none", stroke },
          fillOpacity: shape.fillOpacity ?? 1,
          strokeOpacity: 0.7,
          strokeWidth: 1,
          strokeDasharray: shape.dashed ? "3 2" : undefined
        };
        if (shape.type === "line") {
          return <line key={`shape-${index}`} data-shape="line" x1={shape.x} y1={shape.y} x2={shape.x2} y2={shape.y2} {...paint} />;
        }
        if (shape.type === "circle") {
          return (
            <ellipse
              key={`shape-${index}`}
              data-shape="circle"
              cx={shape.x + shape.width / 2}
              cy={shape.y + shape.height / 2}
              rx={shape.width / 2}
              ry={shape.height / 2}
              {...paint}
            />
          );
        }
        return <rect key={`shape-${index}`} data-shape="rectangle" x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.radius} {...paint} />;
      })}
      {thumbnail.texts.map((text, index) => (
        <text
          key={`text-${index}`}
          data-text=""
          x={text.x}
          y={text.y + text.fontSize * 0.9}
          fontSize={text.fontSize}
          style={{ fill: text.color ?? theme.palette.text.secondary }}
        >
          {text.text}
        </text>
      ))}
    </>
  );
}

const ThumbnailDrawing = memo(function ThumbnailDrawing({ thumbnail, card, usage }: {
  thumbnail: LabThumbnail;
  card: LabOverviewCard;
  usage?: Record<string, LabNodeUsage>;
}) {
  const theme = useTheme();
  const ink = useIconInk();
  const centers = useMemo(() => new Map(thumbnail.nodes.map((node) => [node.id, node])), [thumbnail]);
  const deployed = card.state !== "undeployed";
  return (
    <Box
      component="svg"
      viewBox={`0 0 ${LAB_THUMBNAIL_WIDTH} ${LAB_THUMBNAIL_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", fontFamily: "inherit" }}
    >
      <Annotations thumbnail={thumbnail} theme={theme} />
      <g style={{ stroke: theme.palette.text.secondary }} strokeOpacity={0.5} strokeWidth={1.2} data-links="">
        {thumbnail.links.map((link) => {
          const source = centers.get(link.source);
          const target = centers.get(link.target);
          return source && target ? (
            <line key={`${link.source}\n${link.target}`} data-link="" x1={source.x} y1={source.y} x2={target.x} y2={target.y} />
          ) : null;
        })}
      </g>
      {thumbnail.nodes.map((node) => (
        <NodeMark
          key={node.id}
          node={node}
          size={thumbnail.nodeSize}
          ink={ink}
          showLabel={thumbnail.showLabels}
          state={deployed ? card.nodes[node.id] : undefined}
          usage={usage?.[node.id]}
          theme={theme}
        />
      ))}
    </Box>
  );
});

/** A miniature of the lab's canvas, drawn from its topology file once the card scrolls into view. */
export function LabThumbnailView({ card, loadSources, revision, seen, usage }: {
  card: LabOverviewCard;
  loadSources: (card: LabOverviewCard) => Promise<LabThumbnailSources | undefined>;
  revision: number;
  /** The card came into view; nothing loads before. */
  seen: boolean;
  /** CPU and memory of the running nodes, by node name. */
  usage?: Record<string, LabNodeUsage>;
}) {
  const [result, setResult] = useState<{ key: string; thumbnail: LabThumbnail | undefined } | null>(null);
  const key = `${revision}\n${card.id}\n${card.path ?? ""}`;
  // Cards are rebuilt on every runtime update; only a different file loads again.
  const cardRef = useRef(card);
  useEffect(() => {
    cardRef.current = card;
  });

  useEffect(() => {
    if (!seen) return undefined;
    let cancelled = false;
    void loadThumbnail(cardRef.current, revision, loadSources).then((thumbnail) => {
      if (!cancelled) setResult({ key, thumbnail });
    });
    return () => {
      cancelled = true;
    };
  }, [key, loadSources, revision, seen]);

  const nodeNames = Object.keys(card.nodes).join("\n");
  const fallback = useMemo(() => circleThumbnail(nodeNames ? nodeNames.split("\n") : []), [nodeNames]);
  // Keep the previous drawing while a changed file reloads, instead of flashing empty.
  const thumbnail = result?.thumbnail ?? (result ? fallback : undefined);

  return (
    <Box
      aria-hidden="true"
      data-testid="lab-card-thumbnail"
      data-loaded={result?.key === key ? "true" : "false"}
      sx={(theme) => ({
        position: "relative", width: "100%", aspectRatio: `${LAB_THUMBNAIL_WIDTH} / ${LAB_THUMBNAIL_HEIGHT}`,
        bgcolor: "background.default",
        // The canvas's dot grid, faint.
        backgroundImage: `radial-gradient(circle, color-mix(in srgb, ${theme.palette.text.secondary} 22%, transparent) 0.8px, transparent 1px)`,
        backgroundSize: "14px 14px",
        backgroundPosition: "7px 7px"
      })}
    >
      {thumbnail ? (
        <ThumbnailDrawing thumbnail={thumbnail} card={card} usage={usage} />
      ) : (
        <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "text.disabled" }}>
          <AccountTreeOutlinedIcon sx={{ fontSize: 28, opacity: result ? 0.8 : 0.4 }} />
        </Box>
      )}
    </Box>
  );
}
