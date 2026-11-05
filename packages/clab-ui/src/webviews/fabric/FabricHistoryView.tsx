/** What changed: a timeline of the kept history, and the changes themselves, newest first. */
import BookmarkAddOutlinedIcon from "@mui/icons-material/BookmarkAddOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import SearchIcon from "@mui/icons-material/Search";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import React, { useEffect, useMemo, useState } from "react";

import { FabricChangeRow } from "./FabricChangeRow";
import { FabricTimeline } from "./FabricTimeline";
import { useFabric } from "./fabricContext";
import { errorMessage, useFabricAnswer, useLiveRevision, useSettledValue } from "./fabricData";
import { clock, natural } from "./fabricFormat";
import { baselineStamp, HISTORY_WINDOWS } from "./fabricHistory";
import type { FabricBaseline, FabricChange } from "./fabricTypes";
import { EmptyState, ErrorNote, LoadingNote, ViewHeader } from "./fabricUi";

const SINCE_BASELINE = "baseline";
const LIMIT = "3000";
const PAGE = 300;
const SEARCH_WAIT_MS = 300;
const HISTORY_SETTLE_MS = 3_000;

const ORIGINS = [
  ["", "Everything"],
  ["config", "Config"],
  ["unplanned", "Unplanned"]
] as const;

function windowSeconds(since: string): number {
  return HISTORY_WINDOWS.find(([name]) => name === since)?.[1] ?? 3600;
}

function pickedReports(picked: readonly string[]): string {
  if (picked.length === 0) return "Every report";
  return picked.length === 1 ? picked[0] ?? "" : `${picked.length} reports`;
}

function HistoryFilters({ query, set, baselines, onSetBaseline, text, onText }: {
  query: Readonly<Record<string, string>>;
  set: (change: Record<string, string>) => void;
  baselines: FabricBaseline[];
  onSetBaseline: () => void;
  text: string;
  onText: (text: string) => void;
}): React.JSX.Element {
  const { topology, catalog } = useFabric();
  const since = query.since ?? "1h";
  const picked = (query.report ?? "").split(",").filter(Boolean);
  const reports = useMemo(() => [
    "checks",
    "config-commits",
    ...(catalog ?? [])
      .filter((spec) => !spec.hidden && spec.eventful !== false && spec.name !== "config-commits")
      .map((spec) => spec.name)
      .sort(natural)
  ], [catalog]);
  const nodes = useMemo(() => (topology?.nodes ?? []).map((node) => node.name).sort(natural), [topology]);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", px: 2, pb: 1.25, flexShrink: 0 }}>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={since}
        aria-label="How far back"
        onChange={(_event, value: string | null) => {
          if (value) set({ since: value, ...(value === SINCE_BASELINE ? {} : { baseline: "" }) });
        }}
      >
        {HISTORY_WINDOWS.map(([name]) => <ToggleButton key={name} value={name} data-testid={`fabric-window-${name}`} sx={{ px: 1 }}>{name}</ToggleButton>)}
        <ToggleButton value={SINCE_BASELINE} disabled={baselines.length === 0} data-testid="fabric-window-baseline" sx={{ px: 1 }}>
          Since baseline
        </ToggleButton>
      </ToggleButtonGroup>
      {since === SINCE_BASELINE && baselines.length > 1 ? (
        <TextField
          select
          size="small"
          label="Baseline"
          value={query.baseline || baselines[baselines.length - 1]?.name || ""}
          onChange={(event) => set({ baseline: event.target.value })}
          sx={{ minWidth: 200 }}
        >
          {[...baselines].reverse().map((baseline) => <MenuItem key={baseline.name} value={baseline.name}>{baseline.name}</MenuItem>)}
        </TextField>
      ) : null}
      <Button size="small" variant="outlined" startIcon={<BookmarkAddOutlinedIcon />} data-testid="fabric-set-baseline" onClick={onSetBaseline}>
        Set baseline
      </Button>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={query.origin ?? ""}
        aria-label="What caused it"
        onChange={(_event, value: string | null) => {
          if (value !== null) set({ origin: value });
        }}
      >
        {ORIGINS.map(([value, label]) => <ToggleButton key={value} value={value} data-testid={`fabric-origin-${label.toLowerCase()}`} sx={{ px: 1 }}>{label}</ToggleButton>)}
      </ToggleButtonGroup>
      <TextField
        select
        size="small"
        label="Reports"
        value={picked}
        data-testid="fabric-history-reports"
        sx={{ width: 160 }}
        onChange={(event) => {
          const value = event.target.value as unknown as string[];
          set({ report: value.filter(Boolean).join(",") });
        }}
        slotProps={{
          select: {
            multiple: true,
            displayEmpty: true,
            renderValue: () => pickedReports(picked)
          }
        }}
      >
        {reports.map((report) => <MenuItem key={report} value={report} dense>{report === "checks" ? "findings (checks)" : report}</MenuItem>)}
      </TextField>
      <TextField
        select
        size="small"
        label="Node"
        value={query.node ?? ""}
        data-testid="fabric-history-node"
        sx={{ width: 130 }}
        onChange={(event) => set({ node: event.target.value })}
        slotProps={{ select: { displayEmpty: true } }}
      >
        <MenuItem value="">Every node</MenuItem>
        {nodes.map((node) => <MenuItem key={node} value={node} dense>{node}</MenuItem>)}
      </TextField>
      <TextField
        size="small"
        placeholder="Search: leaf3, ethernet-1/49, down…"
        value={text}
        onChange={(event) => onText(event.target.value)}
        slotProps={{
          htmlInput: { "aria-label": "Search the history", "data-testid": "fabric-history-search" },
          input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }
        }}
        sx={{ flex: "1 1 200px", minWidth: 180, maxWidth: 360 }}
      />
    </Box>
  );
}

/** The kept changes the filters ask for, and the baselines they can start from. */
function useHistoryAnswer(query: Readonly<Record<string, string>>, search: string) {
  const { client, catalog, subscribeLive } = useFabric();
  const since = query.since ?? "1h";
  const fromBaseline = since === SINCE_BASELINE;
  const node = query.node ?? "";
  const report = query.report ?? "";
  const [baselineRevision, setBaselineRevision] = useState(0);
  const uneventful = useMemo(
    () => new Set((catalog ?? []).filter((spec) => spec.eventful === false).map((spec) => spec.name)),
    [catalog]
  );
  const revision = useLiveRevision(subscribeLive, (event) => {
    if (event.type !== "change" || event.op === "update") return false;
    if (uneventful.has(String(event.report))) return false;
    return !node || event.node === node;
  }, HISTORY_SETTLE_MS);
  const baselinesAnswer = useFabricAnswer<FabricBaseline[]>(client, { method: "GET", path: "baselines" }, baselineRevision);
  const baselines = baselinesAnswer.answer ?? [];
  const baseline = fromBaseline
    ? baselines.find((item) => item.name === query.baseline) ?? baselines[baselines.length - 1]
    : undefined;
  const request = fromBaseline && !baseline ? undefined : {
    method: "GET" as const,
    path: "history",
    query: {
      ...(baseline ? { baseline: baseline.name } : { since }),
      report: report.split(",").filter(Boolean),
      node,
      q: search,
      limit: LIMIT
    }
  };
  const history = useFabricAnswer<FabricChange[]>(client, request, revision);
  return {
    ...history,
    baselines,
    baseline,
    noBaseline: fromBaseline && !baseline && !baselinesAnswer.loading,
    reloadBaselines: () => setBaselineRevision((value) => value + 1)
  };
}

function ChangesList({ listed, search, shown, onMore }: {
  listed: readonly FabricChange[];
  search: string;
  shown: number;
  onMore: () => void;
}): React.JSX.Element {
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", borderTop: 1, borderColor: "divider" }}>
      {listed.length > 0 ? (
        <Box component="ul" sx={{ m: 0, p: 0 }} data-testid="fabric-changes">
          {listed.slice(0, shown).map((change) => <FabricChangeRow key={change.seq} change={change} />)}
        </Box>
      ) : (
        <EmptyState
          icon={<HistoryOutlinedIcon />}
          title={search ? `No change matches “${search}”` : "Nothing changed"}
          detail={search ? undefined : "Nothing was kept in this window."}
        />
      )}
      {listed.length > shown ? (
        <Box sx={{ p: 1, display: "flex", justifyContent: "center" }}>
          <Button size="small" variant="outlined" onClick={onMore}>Show more ({listed.length - shown} left)</Button>
        </Box>
      ) : null}
    </Box>
  );
}

export function FabricHistoryView(): React.JSX.Element {
  const { client, route, go } = useFabric();
  const { query } = route;
  const since = query.since ?? "1h";
  const origin = query.origin ?? "";
  const [text, setText] = useState(query.q ?? "");
  const search = useSettledValue(text.trim(), SEARCH_WAIT_MS);
  const [range, setRange] = useState<readonly [number, number]>();
  const [shown, setShown] = useState(PAGE);
  const [actionError, setActionError] = useState<string>();
  const { answer, error, loading, baselines, baseline, noBaseline, reloadBaselines } = useHistoryAnswer(query, search);
  // The window ends when the answer came: it moves with the next one, not with every keystroke.
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => setNow(Date.now() / 1000), [answer]);

  const set = (change: Record<string, string>) => {
    setRange(undefined);
    setShown(PAGE);
    go({ view: "history", query: { ...query, ...change } });
  };

  const setBaselineNow = () => {
    const name = baselineStamp();
    client.api<FabricBaseline[]>({ method: "POST", path: "baselines", body: { name, comment: "Set from the Fabric view" } }).then(
      () => {
        reloadBaselines();
        set({ since: SINCE_BASELINE, baseline: name });
      },
      (reason: unknown) => setActionError(errorMessage(reason))
    );
  };

  const all = answer ?? [];
  const changes = origin ? all.filter((change) => change.origin === origin) : all;
  const listed = (range ? changes.filter((change) => range[0] <= change.ts && change.ts < range[1]) : changes).slice().reverse();
  const from = baseline ? baseline.ts : now - windowSeconds(since);
  const to = Math.max(now, from + 60);
  const configured = all.filter((change) => change.origin === "config").length;
  const countText = [
    all.length >= Number(LIMIT) ? `The latest ${LIMIT} changes` : `${all.length} changes`,
    search ? ` matching “${search}”` : "",
    baseline ? ` since ${baseline.name}` : "",
    `: ${configured} after a configuration commit, ${all.length - configured} unplanned`
  ].join("");

  return (
    <Box data-testid="fabric-history" sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ViewHeader
        title="History"
        detail="Every change the engine kept: configuration commits and what they caused, apart from what the network did on its own."
      />
      <HistoryFilters query={query} set={set} baselines={baselines} onSetBaseline={setBaselineNow} text={text} onText={setText} />
      {actionError ? <ErrorNote sx={{ mx: 2, mb: 1 }}>{actionError}</ErrorNote> : null}
      {error ? <ErrorNote sx={{ mx: 2, mb: 1 }}>{error}</ErrorNote> : null}
      {noBaseline ? <EmptyState icon={<HistoryOutlinedIcon />} title="No baseline is kept" detail="Set one to see what changes from here on." /> : null}
      {!answer && loading ? <LoadingNote label="Reading the history…" sx={{ px: 2 }} /> : null}
      {answer ? (
        <>
          <FabricTimeline changes={changes} from={from} to={to} range={range} onRange={setRange} />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", px: 2, pb: 0.75, flexShrink: 0 }}>
            <Typography variant="caption" data-testid="fabric-history-count" sx={{ color: "text.secondary" }}>{countText}</Typography>
            {range ? <Chip size="small" label={`${clock(range[0])} to ${clock(range[1])}`} onDelete={() => setRange(undefined)} /> : null}
          </Box>
          <ChangesList listed={listed} search={search} shown={shown} onMore={() => setShown(shown + PAGE)} />
        </>
      ) : null}
    </Box>
  );
}
