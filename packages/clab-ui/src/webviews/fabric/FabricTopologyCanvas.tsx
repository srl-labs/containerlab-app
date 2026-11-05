/** The fabric's drawing: tiers, cables, clients and health, with pan, zoom and fit. */
import Box from "@mui/material/Box";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { MONO_FONT_FAMILY } from "../../theme/typography";
import { vscodePalette } from "../../theme/vscodePalette";

import { formatBps } from "./fabricFormat";
import {
  CLIENT_HEIGHT,
  CLIENT_WIDTH,
  NODE_WIDTH,
  cablePath,
  fitView,
  trafficLevel,
  zoomView,
  type FabricTopologyLayout,
  type FabricTrafficLevel
} from "./fabricTopologyLayout";
import type { FabricAttachedClient, FabricLink, FabricTopologyNode } from "./fabricTypes";
import { tint, toneColor } from "./fabricUi";

export type FabricColorMode = "health" | "traffic";

export interface FabricSelection {
  type: "node" | "link" | "client";
  id: string;
}

export function linkId(link: Pick<FabricLink, "a" | "b">): string {
  return `${link.a}|${link.b}`;
}

const MUTED_CABLE = tint(vscodePalette.text.secondary, 60);
const FOCUS = "var(--clab-ui-focus-border, var(--vscode-focusBorder))";
const FOCUS_SX = { outline: "none", "&:focus-visible > .fabric-outline": { stroke: FOCUS, strokeWidth: 2 } } as const;
const ORANGE = "var(--vscode-charts-orange, #d18616)";

const TRAFFIC_COLORS: Readonly<Record<FabricTrafficLevel, string>> = {
  none: tint(vscodePalette.text.secondary, 45),
  low: toneColor("good"),
  medium: toneColor("warn"),
  high: ORANGE,
  full: toneColor("bad")
};

function healthColor(health: string | undefined): string {
  if (health === "error") return toneColor("bad");
  if (health === "warning") return toneColor("warn");
  if (health === "info") return toneColor("info");
  return health === "ok" ? toneColor("good") : toneColor("neutral");
}

function cableColor(state: string): string {
  if (state === "mixed") return toneColor("warn");
  if (state === "down" || state === "lost") return toneColor("bad");
  return MUTED_CABLE;
}

function clipped(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** Clicks and the keyboard for a thing in the drawing. */
function selectable(label: string, selection: FabricSelection, onSelect: (selection: FabricSelection) => void) {
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      onSelect(selection);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(selection);
      }
    }
  };
}

function Badge({ x, y, count, color }: { x: number; y: number; count: number; color: string }): React.JSX.Element {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-9} y={-8} width={18} height={16} rx={4} style={{ fill: color }} />
      <text textAnchor="middle" dy="0.35em" style={{ fill: vscodePalette.background.default, fontSize: 10, fontWeight: 700 }}>{count}</text>
    </g>
  );
}

function NodeBox({ node, height, x, y, selected, dimmed, onSelect }: {
  node: FabricTopologyNode;
  height: number;
  x: number;
  y: number;
  selected: boolean;
  dimmed: boolean;
  onSelect: (selection: FabricSelection) => void;
}): React.JSX.Element {
  const { error = 0, warning = 0 } = node.findings ?? {};
  const unreachable = Boolean(node.unreachable);
  const lines = [
    node.type ? { text: node.type, mono: false } : undefined,
    node.ipv4 ? { text: node.ipv4, mono: true } : undefined,
    node.ipv6 ? { text: node.ipv6, mono: true } : undefined,
    node.asn !== null && node.asn !== undefined ? { text: `AS ${node.asn}`, mono: false } : undefined
  ].filter((line) => line !== undefined);
  return (
    <Box
      component="g"
      data-testid={`fabric-topology-node-${node.name}`}
      data-health={node.health}
      transform={`translate(${x - NODE_WIDTH / 2},${y - height / 2})`}
      {...selectable(`Node ${node.name}`, { type: "node", id: node.name }, onSelect)}
      sx={{ cursor: "pointer", opacity: dimmed ? 0.3 : 1, transition: "opacity 120ms ease", ...FOCUS_SX }}
    >
      <rect
        className="fabric-outline"
        width={NODE_WIDTH}
        height={height}
        rx={6}
        style={{
          fill: vscodePalette.background.paper,
          stroke: selected ? FOCUS : vscodePalette.divider,
          strokeWidth: selected ? 2 : 1,
          ...(unreachable ? { strokeDasharray: "5 3" } : {})
        }}
      />
      <rect x={1} y={1} width={3.5} height={height - 2} rx={1.5} style={{ fill: unreachable ? toneColor("neutral") : healthColor(node.health) }} />
      <text x={12} y={19} style={{ fill: vscodePalette.text.primary, fontSize: 13, fontWeight: 600 }}>
        {clipped(node.name, 17)}
        <title>{node.name}</title>
      </text>
      {lines.map((line, index) => (
        <text
          key={line.text}
          x={12}
          y={33 + index * 13.5}
          style={{ fill: vscodePalette.text.secondary, fontSize: line.mono ? 10.5 : 11, ...(line.mono ? { fontFamily: MONO_FONT_FAMILY } : {}) }}
        >
          {clipped(line.text, 24)}
        </text>
      ))}
      {error > 0 ? <Badge x={NODE_WIDTH - (warning > 0 ? 34 : 14)} y={14} count={error} color={toneColor("bad")} /> : null}
      {warning > 0 ? <Badge x={NODE_WIDTH - 14} y={14} count={warning} color={toneColor("warn")} /> : null}
    </Box>
  );
}

function ClientBox({ client, x, y, selected, dimmed, onSelect }: {
  client: FabricAttachedClient;
  x: number;
  y: number;
  selected: boolean;
  dimmed: boolean;
  onSelect: (selection: FabricSelection) => void;
}): React.JSX.Element {
  return (
    <Box
      component="g"
      data-testid={`fabric-topology-client-${client.id}`}
      transform={`translate(${x - CLIENT_WIDTH / 2},${y - CLIENT_HEIGHT / 2})`}
      {...selectable(`Client ${client.label}`, { type: "client", id: client.id }, onSelect)}
      sx={{ cursor: "pointer", opacity: dimmed ? 0.3 : 1, transition: "opacity 120ms ease", ...FOCUS_SX }}
    >
      <rect
        className="fabric-outline"
        width={CLIENT_WIDTH}
        height={CLIENT_HEIGHT}
        rx={15}
        style={{ fill: vscodePalette.background.default, stroke: selected ? FOCUS : vscodePalette.divider, strokeWidth: selected ? 2 : 1 }}
      />
      <text x={CLIENT_WIDTH / 2} y={CLIENT_HEIGHT / 2} textAnchor="middle" dy="0.35em" style={{ fill: vscodePalette.text.primary, fontSize: 11 }}>
        {clipped(client.label, 18)}
        <title>{client.label}</title>
      </text>
    </Box>
  );
}

function LinkPath({ link, layout, mode, fullBps, selected, dimmed, onSelect }: {
  link: FabricLink;
  layout: FabricTopologyLayout;
  mode: FabricColorMode;
  fullBps: number;
  selected: boolean;
  dimmed: boolean;
  onSelect: (selection: FabricSelection) => void;
}): React.JSX.Element | null {
  const [from, to] = [layout.nodes.get(link.a), layout.nodes.get(link.b)];
  if (!from || !to) return null;
  const path = cablePath(from, to, layout.nodeHeight);
  const lost = link.state === "lost";
  const width = selected ? 3 : 2;
  const aBps = link.cables.reduce<number | null>((sum, cable) => (cable.a_out_bps === null || cable.a_out_bps === undefined ? sum : (sum ?? 0) + cable.a_out_bps), null);
  const bBps = link.cables.reduce<number | null>((sum, cable) => (cable.b_out_bps === null || cable.b_out_bps === undefined ? sum : (sum ?? 0) + cable.b_out_bps), null);
  const traffic = mode === "traffic" && !lost;
  return (
    <Box
      component="g"
      data-testid={`fabric-topology-link-${linkId(link)}`}
      data-state={link.state}
      {...selectable(`Cable ${link.a} to ${link.b}, ${link.state}`, { type: "link", id: linkId(link) }, onSelect)}
      sx={{ cursor: "pointer", opacity: dimmed ? 0.2 : 1, transition: "opacity 120ms ease", outline: "none", "&:focus-visible .fabric-link-focus": { stroke: FOCUS } }}
    >
      <path d={path.d} fill="none" style={{ stroke: "transparent", strokeWidth: 14 }}>
        <title>{`${link.a} → ${link.b}: ${formatBps(aBps)}\n${link.b} → ${link.a}: ${formatBps(bBps)}`}</title>
      </path>
      <path className="fabric-link-focus" d={path.d} fill="none" style={{ stroke: "transparent", strokeWidth: 5 }} />
      {traffic ? (
        path.halves.map((half, index) => {
          const level = trafficLevel(index === 0 ? aBps : bBps, fullBps);
          return (
            <path
              key={half}
              d={half}
              fill="none"
              style={{ stroke: TRAFFIC_COLORS[level], strokeWidth: width, ...(level === "none" ? { strokeDasharray: "2 3" } : {}) }}
            />
          );
        })
      ) : (
        <path
          d={path.d}
          fill="none"
          style={{ stroke: selected ? FOCUS : cableColor(link.state), strokeWidth: width, ...(lost ? { strokeDasharray: "6 4" } : {}) }}
        />
      )}
      {link.count > 1 ? (
        <g transform={`translate(${path.mid.x},${path.mid.y})`}>
          <rect x={-11} y={-8} width={22} height={16} rx={4} style={{ fill: vscodePalette.background.default, stroke: vscodePalette.divider }} />
          <text textAnchor="middle" dy="0.35em" style={{ fill: vscodePalette.text.secondary, fontSize: 10 }}>×{link.count}</text>
        </g>
      ) : null}
    </Box>
  );
}

function clientLinkPath(client: { x: number; y: number }, node: { x: number; y: number }, nodeHeight: number): string {
  const [fromY, toY] = [node.y + nodeHeight / 2, client.y - CLIENT_HEIGHT / 2];
  const middle = (fromY + toY) / 2;
  return `M${node.x},${fromY} C${node.x},${middle} ${client.x},${middle} ${client.x},${toY}`;
}

/** What a selection touches, the rest dims. */
function touchedBy(selection: FabricSelection | undefined, links: readonly FabricLink[], clients: readonly FabricAttachedClient[]) {
  const nodes = new Set<string>();
  const linkIds = new Set<string>();
  const clientIds = new Set<string>();
  if (selection?.type === "node") {
    nodes.add(selection.id);
    for (const link of links) {
      if (link.a === selection.id || link.b === selection.id) {
        linkIds.add(linkId(link));
        nodes.add(link.a);
        nodes.add(link.b);
      }
    }
    for (const client of clients) if (client.nodes.includes(selection.id)) clientIds.add(client.id);
  } else if (selection?.type === "link") {
    linkIds.add(selection.id);
    for (const name of selection.id.split("|")) nodes.add(name);
  } else if (selection?.type === "client") {
    clientIds.add(selection.id);
    for (const name of clients.find((client) => client.id === selection.id)?.nodes ?? []) nodes.add(name);
  }
  return { nodes, linkIds, clientIds };
}

interface View {
  x: number;
  y: number;
  k: number;
}

export interface FabricCanvasHandle {
  fit: () => void;
}

export function FabricTopologyCanvas({ nodes, links, clients, layout, mode, fullBps, selection, onSelect, onClear, handle }: {
  nodes: readonly FabricTopologyNode[];
  links: readonly FabricLink[];
  clients: readonly FabricAttachedClient[];
  layout: FabricTopologyLayout;
  mode: FabricColorMode;
  fullBps: number;
  selection: FabricSelection | undefined;
  onSelect: (selection: FabricSelection) => void;
  onClear: () => void;
  handle: React.MutableRefObject<FabricCanvasHandle | null>;
}): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const moved = useRef(false);
  const drag = useRef<{ x: number; y: number; viewX: number; viewY: number; pointer: number; dragged: boolean } | undefined>(undefined);
  const dimensions = useRef(layout);
  dimensions.current = layout;

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    moved.current = false;
    const { width, height } = svg.getBoundingClientRect();
    setView(fitView(dimensions.current, { width, height }));
  }, []);

  useEffect(() => {
    handle.current = { fit };
    return () => {
      handle.current = null;
    };
  }, [fit, handle]);

  // Until the drawing was moved by hand, it follows the room it has and what it holds.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const observer = new ResizeObserver(() => {
      if (!moved.current) fit();
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [fit]);
  useLayoutEffect(() => {
    if (!moved.current) fit();
  }, [fit, layout.width, layout.height]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      moved.current = true;
      const rect = svg.getBoundingClientRect();
      const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setView((current) => zoomView(current, Math.exp(-event.deltaY * 0.0015), at));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const touched = useMemo(() => touchedBy(selection, links, clients), [selection, links, clients]);
  const anySelected = selection !== undefined;

  return (
    <Box
      component="svg"
      ref={svgRef}
      role="group"
      aria-label="Fabric topology"
      data-testid="fabric-topology-canvas"
      onPointerDown={(event: React.PointerEvent<SVGSVGElement>) => {
        if (event.button !== 0) return;
        drag.current = { x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y, pointer: event.pointerId, dragged: false };
      }}
      onPointerMove={(event: React.PointerEvent<SVGSVGElement>) => {
        const current = drag.current;
        if (!current) return;
        const [dx, dy] = [event.clientX - current.x, event.clientY - current.y];
        if (!current.dragged && Math.hypot(dx, dy) < 4) return;
        if (!current.dragged) event.currentTarget.setPointerCapture(current.pointer);
        current.dragged = true;
        moved.current = true;
        setView((previous) => ({ ...previous, x: current.viewX + dx, y: current.viewY + dy }));
      }}
      onPointerUp={() => {
        // After a drag the click belongs to no one.
        const dragged = drag.current?.dragged === true;
        drag.current = undefined;
        if (dragged) {
          const swallow = (event: Event) => event.stopPropagation();
          window.addEventListener("click", swallow, { capture: true, once: true });
          setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
        }
      }}
      onClick={onClear}
      sx={{ display: "block", width: "100%", height: "100%", cursor: "grab", touchAction: "none", userSelect: "none", "&:active": { cursor: "grabbing" } }}
    >
      <g transform={`translate(${view.x},${view.y}) scale(${view.k})`} style={{ fontFamily: "inherit" }}>
        {layout.titles.map((title) => (
          <text key={title.name} x={32} y={title.y} style={{ fill: vscodePalette.text.primary, fontSize: 12, fontWeight: 600 }}>{title.name}</text>
        ))}
        {layout.labels.map((label) => (
          <text key={label.key} x={label.x} y={label.y} dy="0.35em" style={{ fill: vscodePalette.text.secondary, fontSize: 11 }}>{label.text}</text>
        ))}
        {clients.map((client) => {
          const point = layout.clients.get(client.id);
          if (!point) return null;
          return client.nodes.map((name) => {
            const node = layout.nodes.get(name);
            if (!node) return null;
            const dimmed = anySelected && !touched.clientIds.has(client.id);
            return (
              <path
                key={`${client.id}|${name}`}
                d={clientLinkPath(point, node, layout.nodeHeight)}
                fill="none"
                style={{ stroke: MUTED_CABLE, strokeWidth: 1, opacity: dimmed ? 0.2 : 0.8 }}
              />
            );
          });
        })}
        {links.map((link) => (
          <LinkPath
            key={linkId(link)}
            link={link}
            layout={layout}
            mode={mode}
            fullBps={fullBps}
            selected={selection?.type === "link" && selection.id === linkId(link)}
            dimmed={anySelected && !touched.linkIds.has(linkId(link))}
            onSelect={onSelect}
          />
        ))}
        {nodes.map((node) => {
          const point = layout.nodes.get(node.name);
          if (!point) return null;
          return (
            <NodeBox
              key={node.name}
              node={node}
              height={layout.nodeHeight}
              x={point.x}
              y={point.y}
              selected={selection?.type === "node" && selection.id === node.name}
              dimmed={anySelected && !touched.nodes.has(node.name)}
              onSelect={onSelect}
            />
          );
        })}
        {clients.map((client) => {
          const point = layout.clients.get(client.id);
          if (!point) return null;
          return (
            <ClientBox
              key={client.id}
              client={client}
              x={point.x}
              y={point.y}
              selected={selection?.type === "client" && selection.id === client.id}
              dimmed={anySelected && !touched.clientIds.has(client.id)}
              onSelect={onSelect}
            />
          );
        })}
      </g>
    </Box>
  );
}

export { TRAFFIC_COLORS, MUTED_CABLE, healthColor };
