/** Any report as a table: live from the engine, from the history at an instant, or collected on the spot. */
import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import React, { useMemo, useState } from "react";

import { floatingRadius } from "../../theme/surfaces";

import { FabricConfigDiff } from "./FabricConfigDiff";
import { FabricDataTable } from "./FabricDataTable";
import { useFabric } from "./fabricContext";
import { useFabricAnswer, useLiveRevision } from "./fabricData";
import { clock } from "./fabricFormat";
import { paramLabel, paramPlaceholder, reportParams, reportTitle, ribQueryReady } from "./fabricReports";
import { routeFilters } from "./fabricRoute";
import { cellPlain } from "./fabricTable";
import type { FabricCell, FabricParam, FabricReportSpec, FabricTableAnswer } from "./fabricTypes";
import { EmptyState, ErrorNote, LoadingNote, Pill, TextLink, ViewHeader, type FabricTone } from "./fabricUi";

const SOURCE_TONES: Readonly<Record<string, FabricTone>> = { live: "good", history: "warn", collected: "info" };

const EVPN_ROUTE_TYPES: ReadonlyArray<readonly [string, string]> = [
  ["1", "1: ethernet-ad"],
  ["2", "2: mac-ip"],
  ["3", "3: imet"],
  ["4", "4: ethernet-segment"],
  ["5", "5: ip-prefix"]
];

/** Asked for by the form, not by the keys the node matches on. */
const RIB_SCOPED = new Set(["list_all"]);

function ParamField({ param, value, onChange }: { param: FabricParam; value: string; onChange: (value: string) => void }): React.JSX.Element {
  const isRouteType = param.name === "route_type";
  const choices = isRouteType ? EVPN_ROUTE_TYPES : (param.choices ?? []).map((choice) => [choice, choice] as const);
  const select = choices.length > 0;
  return (
    <Tooltip title={param.help} placement="top" enterDelay={500}>
      <TextField
        size="small"
        select={select}
        label={paramLabel(param.name)}
        placeholder={select ? undefined : paramPlaceholder(param)}
        // A choice left alone is its default, which the engine fills in by itself.
        value={select && !isRouteType ? value || param.default || choices[0]?.[0] || "" : value}
        onChange={(event) => onChange(event.target.value)}
        slotProps={{
          htmlInput: { "data-testid": `fabric-param-${param.name}` },
          select: { displayEmpty: true }
        }}
        sx={{ width: 190 }}
      >
        {isRouteType ? <MenuItem value="">All types</MenuItem> : null}
        {choices.map(([choice, label]) => <MenuItem key={choice} value={choice}>{label}</MenuItem>)}
      </TextField>
    </Tooltip>
  );
}

/** A report's own parameters; for a BGP RIB, the way to narrow it before anything is read. */
function ReportForm({ spec, query, onSubmit }: {
  spec: FabricReportSpec;
  query: Readonly<Record<string, string>>;
  onSubmit: (params: Record<string, string>, listAll: boolean) => void;
}): React.JSX.Element | null {
  const [draft, setDraft] = useState(() => reportParams(spec, query));
  const fields = spec.params.filter((param) => !RIB_SCOPED.has(param.name) && !(spec.rib_evpn && param.name === "ni"));
  if (fields.length === 0) return null;
  return (
    <Box
      component="form"
      data-testid="fabric-report-form"
      onSubmit={(event: React.FormEvent) => {
        event.preventDefault();
        onSubmit(draft, false);
      }}
      sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap", px: 2, pt: 0.5, pb: 1.5, flexShrink: 0 }}
    >
      {fields.map((param) => (
        <ParamField
          key={param.name}
          param={param}
          value={draft[param.name] ?? ""}
          onChange={(value) => setDraft({ ...draft, [param.name]: value })}
        />
      ))}
      <Button type="submit" variant="contained" size="small" data-testid="fabric-report-submit">{spec.needs_query ? "Look up" : "Show"}</Button>
      {spec.needs_query ? (
        <Button variant="outlined" size="small" data-testid="fabric-report-list-all" onClick={() => onSubmit(draft, true)}>List all routes</Button>
      ) : null}
    </Box>
  );
}

function DiffPanel({ commit, onClose }: { commit: { node: string; id: string; at: string }; onClose: () => void }): React.JSX.Element {
  return (
    <Box
      component="section"
      data-testid="fabric-commit-diff"
      sx={{ mx: 2, mb: 1.25, p: 1.25, border: 1, borderColor: "divider", borderRadius: floatingRadius, bgcolor: "background.paper", flexShrink: 0 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
        <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }}>
          {commit.node}, commit {commit.id}
          <Typography component="span" variant="caption" sx={{ color: "text.secondary", ml: 1 }}>
            made {clock(Date.parse(commit.at) / 1000)}, against the configuration kept before it
          </Typography>
        </Typography>
        <IconButton size="small" aria-label="Close the diff" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Box>
      <FabricConfigDiff key={`${commit.node}|${commit.at}`} node={commit.node} at={commit.at} />
    </Box>
  );
}

/** The diff button of a commit: found by when it was made, as its id may have been another commit's before. */
function commitOf(columns: readonly string[], row: FabricCell[]): { node: string; id: string; at: string } | undefined {
  const column = (name: string) => {
    const index = columns.indexOf(name);
    return index < 0 ? "" : cellPlain(row[index]);
  };
  const at = column("ended") || column("started");
  return at ? { node: column("Node"), id: column("id"), at } : undefined;
}

type FabricCommit = NonNullable<ReturnType<typeof commitOf>>;

/** The report's answer: live, at an instant, or collected; a RIB only once asked for. */
function useReportAnswer(spec: FabricReportSpec) {
  const { client, route, at, subscribeLive } = useFabric();
  const { query } = route;
  const params = useMemo(() => reportParams(spec, query), [spec, query]);
  const needsQuery = spec.needs_query === true;
  // A RIB is only read when asked to (`run`): opening it, from a BGP peer's count say, fills the form and waits.
  const ready = ribQueryReady(spec, params) && (!needsQuery || query.run !== undefined);
  const live = at === undefined && spec.streamed === true && Object.values(params).every((value) => !value);
  const revision = useLiveRevision(subscribeLive, (event) => live && event.type === "change" && event.report === spec.name, 2_000);
  const request = ready ? {
    method: "GET" as const,
    path: `reports/${spec.name}`,
    query: { ...params, node: query.node, at: at === undefined ? undefined : String(at), table: "1" }
  } : undefined;
  const state = useFabricAnswer<FabricTableAnswer>(client, request, needsQuery ? `${revision}:${query.run}` : revision);
  return { ...state, params, ready };
}

function submittedQuery(spec: FabricReportSpec, node: string | undefined, next: Record<string, string>, listAll: boolean): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(next).filter(([name, value]) => value !== "" && name !== "list_all")),
    ...(node ? { node } : {}),
    ...(listAll ? { list_all: "all" } : {}),
    // New each time, so looking up the same keys reads them again.
    ...(spec.needs_query ? { run: Date.now().toString(36) } : {})
  };
}

function SourcePills({ source, node }: { source: string | undefined; node: string | undefined }): React.JSX.Element {
  return (
    <>
      {source && source !== "pending" ? <Pill dot tone={SOURCE_TONES[source] ?? "neutral"} testId="fabric-report-source">{source}</Pill> : null}
      {node ? <Pill>{node}</Pill> : null}
    </>
  );
}

function UnreadableNodes({ errors }: { errors: Readonly<Record<string, string>> | undefined }): React.JSX.Element | null {
  const entries = Object.entries(errors ?? {});
  if (entries.length === 0) return null;
  return (
    <ErrorNote sx={{ mx: 2, mb: 1 }}>
      {entries.length === 1 ? "1 node could not answer" : `${entries.length} nodes could not answer`}:{" "}
      {entries.map(([node, reason]) => `${node}: ${reason}`).join("; ")}
    </ErrorNote>
  );
}

function ReportBody({ spec }: { spec: FabricReportSpec }): React.JSX.Element {
  const { route, go } = useFabric();
  const { query } = route;
  const [diffOf, setDiffOf] = useState<FabricCommit>();
  const { answer, error, loading, params, ready } = useReportAnswer(spec);
  const needsQuery = spec.needs_query === true;
  const columns = answer?.columns ?? [];
  const title = reportTitle(spec.name);
  const keepFilters = (filters: Record<string, string>) => {
    const kept = Object.fromEntries(Object.entries(query).filter(([key]) => !key.startsWith("f.")));
    const next = Object.fromEntries(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [`f.${key}`, value]));
    go({ view: "report", name: spec.name, query: { ...kept, ...next } });
  };
  const commitAction = (row: FabricCell[]) => {
    const commit = commitOf(columns, row);
    return commit ? (
      <Box component="span" sx={{ whiteSpace: "nowrap" }}>
        <TextLink testId="fabric-commit-diff-button" onClick={() => setDiffOf(commit)}>Diff vs previous</TextLink>
      </Box>
    ) : null;
  };
  return (
    <Box data-testid="fabric-report" data-report={spec.name} sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ViewHeader
        title={title}
        code={title === spec.name ? undefined : spec.name}
        detail={spec.help}
        pills={<SourcePills source={answer?.source} node={query.node} />}
      />
      <ReportForm
        key={JSON.stringify(params)}
        spec={spec}
        query={query}
        onSubmit={(next, listAll) => go({ view: "report", name: spec.name, query: submittedQuery(spec, query.node, next, listAll) })}
      />
      <UnreadableNodes errors={answer?.errors} />
      {answer?.message ? <Typography variant="body2" sx={{ color: "text.secondary", px: 2, pb: 1 }}>{answer.message}</Typography> : null}
      {diffOf ? <DiffPanel commit={diffOf} onClose={() => setDiffOf(undefined)} /> : null}
      {error ? <ErrorNote sx={{ mx: 2 }}>{error}</ErrorNote> : null}
      {!answer && loading ? <LoadingNote label={needsQuery ? "Looking up routes…" : `Reading ${title}…`} sx={{ px: 2 }} /> : null}
      {needsQuery && !ready ? (
        <EmptyState
          title="This RIB is not read until you ask"
          detail="One peer can send tens of thousands of routes. Fill in route keys and look them up, or list all routes."
        />
      ) : null}
      {answer && columns.length > 0 ? (
        <FabricDataTable
          key={spec.name}
          columns={columns}
          rows={answer.rows ?? []}
          initialFilters={routeFilters(query)}
          onFiltersChange={keepFilters}
          emptyLabel="This report has no rows."
          rowAction={spec.name === "config-commits" ? commitAction : undefined}
        />
      ) : null}
    </Box>
  );
}

export function FabricReportView({ name }: { name: string }): React.JSX.Element {
  const { catalog } = useFabric();
  if (!catalog) return <LoadingNote label="Reading the reports…" sx={{ px: 2, py: 2 }} />;
  const spec = catalog.find((report) => report.name === name);
  if (!spec) return <EmptyState title={`There is no report ${name}`} detail="The engine does not know it. It may be another version." />;
  return <ReportBody spec={spec} />;
}
