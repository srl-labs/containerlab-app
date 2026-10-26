// The lab hosts above the labs overview's cards: how much CPU, memory and disk each has left.
import React, { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";

import { formatEndpointHealthBytes, formatEndpointHealthPercent } from "../health";
import {
  labHostLoad,
  labHostUsageLevel,
  roomiestLabHost,
  type FetchLabHostMetrics,
  type LabHostMetricsState,
  type LabOverviewHost
} from "../state/labHostResources";
import type { LabOverviewCard } from "../state/labsOverview";
import type { EndpointHealthMetrics } from "../types";
import { controlRadius, floatingRadius } from "../../theme/surfaces";

const REFRESH_MS = 15_000;
const HOST_MIN_WIDTH = 232;

function levelColor(theme: Theme, percent: number | undefined): string {
  const level = labHostUsageLevel(percent);
  if (level === "full") return theme.palette.error.main;
  if (level === "busy") return theme.palette.warning.main;
  return theme.palette.success.main;
}

function documentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * The usage of the connected lab hosts, asked again every few seconds while
 * the page is shown. A failed refresh keeps the last numbers.
 */
function useLabHostMetrics(hosts: readonly LabOverviewHost[], fetchMetrics: FetchLabHostMetrics): Record<string, LabHostMetricsState> {
  const [states, setStates] = useState<Record<string, LabHostMetricsState>>({});
  const connected = hosts.filter((host) => host.status === "connected").map((host) => host.id);
  const key = connected.join("\n");

  useEffect(() => {
    const ids = key ? key.split("\n") : [];
    if (ids.length === 0) return undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fetchHost = async (id: string) => {
      try {
        const metrics = await fetchMetrics(id, controller.signal);
        if (!controller.signal.aborted) setStates((current) => ({ ...current, [id]: { status: "ready", metrics } }));
      } catch (error) {
        if (controller.signal.aborted) return;
        setStates((current) => current[id]?.status === "ready"
          ? current
          : { ...current, [id]: { status: "error", message: error instanceof Error ? error.message : String(error) } });
      }
    };
    const refresh = async () => {
      timer = undefined;
      if (!documentHidden()) await Promise.all(ids.map(fetchHost));
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), REFRESH_MS);
    };
    const onVisibility = () => {
      if (documentHidden() || timer === undefined) return;
      clearTimeout(timer);
      void refresh();
    };

    setStates((current) => Object.fromEntries(ids.map((id) => [id, current[id] ?? { status: "loading" }])));
    void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [key, fetchMetrics]);

  return states;
}

function Meter({ label, value, detail, percent, testId }: {
  label: string;
  value: string;
  detail?: string;
  percent: number | undefined;
  testId: string;
}) {
  const filled = percent === undefined || !Number.isFinite(percent) ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <Box data-testid={testId} data-level={labHostUsageLevel(percent)} sx={{ minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75, minWidth: 0 }}>
        <Typography component="span" variant="caption" sx={{ color: "text.secondary", width: 52, flexShrink: 0 }}>
          {label}
        </Typography>
        <Typography
          component="span"
          variant="caption"
          noWrap
          data-testid={`${testId}-value`}
          sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", flex: 1, minWidth: 0 }}
        >
          {value}
        </Typography>
        {detail !== undefined && detail !== "" ? (
          <Typography component="span" variant="caption" noWrap sx={{ color: "text.secondary", flexShrink: 0 }}>
            {detail}
          </Typography>
        ) : null}
      </Box>
      <Box sx={{ position: "relative", height: 4, mt: 0.25, borderRadius: 2, overflow: "hidden", bgcolor: "action.hover" }}>
        <Box
          sx={(theme) => ({
            position: "absolute", inset: 0, width: `${filled}%`, borderRadius: 2,
            bgcolor: levelColor(theme, percent),
            transition: "width 300ms ease",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" }
          })}
        />
      </Box>
    </Box>
  );
}

function HostMeters({ metrics }: { metrics: EndpointHealthMetrics }) {
  const { cpu, mem, disk } = metrics.metrics;
  const cores = cpu !== undefined && cpu.numCPU > 0 ? `${cpu.numCPU} ${cpu.numCPU === 1 ? "core" : "cores"}` : undefined;
  const load = cpu?.loadAvg1 === undefined ? undefined : `load ${cpu.loadAvg1.toFixed(1)}`;
  const memFree = mem ? mem.availableMem : undefined;
  const diskFree = disk ? disk.freeDisk : undefined;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      <Meter
        label="CPU"
        value={formatEndpointHealthPercent(cpu?.usagePercent)}
        detail={[cores, load].filter(Boolean).join(" · ") || undefined}
        percent={cpu?.usagePercent}
        testId="lab-host-cpu"
      />
      {mem ? (
        <Meter
          label="Memory"
          value={`${formatEndpointHealthBytes(memFree)} free`}
          detail={`of ${formatEndpointHealthBytes(mem.totalMem)}`}
          percent={mem.usagePercent}
          testId="lab-host-memory"
        />
      ) : null}
      {disk ? (
        <Meter
          label="Disk"
          value={`${formatEndpointHealthBytes(diskFree)} free`}
          detail={`of ${formatEndpointHealthBytes(disk.totalDisk)}`}
          percent={disk.usagePercent}
          testId="lab-host-disk"
        />
      ) : null}
    </Box>
  );
}

function hostMessage(host: LabOverviewHost, state: LabHostMetricsState | undefined): string {
  if (host.status === "session_expired") return "Sign in again to see its resources.";
  if (host.status === "saved") return "Sign in to see its resources.";
  if (host.status === "offline") return "Not reachable.";
  if (state?.status === "error") return "Resources unavailable.";
  return "Loading resources…";
}

function loadSummary(load: { labs: number; nodes: number } | undefined): string {
  if (load === undefined || load.labs === 0) return "No running labs";
  return `${load.labs} running ${load.labs === 1 ? "lab" : "labs"} · ${load.nodes} ${load.nodes === 1 ? "node" : "nodes"}`;
}

function HostTile({ host, state, load, roomiest, selected, onSelect }: {
  host: LabOverviewHost;
  state: LabHostMetricsState | undefined;
  load: { labs: number; nodes: number } | undefined;
  roomiest: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const ready = host.status === "connected" && state?.status === "ready" ? state.metrics : undefined;
  const summary = loadSummary(load);
  return (
    <ButtonBase
      component="article"
      aria-pressed={selected}
      title={selected ? "Show labs on every lab host" : `Show only labs on ${host.label}`}
      data-testid={`lab-host-${host.id}`}
      data-status={state?.status ?? host.status}
      onClick={onSelect}
      sx={{
        display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start", gap: 1, textAlign: "left", minWidth: 0,
        p: 1.25, border: 1, borderRadius: floatingRadius, bgcolor: "background.paper",
        borderColor: selected ? "primary.main" : "divider",
        boxShadow: (theme) => (selected ? `inset 0 0 0 1px ${theme.palette.primary.main}` : "none"),
        transition: "border-color 120ms ease",
        "&:hover": { borderColor: selected ? "primary.main" : "var(--clab-ui-focus-border, var(--vscode-focusBorder))" },
        "&.Mui-focusVisible": { outline: "1px solid var(--clab-ui-focus-border, var(--vscode-focusBorder))", outlineOffset: 1 },
        "@media (prefers-reduced-motion: reduce)": { transition: "none" }
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
        <Box
          sx={(theme) => ({
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            bgcolor: host.status === "connected" ? theme.palette.success.main : theme.palette.text.disabled
          })}
        />
        <Typography variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>{host.label}</Typography>
        {roomiest ? (
          <Chip
            size="small"
            color="success"
            variant="outlined"
            label="Most room"
            data-testid="lab-host-roomiest"
            sx={{ height: 20, borderRadius: controlRadius, "& .MuiChip-label": { px: 0.75, fontSize: 11 } }}
          />
        ) : null}
      </Box>
      <Typography variant="caption" sx={{ color: "text.secondary", mt: -0.75 }}>{summary}</Typography>
      {ready ? (
        <HostMeters metrics={ready} />
      ) : (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>{hostMessage(host, state)}</Typography>
      )}
    </ButtonBase>
  );
}

/** One tile per lab host; a tile shows only that host's labs, and again every host's. */
export function LabHostsStrip({ hosts, cards, fetchMetrics, selectedLabel, onSelect }: {
  hosts: readonly LabOverviewHost[];
  cards: readonly LabOverviewCard[];
  fetchMetrics: FetchLabHostMetrics;
  /** The lab host the cards are filtered to, by label. */
  selectedLabel: string;
  onSelect: (label: string) => void;
}) {
  const states = useLabHostMetrics(hosts, fetchMetrics);
  const load = useMemo(() => labHostLoad(cards), [cards]);
  const roomiest = roomiestLabHost(states);
  return (
    <Box
      data-testid="labs-overview-hosts"
      sx={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${HOST_MIN_WIDTH}px, 1fr))`, gap: 1.5 }}
    >
      {hosts.map((host) => (
        <HostTile
          key={host.id}
          host={host}
          state={states[host.id]}
          load={load.get(host.id)}
          roomiest={roomiest === host.id}
          selected={selectedLabel === host.label}
          onSelect={() => onSelect(selectedLabel === host.label ? "" : host.label)}
        />
      ))}
    </Box>
  );
}
