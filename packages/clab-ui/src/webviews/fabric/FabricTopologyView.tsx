/** The topology view: the drawing, its controls and legend, and the panel of what is selected. */
import FitScreenIcon from "@mui/icons-material/FitScreen";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { floatingRadius, floatingShadow, floatingSurfaceSx, overlayShadow } from "../../theme/surfaces";

import { FabricTopologyCanvas, MUTED_CABLE, TRAFFIC_COLORS, healthColor, type FabricCanvasHandle, type FabricColorMode, type FabricSelection } from "./FabricTopologyCanvas";
import { FabricTopologyDetails } from "./FabricTopologyDetails";
import { useFabric } from "./fabricContext";
import { plural } from "./fabricFormat";
import { layoutTopology } from "./fabricTopologyLayout";
import { EmptyState, LoadingNote, toneColor } from "./fabricUi";

const TRAFFIC_REFRESH_MS = 10_000;
const DETAILS_WIDTH = 320;
const PREFERENCES_KEY = "clab.fabric.topology.v1";

const LINK_RATES: ReadonlyArray<readonly [number, string]> = [
  [1e6, "1 Mbps"],
  [1e7, "10 Mbps"],
  [1e8, "100 Mbps"],
  [1e9, "1 Gbps"],
  [1e10, "10 Gbps"]
];

interface TopologyPreferences {
  mode: FabricColorMode;
  fullBps: number;
  clients: boolean;
}

const DEFAULT_PREFERENCES: TopologyPreferences = { mode: "health", fullBps: 1e7, clients: false };

function readPreferences(): TopologyPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null") as Partial<TopologyPreferences> | null;
    return { ...DEFAULT_PREFERENCES, ...value };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function persistPreferences(preferences: TopologyPreferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Storage can be disabled.
  }
}

function selectionOf(query: Readonly<Record<string, string>>): FabricSelection | undefined {
  if (query.node) return { type: "node", id: query.node };
  if (query.link) return { type: "link", id: query.link };
  if (query.client) return { type: "client", id: query.client };
  return undefined;
}

function LegendItem({ color, dashed = false, label, round = false }: { color: string; dashed?: boolean; label: string; round?: boolean }): React.JSX.Element {
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      {round ? (
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color }} />
      ) : (
        <Box sx={{ width: 16, borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}` }} />
      )}
      <Typography variant="caption" sx={{ color: "text.secondary", fontSize: 11 }}>{label}</Typography>
    </Box>
  );
}

function Legend({ mode }: { mode: FabricColorMode }): React.JSX.Element {
  return (
    <Box
      data-testid="fabric-topology-legend"
      sx={{
        ...floatingSurfaceSx, position: "absolute", left: 8, bottom: 8, display: "flex", gap: 1.25, flexWrap: "wrap", maxWidth: "calc(100% - 16px)",
        px: 1, py: 0.5, borderRadius: floatingRadius, boxShadow: floatingShadow
      }}
    >
      {mode === "health" ? (
        <>
          <LegendItem round color={healthColor("ok")} label="Healthy" />
          <LegendItem round color={healthColor("warning")} label="Warning" />
          <LegendItem round color={healthColor("error")} label="Error" />
          <LegendItem color={MUTED_CABLE} label="Up" />
          <LegendItem color={toneColor("warn")} label="Mixed" />
          <LegendItem color={toneColor("bad")} label="Down" />
          <LegendItem dashed color={toneColor("bad")} label="Lost" />
        </>
      ) : (
        <>
          <LegendItem color={TRAFFIC_COLORS.low} label="Under 25%" />
          <LegendItem color={TRAFFIC_COLORS.medium} label="To 50%" />
          <LegendItem color={TRAFFIC_COLORS.high} label="To 75%" />
          <LegendItem color={TRAFFIC_COLORS.full} label="Above" />
          <LegendItem dashed color={TRAFFIC_COLORS.none} label="No rate yet" />
        </>
      )}
    </Box>
  );
}

export function FabricTopologyView(): React.JSX.Element {
  const { topology, coreError, route, go, at, reloadCore, labName } = useFabric();
  const narrow = useMediaQuery("(max-width: 760px)");
  const [preferences, setPreferences] = useState(readPreferences);
  const canvas = useRef<FabricCanvasHandle | null>(null);
  const selection = selectionOf(route.query);
  const showClients = preferences.clients || route.query.clients === "1" || selection?.type === "client";
  const update = (change: Partial<TopologyPreferences>) => {
    const next = { ...preferences, ...change };
    setPreferences(next);
    persistPreferences(next);
  };

  // Rates change with every poll, yet are no history: no event announces them.
  const traffic = preferences.mode === "traffic" && at === undefined;
  useEffect(() => {
    if (!traffic) return undefined;
    const timer = setInterval(reloadCore, TRAFFIC_REFRESH_MS);
    return () => clearInterval(timer);
  }, [traffic, reloadCore]);

  const layout = useMemo(() => (topology ? layoutTopology(topology, showClients) : undefined), [topology, showClients]);
  const clients = useMemo(() => (showClients ? topology?.clients ?? [] : []), [topology, showClients]);

  if (!topology || !layout) {
    return coreError
      // The error itself is said above the view.
      ? <EmptyState icon={<HubOutlinedIcon />} title="Nothing to draw" detail="The fabric could not be read." />
      : <Box sx={{ p: 2 }}><LoadingNote label="Reading the fabric…" /></Box>;
  }
  if (topology.nodes.length === 0) {
    return (
      <EmptyState
        icon={<HubOutlinedIcon />}
        title="No SR Linux nodes to draw"
        detail={`fcling follows the SR Linux nodes of a lab, and has found none in ${labName}.`}
      />
    );
  }
  const select = (next: FabricSelection) => go({
    view: "topology",
    query: { [next.type]: next.id, ...(route.query.clients === "1" ? { clients: "1" } : {}) }
  });
  const clear = () => go({ view: "topology", query: route.query.clients === "1" ? { clients: "1" } : {} });
  return (
    <Box data-testid="fabric-topology" sx={{ position: "relative", display: "flex", flex: 1, minHeight: 0, minWidth: 0 }}>
      <Box sx={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0 }}>
        <FabricTopologyCanvas
          nodes={topology.nodes}
          links={topology.links}
          clients={clients}
          layout={layout}
          mode={preferences.mode}
          fullBps={preferences.fullBps}
          selection={selection}
          onSelect={select}
          onClear={clear}
          handle={canvas}
        />
        <Box sx={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", maxWidth: "calc(100% - 16px)" }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={preferences.mode}
            aria-label="Colour by"
            onChange={(_event, mode: FabricColorMode | null) => {
              if (mode) update({ mode });
            }}
            sx={{ bgcolor: "background.default" }}
          >
            <ToggleButton value="health" data-testid="fabric-mode-health" sx={{ px: 1 }}>Health</ToggleButton>
            <ToggleButton value="traffic" data-testid="fabric-mode-traffic" sx={{ px: 1 }}>Traffic</ToggleButton>
          </ToggleButtonGroup>
          {preferences.mode === "traffic" ? (
            <TextField
              select
              size="small"
              label="Full at"
              value={preferences.fullBps}
              data-testid="fabric-link-rate"
              onChange={(event) => update({ fullBps: Number(event.target.value) })}
              sx={{ width: 110, bgcolor: "background.default" }}
            >
              {LINK_RATES.map(([rate, label]) => <MenuItem key={rate} value={rate}>{label}</MenuItem>)}
            </TextField>
          ) : null}
          <Button size="small" variant="outlined" startIcon={<FitScreenIcon />} data-testid="fabric-fit" onClick={() => canvas.current?.fit()} sx={{ bgcolor: "background.default" }}>
            Fit
          </Button>
          {topology.clients.length > 0 ? (
            <ToggleButton
              size="small"
              value="clients"
              selected={preferences.clients}
              data-testid="fabric-show-clients"
              onChange={() => update({ clients: !preferences.clients })}
              sx={{ px: 1, height: 28, bgcolor: "background.default" }}
            >
              {plural(topology.clients.length, "client")}
            </ToggleButton>
          ) : null}
        </Box>
        <Legend mode={preferences.mode} />
      </Box>
      {selection ? (
        <Box
          sx={narrow
            ? { position: "absolute", top: 0, right: 0, bottom: 0, width: "min(320px, 88%)", zIndex: 4, boxShadow: overlayShadow, borderLeft: 1, borderColor: "divider" }
            : { width: DETAILS_WIDTH, flexShrink: 0, borderLeft: 1, borderColor: "divider" }}
        >
          <FabricTopologyDetails selection={selection} topology={topology} onClose={clear} />
        </Box>
      ) : null}
    </Box>
  );
}
