// What the hover card shows about a link: both endpoints side by side, live traffic once deployed.
import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { useGraphStore } from "../../../stores/graphStore";
import { useDeploymentState } from "../../../stores/topoViewerStore";
import { formatBitRate } from "../../../utils/resourceUsage";
import { linkTrafficKey } from "../../../utils/trafficHistory";
import { TRAFFIC_LEGEND } from "../../panels/trafficChartSeries";

import { CardTitle, Label, RowGrid, Value } from "./HoverCardParts";
import { linkHoverEndpoints, linkHoverState, type LinkHoverEndpoint, type LinkHoverState } from "./linkHoverDetails";

const LazyTrafficChart = React.lazy(async () => {
  const module = await import("../../panels/TrafficChart");
  return { default: module.TrafficChart };
});
// The link panel's chart in as little room as it reads well in.
const CHART_HEIGHT = 96;

const STATE_LABELS: Record<LinkHoverState, string> = { up: "Up", down: "Down", unknown: "Unknown" };

function stateColor(state: LinkHoverState | undefined): string {
  if (state === "up") return "success.main";
  if (state === "down") return "error.main";
  return "text.disabled";
}

/** Beside the chart's title, where it costs no height. */
function TrafficLegend() {
  return (
    <Box data-testid="link-hover-card-legend" sx={{ display: "flex", flexShrink: 0, gap: 1 }}>
      {TRAFFIC_LEGEND.map(({ label, color }) => (
        <Box
          key={label}
          sx={{ display: "flex", alignItems: "center", gap: 0.5, fontSize: 10, whiteSpace: "nowrap", color: "text.secondary" }}
        >
          <Box sx={{ width: 8, height: 2, borderRadius: 1, bgcolor: color }} />
          {label}
        </Box>
      ))}
    </Box>
  );
}

/** Traffic of the first end that reports any; both ends see the same packets. */
function LinkTraffic({ ends }: { ends: readonly [LinkHoverEndpoint, LinkHoverEndpoint] }) {
  const index = ends[0].stats ? 0 : 1;
  const end = ends[index];
  if (!end.stats) return null;
  return (
    <Box data-testid="link-hover-card-traffic" sx={{ mt: 1, pt: 0.75, borderTop: 1, borderColor: "divider" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, mb: 0.25 }}>
        <Typography variant="caption" component="p" noWrap sx={{ flex: 1, minWidth: 0, color: "text.secondary" }}>
          Traffic at {end.node}:{end.interface}
        </Typography>
        <TrafficLegend />
      </Box>
      <Box sx={{ height: CHART_HEIGHT }}>
        <React.Suspense fallback={null}>
          <LazyTrafficChart
            stats={end.stats}
            endpointKey={linkTrafficKey(index === 0 ? "a" : "b", end.node, end.interface)}
            height={CHART_HEIGHT}
            dense
            emptyMessage={null}
          />
        </React.Suspense>
      </Box>
    </Box>
  );
}

function trafficOf(end: LinkHoverEndpoint, key: "rxBps" | "txBps"): string {
  const value = end.stats?.[key];
  return value === undefined ? "" : formatBitRate(value);
}

/** A row with a value for each end; nothing when neither end has one. */
function EndpointRow({ label, a, b, mono, testId }: {
  label: string;
  a: string;
  b: string;
  mono?: boolean;
  testId: string;
}) {
  if (a === "" && b === "") return null;
  return (
    <>
      <Label>{label}</Label>
      <Value value={a || "–"} mono={mono} testId={`${testId}-a`} />
      <Value value={b || "–"} mono={mono} testId={`${testId}-b`} />
    </>
  );
}

export function LinkHoverCardContent({ edgeId }: { edgeId: string }) {
  const edge = useGraphStore((state) => state.edges.find((candidate) => candidate.id === edgeId));
  const deployed = useDeploymentState() === "deployed";
  if (!edge) return null;
  const ends = linkHoverEndpoints(edge);
  const state = deployed ? linkHoverState(ends) : undefined;
  const [a, b] = ends;
  return (
    <>
      <CardTitle
        title={`${ends[0].node} ⟷ ${ends[1].node}`}
        state={state ? STATE_LABELS[state] : "Not deployed"}
        stateValue={state ?? "undeployed"}
        stateColor={stateColor(state)}
        stateTestId="link-hover-card-state"
      />
      <RowGrid columns={2}>
        <EndpointRow label="Node" a={a.node} b={b.node} testId="link-hover-card-node" />
        <EndpointRow label="Interface" a={a.interface} b={b.interface} mono testId="link-hover-card-interface" />
        {deployed ? (
          <>
            <EndpointRow label="MTU" a={a.mtu} b={b.mtu} testId="link-hover-card-mtu" />
            <EndpointRow label="MAC" a={a.mac} b={b.mac} mono testId="link-hover-card-mac" />
            <EndpointRow label="Rx" a={trafficOf(a, "rxBps")} b={trafficOf(b, "rxBps")} testId="link-hover-card-rx" />
            <EndpointRow label="Tx" a={trafficOf(a, "txBps")} b={trafficOf(b, "txBps")} testId="link-hover-card-tx" />
            <EndpointRow label="Impaired" a={a.impairment ?? ""} b={b.impairment ?? ""} testId="link-hover-card-impairment" />
          </>
        ) : null}
      </RowGrid>
      {deployed ? <LinkTraffic ends={ends} /> : null}
    </>
  );
}
