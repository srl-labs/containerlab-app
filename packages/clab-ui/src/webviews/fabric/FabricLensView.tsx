/** The lenses: where an address is, how traffic would get there, the services end to end, every host. */
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import DevicesOtherOutlinedIcon from "@mui/icons-material/DevicesOtherOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import RouteOutlinedIcon from "@mui/icons-material/RouteOutlined";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import React, { useMemo, useState } from "react";

import { controlRadius, floatingRadius } from "../../theme/surfaces";

import { FabricDataTable } from "./FabricDataTable";
import { FabricServiceLens } from "./FabricServiceLens";
import { useFabric } from "./fabricContext";
import { useLensAnswer } from "./fabricLensAnswer";
import { natural, plural } from "./fabricFormat";
import { hopsByStage, isArrivedOutcome, isFailedOutcome, summarizePath, summarizeWhere } from "./fabricLenses";
import { nodeRoute } from "./fabricRoute";
import type { FabricPathHop, FabricSighting } from "./fabricTypes";
import { EmptyState, ErrorNote, LoadingNote, MONO_SX, Pill, TextLink, tint, toneColor, ViewHeader, type FabricTone } from "./fabricUi";

interface LensField {
  name: string;
  label: string;
  placeholder: string;
  required?: boolean;
  options?: readonly string[];
  width?: number;
}

function LensForm({ fields, values, submit, onSubmit }: {
  fields: readonly LensField[];
  values: Readonly<Record<string, string>>;
  submit: string;
  onSubmit: (values: Record<string, string>) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.name, values[field.name] ?? ""])));
  const setField = (name: string, value: string) => setDraft((current) => ({ ...current, [name]: value }));
  const ready = fields.every((field) => !field.required || (draft[field.name] ?? "").trim() !== "");
  return (
    <Box
      component="form"
      onSubmit={(event: React.FormEvent) => {
        event.preventDefault();
        if (ready) onSubmit(Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value)));
      }}
      sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap", px: 2, pt: 0.75, pb: 1.5, flexShrink: 0 }}
    >
      {fields.map((field) => (
        field.options ? (
          <Autocomplete
            key={field.name}
            freeSolo
            size="small"
            options={field.options as string[]}
            inputValue={draft[field.name] ?? ""}
            onInputChange={(_event, value) => setField(field.name, value)}
            sx={{ width: field.width ?? 240 }}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                label={field.label}
                placeholder={field.placeholder}
                slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, "data-testid": `fabric-lens-${field.name}` } }}
              />
            )}
          />
        ) : (
          <TextField
            key={field.name}
            size="small"
            label={field.label}
            placeholder={field.placeholder}
            value={draft[field.name] ?? ""}
            onChange={(event) => setField(field.name, event.target.value)}
            slotProps={{ htmlInput: { "data-testid": `fabric-lens-${field.name}` } }}
            sx={{ width: field.width ?? 240 }}
          />
        )
      ))}
      <Button type="submit" size="small" variant="contained" disabled={!ready} data-testid="fabric-lens-submit">{submit}</Button>
    </Box>
  );
}

function Outcome({ tone, children, testId }: { tone: FabricTone; children: React.ReactNode; testId?: string }): React.JSX.Element {
  const color = toneColor(tone);
  return (
    <Box
      data-testid={testId}
      sx={{
        display: "flex", alignItems: "flex-start", gap: 0.75, px: 1.25, py: 0.75, borderRadius: controlRadius, fontSize: 13,
        bgcolor: tint(color, 10), border: `1px solid ${tint(color, 30)}`
      }}
    >
      {tone === "good"
        ? <CheckCircleOutlineIcon fontSize="small" sx={{ color: "success.main", mt: "1px" }} />
        : <ErrorOutlineIcon fontSize="small" sx={{ color, mt: "1px" }} />}
      <Box sx={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</Box>
    </Box>
  );
}

const WHERE_FIELDS: readonly LensField[] = [
  { name: "address", label: "Address", placeholder: "10.1.3.13, 2001:db8::1, AA:C1:AB:73:4C:27", required: true, width: 340 }
];

function WhereLens(): React.JSX.Element {
  const { route, go } = useFabric();
  const address = route.query.address ?? "";
  const { answer, error, loading } = useLensAnswer<FabricSighting>("where", { address }, address !== "");
  const summary = useMemo(() => summarizeWhere(answer?.records ?? []), [answer]);
  return (
    <Box data-testid="fabric-lens-where" sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ViewHeader title="Where" detail="Every place in the fabric that knows an IP or MAC address." />
      <LensForm
        key={address}
        fields={WHERE_FIELDS}
        values={{ address }}
        submit="Find"
        onSubmit={(values) => go({ view: "lens", name: "where", query: values })}
      />
      {error ? <ErrorNote sx={{ mx: 2 }}>{error}</ErrorNote> : null}
      {!answer && loading ? <LoadingNote label="Asking the fabric…" sx={{ px: 2 }} /> : null}
      {address === "" ? <EmptyState icon={<PlaceOutlinedIcon />} title="Look for an address" detail="Configured on an interface, learned as a host, in an ARP or ND table, or only routed to." /> : null}
      {answer ? (
        <>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, px: 2, pb: 1.25, flexShrink: 0 }} data-testid="fabric-where-summary">
            {!summary.found ? <Outcome tone="bad">{address} is nowhere in the fabric.</Outcome> : null}
            {summary.duplicate ? <Outcome tone="bad"><b>Duplicate:</b> on several nodes, on no common segment.</Outcome> : null}
            {summary.multihomed ? <Outcome tone="good"><b>Multihomed</b> on one ethernet-segment.</Outcome> : null}
            {summary.found ? (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {plural(summary.places, "place")} {summary.places === 1 ? "knows" : "know"} it, on {plural(summary.nodes.length, "node")}:{" "}
                {summary.nodes.map((node, index) => (
                  <React.Fragment key={node}>
                    {index > 0 ? ", " : ""}
                    <TextLink onClick={() => go(nodeRoute(node))}>{node}</TextLink>
                  </React.Fragment>
                ))}
              </Typography>
            ) : null}
          </Box>
          {summary.found ? <FabricDataTable columns={answer.columns ?? []} rows={answer.rows ?? []} /> : null}
        </>
      ) : null}
    </Box>
  );
}

function hopRoute(hop: FabricPathHop): string {
  return [hop.prefix, hop.route_type].filter(Boolean).join(" ");
}

function outcomeTone(outcome: string): FabricTone {
  if (isFailedOutcome(outcome)) return "bad";
  return isArrivedOutcome(outcome) ? "good" : "neutral";
}

function HopRow({ hop }: { hop: FabricPathHop }): React.JSX.Element {
  const { go } = useFabric();
  const details = [
    ["Route", hopRoute(hop)],
    ["Next hop", hop.next_hop],
    ["Via", hop.egress],
    ["To", [hop.peer, hop.peer_port].filter(Boolean).join(" ")],
    ["Tunnel", [hop.tunnel, hop.vni ? `VNI ${hop.vni}` : "", hop.endpoint].filter(Boolean).join(" ")],
    ["MAC", hop.mac],
    ["Gateway", hop.gateway],
    ["Segment", hop.segment || hop.esi],
    ["Then in", hop.resumes_in]
  ].filter((pair): pair is [string, string] => Boolean(pair[1]));
  return (
    <Box
      data-testid="fabric-path-hop"
      data-outcome={hop.outcome}
      sx={{ display: "flex", flexDirection: "column", gap: 0.25, px: 1, py: 0.75, border: 1, borderColor: "divider", borderRadius: controlRadius, bgcolor: "background.paper", minWidth: 0 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        <Typography component="span" variant="subtitle2"><TextLink onClick={() => go(nodeRoute(hop.node))}>{hop.node}</TextLink></Typography>
        <Typography component="span" variant="caption" sx={{ color: "text.secondary" }}>{hop.ni}, looks up <Box component="span" sx={MONO_SX}>{hop.address}</Box></Typography>
        <Pill dot={outcomeTone(hop.outcome) !== "neutral"} tone={outcomeTone(hop.outcome)}>{hop.outcome}</Pill>
      </Box>
      {details.length > 0 ? (
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", fontSize: 12 }}>
          {details.map(([label, value]) => (
            <span key={label}>
              <Box component="span" sx={{ color: "text.secondary" }}>{label} </Box>
              <Box component="span" sx={MONO_SX}>{value}</Box>
            </span>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function PathTrace({ hops }: { hops: readonly FabricPathHop[] }): React.JSX.Element {
  const stages = useMemo(() => hopsByStage(hops), [hops]);
  return (
    <Box component="ol" data-testid="fabric-path-trace" sx={{ m: 0, p: 0, listStyle: "none" }}>
      {stages.map((stage, index) => (
        <Box component="li" key={stage[0]?.hop ?? index} sx={{ display: "flex", gap: 1, alignItems: "stretch" }}>
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", width: 22, flexShrink: 0 }}>
            <Box
              sx={{
                width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600,
                border: 1, borderColor: "divider", bgcolor: "background.paper", color: "text.secondary"
              }}
            >
              {stage[0]?.hop ?? index}
            </Box>
            {index < stages.length - 1 ? <Box sx={{ flex: 1, width: "1px", bgcolor: "divider" }} /> : null}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.5, pb: 1 }}>
            {stage.map((hop, hopIndex) => <HopRow key={`${hop.node}|${hop.lookup ?? 0}|${hopIndex}`} hop={hop} />)}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function PathLens(): React.JSX.Element {
  const { route, go, topology } = useFabric();
  const { source = "", destination = "", ni = "" } = route.query;
  const ready = source !== "" && destination !== "";
  const { answer, error, loading } = useLensAnswer<FabricPathHop>(
    "path",
    { source, destination, ...(ni ? { ni } : {}) },
    ready
  );
  const hops = useMemo(() => answer?.records ?? [], [answer]);
  const summary = useMemo(() => summarizePath(hops), [hops]);
  const fields = useMemo<readonly LensField[]>(() => [
    {
      name: "source",
      label: "From",
      placeholder: "A node, or a host's IP or MAC",
      required: true,
      options: (topology?.nodes ?? []).map((node) => node.name).sort(natural)
    },
    { name: "destination", label: "To", placeholder: "An IP or MAC", required: true },
    { name: "ni", label: "In", placeholder: "Network-instance, optional", width: 200 }
  ], [topology]);
  const key = `${source}|${destination}|${ni}`;
  return (
    <Box data-testid="fabric-lens-path" sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ViewHeader title="Path" detail="How the fabric would forward to an address, hop by hop. It is read from the route and bridge tables; nothing is sent." />
      <LensForm key={key} fields={fields} values={route.query} submit="Trace" onSubmit={(values) => go({ view: "lens", name: "path", query: values })} />
      {error ? <ErrorNote sx={{ mx: 2 }}>{error}</ErrorNote> : null}
      {!answer && loading ? <LoadingNote label="Asking the fabric…" sx={{ px: 2 }} /> : null}
      {!ready ? <EmptyState icon={<RouteOutlinedIcon />} title="Trace a path" detail="From a host, it enters on each leaf it is attached to." /> : null}
      {answer ? (
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 2, pb: 2, display: "flex", flexDirection: "column", gap: 1 }}>
          {summary.arrived.length > 0 ? (
            <Outcome tone="good" testId="fabric-path-outcome">
              {summary.arrived.map((hop, index) => (
                <Box key={`${hop.node}|${index}`} sx={{ display: "block" }}>
                  <b>{hop.outcome}</b> on <b>{hop.node}</b>
                  {hop.egress ? <> at <Box component="span" sx={MONO_SX}>{hop.egress}</Box></> : null}
                  {hop.mac ? <> to <Box component="span" sx={MONO_SX}>{hop.mac}</Box></> : null}
                </Box>
              ))}
            </Outcome>
          ) : null}
          {summary.failed.length > 0 ? (
            <Outcome tone="bad" testId="fabric-path-failed">
              {summary.failed.map((hop, index) => (
                <Box key={`${hop.node}|${index}`} sx={{ display: "block" }}>
                  <b>{hop.outcome}</b> on <b>{hop.node}</b> ({hop.ni}, {hop.address})
                </Box>
              ))}
            </Outcome>
          ) : null}
          {hops.length === 0 || (summary.arrived.length === 0 && summary.failed.length === 0) ? (
            <Outcome tone="warn" testId="fabric-path-unknown">The walk ended without an answer.</Outcome>
          ) : null}
          <Typography variant="caption" sx={{ color: "text.secondary" }} data-testid="fabric-path-summary">
            {summary.hops < 1 ? "No cable crossed" : `${plural(summary.hops, "hop")}: ${summary.stages.map((nodes) => (nodes.length <= 4 ? nodes.join(", ") : `${nodes.length} nodes`)).join(" → ")}`}
          </Typography>
          <Box sx={{ borderRadius: floatingRadius }}><PathTrace hops={hops} /></Box>
        </Box>
      ) : null}
    </Box>
  );
}

function EndpointsLens(): React.JSX.Element {
  const { answer, error, loading } = useLensAnswer<unknown>("endpoints", {}, true);
  const rows = answer?.rows ?? [];
  return (
    <Box data-testid="fabric-lens-endpoints" sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ViewHeader title="Endpoints" detail="Every host attached to the fabric, and where." />
      {error ? <ErrorNote sx={{ mx: 2 }}>{error}</ErrorNote> : null}
      {!answer && loading ? <LoadingNote label="Asking the fabric…" sx={{ px: 2 }} /> : null}
      {answer && rows.length === 0 ? (
        <EmptyState icon={<DevicesOtherOutlinedIcon />} title="No hosts attached" detail="A host shows up here once a service's access port learns it." />
      ) : null}
      {answer && rows.length > 0 ? <FabricDataTable columns={answer.columns ?? []} rows={rows} /> : null}
    </Box>
  );
}

export function FabricLensView({ name }: { name: string }): React.JSX.Element {
  switch (name) {
    case "path":
      return <PathLens />;
    case "service":
      return <FabricServiceLens />;
    case "endpoints":
      return <EndpointsLens />;
    default:
      return <WhereLens />;
  }
}
