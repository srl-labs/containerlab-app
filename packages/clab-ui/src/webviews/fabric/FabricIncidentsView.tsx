/** What is wrong, by root cause, worst first; and what changed just before each. */
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import React, { useState } from "react";

import { controlRadius, floatingRadius } from "../../theme/surfaces";

import { FabricChangeRow } from "./FabricChangeRow";
import { useFabric } from "./fabricContext";
import { errorMessage, useFabricAnswer } from "./fabricData";
import { ago, plural } from "./fabricFormat";
import { nodeRoute } from "./fabricRoute";
import type { FabricChange, FabricIncident, FabricSeverity } from "./fabricTypes";
import {
  EmptyState,
  ErrorNote,
  INLINE_TABLE_SX,
  LoadingNote,
  MONO_SX,
  Pill,
  SECTION_TITLE_SX,
  SEVERITY_TONES,
  TextLink,
  toneColor,
  ViewHeader
} from "./fabricUi";

/** How far before an incident started to look for what changed. */
const LOOKBACK_SECONDS = 15 * 60;
/** Raised this soon after the engine started: the history cannot say what led up to it. */
const STARTUP_SECONDS = 90;
const SHOWN_CHANGES = 12;
const SHOWN_RELATED = 8;

function WhatChangedBefore({ incident }: { incident: FabricIncident }): React.JSX.Element {
  const { client, status } = useFabric();
  const started = status?.started ?? 0;
  const firstSeen = incident.first_seen ?? 0;
  const atStart = started > 0 && firstSeen - started < STARTUP_SECONDS;
  const [open, setOpen] = useState(!atStart);
  const [all, setAll] = useState(false);
  const { answer, error } = useFabricAnswer<FabricChange[]>(client, {
    method: "GET",
    path: "history",
    query: {
      since: String(firstSeen - LOOKBACK_SECONDS),
      until: String(firstSeen),
      node: incident.nodes,
      limit: "200"
    }
  });
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!answer) return <LoadingNote label="Reading the history…" />;
  const changes = [...answer].reverse();
  if (changes.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        Nothing changed on {incident.nodes.length > 3 ? `its ${incident.nodes.length} nodes` : incident.nodes.join(", ")} in the 15 minutes before.
      </Typography>
    );
  }
  return (
    <>
      {atStart ? (
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 0.5 }}>
          Raised as the engine started, so these changes are the first sync, not what led up to this.{" "}
          <TextLink onClick={() => setOpen(!open)}>{open ? "Hide them" : "Show them"}</TextLink>
        </Typography>
      ) : null}
      {open ? (
        <>
          <Box component="ul" sx={{ m: 0, p: 0, border: 1, borderColor: "divider", borderRadius: controlRadius, overflow: "hidden" }}>
            {(all ? changes : changes.slice(0, SHOWN_CHANGES)).map((change) => <FabricChangeRow key={change.seq} change={change} />)}
          </Box>
          {!all && changes.length > SHOWN_CHANGES ? (
            <Button size="small" variant="text" sx={{ mt: 0.5 }} onClick={() => setAll(true)}>Show {changes.length - SHOWN_CHANGES} more</Button>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function AckButton({ incident }: { incident: FabricIncident }): React.JSX.Element {
  const { client, reloadCore } = useFabric();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const acknowledged = incident.acknowledged === true;
  const act = () => {
    setBusy(true);
    setError(undefined);
    const request = acknowledged
      ? client.api({ method: "DELETE", path: "acks", query: { incident: incident.id } })
      : client.api({ method: "POST", path: "acks", body: { incident: incident.id } });
    request.then(reloadCore, (reason: unknown) => setError(errorMessage(reason))).finally(() => setBusy(false));
  };
  return (
    <Button
      size="small"
      variant="outlined"
      disabled={busy}
      data-testid={`fabric-ack-${incident.id}`}
      title={error ?? (acknowledged ? "Show it as open again" : "Known: take it out of the counts until a finding joins it or it clears")}
      color={error ? "error" : undefined}
      onClick={(event) => {
        event.stopPropagation();
        act();
      }}
      sx={{ flexShrink: 0 }}
    >
      {acknowledged ? "Unack" : "Ack"}
    </Button>
  );
}

function IncidentCard({ incident, defaultOpen }: { incident: FabricIncident; defaultOpen: boolean }): React.JSX.Element {
  const { go, at } = useFabric();
  const [open, setOpen] = useState(defaultOpen);
  const [allRelated, setAllRelated] = useState(false);
  const findings = 1 + incident.related.length;
  const related = allRelated ? incident.related : incident.related.slice(0, SHOWN_RELATED);
  return (
    <Box
      component="article"
      data-testid={`fabric-incident-${incident.id}`}
      data-severity={incident.severity}
      sx={{
        border: 1, borderColor: "divider", borderRadius: floatingRadius, bgcolor: "background.paper", overflow: "hidden",
        borderLeft: `3px solid ${toneColor(SEVERITY_TONES[incident.severity])}`, opacity: incident.acknowledged ? 0.8 : 1
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, pr: 1 }}>
        <ButtonBase
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          sx={{
            flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 1, flexWrap: "wrap", textAlign: "left", px: 1, py: 0.75,
            "&.Mui-focusVisible": { outline: "1px solid var(--clab-ui-focus-border, var(--vscode-focusBorder))", outlineOffset: -1 }
          }}
        >
          {open ? <ExpandMoreIcon fontSize="small" sx={{ color: "text.secondary" }} /> : <ChevronRightIcon fontSize="small" sx={{ color: "text.secondary" }} />}
          <Pill dot tone={SEVERITY_TONES[incident.severity]}>{incident.severity}</Pill>
          <Typography component="h3" variant="subtitle2" sx={{ flex: "1 1 220px", minWidth: 0 }}>{incident.title}</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {[incident.kind, plural(findings, "finding"), incident.first_seen ? `since ${ago(incident.first_seen)}` : ""].filter(Boolean).join(" · ")}
            {incident.acknowledged && incident.ack?.at ? ` · acknowledged ${ago(incident.ack.at)}` : ""}
          </Typography>
        </ButtonBase>
        {at === undefined ? <AckButton incident={incident} /> : null}
      </Box>
      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", px: 1.25, pb: 0.75 }}>
        {incident.nodes.slice(0, 12).map((node) => (
          <Chip key={node} size="small" variant="outlined" label={node} onClick={() => go(nodeRoute(node))} />
        ))}
        {incident.nodes.length > 12 ? <Typography variant="caption" sx={{ color: "text.secondary" }}>+{incident.nodes.length - 12} more</Typography> : null}
      </Box>
      {open ? (
        <Box sx={{ px: 1.5, pb: 1.25, borderTop: 1, borderColor: "divider" }}>
          {incident.explanation ? <Typography variant="body2" sx={{ mt: 1 }}>{incident.explanation}</Typography> : null}
          <Typography variant="overline" component="h4" sx={SECTION_TITLE_SX}>Root</Typography>
          <Typography variant="body2">
            <b>{incident.root.check}</b> on <Box component="span" sx={MONO_SX}>{incident.root.node} {incident.root.subject}</Box>: {incident.root.detail}
          </Typography>
          {related.length > 0 ? (
            <>
              <Typography variant="overline" component="h4" sx={SECTION_TITLE_SX}>{incident.kind === "pattern" ? "The same elsewhere" : "Consequences"}</Typography>
              <Box sx={{ overflowX: "auto" }}>
                <Box component="table" sx={INLINE_TABLE_SX}>
                  <thead>
                    <tr><th>Check</th><th>Node</th><th>Subject</th><th>Detail</th></tr>
                  </thead>
                  <tbody>
                    {related.map((finding) => (
                      <tr key={`${finding.node}|${finding.check}|${finding.subject}`}>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <Box component="span" sx={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", mr: 0.75, bgcolor: toneColor(SEVERITY_TONES[finding.severity]) }} />
                          {finding.check}
                        </td>
                        <td>{finding.node}</td>
                        <td><Box component="span" sx={MONO_SX}>{finding.subject}</Box></td>
                        <td>{finding.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </Box>
              </Box>
              {related.length < incident.related.length ? (
                <Button size="small" variant="text" sx={{ mt: 0.5 }} onClick={() => setAllRelated(true)}>Show {incident.related.length - related.length} more</Button>
              ) : null}
            </>
          ) : null}
          {incident.first_seen && at === undefined ? (
            <>
              <Typography variant="overline" component="h4" sx={SECTION_TITLE_SX}>What changed just before</Typography>
              <WhatChangedBefore incident={incident} />
            </>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

function FoldedSection({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Box component="section" sx={{ mt: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
        <IconButton size="small" aria-label={open ? "Fold" : "Unfold"} aria-expanded={open} data-testid={testId} onClick={() => setOpen(!open)}>
          {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
        </IconButton>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>{title}</Typography>
      </Box>
      {open ? <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 0.5 }}>{children}</Box> : null}
    </Box>
  );
}

const SEVERITIES: readonly FabricSeverity[] = ["error", "warning", "info"];

function worstFirst(a: FabricIncident, b: FabricIncident): number {
  return SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
}

export function FabricIncidentsView(): React.JSX.Element {
  const { incidents, coreError, at } = useFabric();
  const [only, setOnly] = useState<FabricSeverity | "acknowledged">();
  const all = incidents ?? [];
  const open = all.filter((incident) => !incident.acknowledged).sort(worstFirst);
  const acknowledged = all.filter((incident) => incident.acknowledged);
  const faults = open.filter((incident) => incident.severity !== "info");
  const info = open.filter((incident) => incident.severity === "info");
  const picked = only === "acknowledged" ? acknowledged : open.filter((incident) => incident.severity === only);
  const counts: ReadonlyArray<readonly [FabricSeverity | "acknowledged", number, string]> = [
    ...SEVERITIES.map((severity) => {
      const count = open.filter((incident) => incident.severity === severity).length;
      return [severity, count, severity === "info" || count === 1 ? severity : `${severity}s`] as const;
    }),
    ...(acknowledged.length > 0 ? [["acknowledged", acknowledged.length, "acknowledged"] as const] : [])
  ];
  // The first faults are open from the start: they are what this view is opened for.
  const card = (incident: FabricIncident, index: number) => (
    <IncidentCard key={incident.id} incident={incident} defaultOpen={incident.severity === "error" && index === 0} />
  );
  return (
    <Box data-testid="fabric-incidents" sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ViewHeader
        title="Incidents"
        detail="Findings grouped by root cause, worst first."
        actions={(
          <Box role="group" aria-label="Show only" sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {counts.map(([name, count, label]) => (
              <Chip
                key={name}
                size="small"
                label={`${count} ${label}`}
                aria-pressed={only === name}
                data-testid={`fabric-incidents-only-${name}`}
                color={only === name ? "primary" : "default"}
                variant={only === name ? "filled" : "outlined"}
                onClick={() => setOnly(only === name ? undefined : name)}
                sx={{ borderRadius: controlRadius }}
              />
            ))}
          </Box>
        )}
      />
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 2, pb: 2, display: "flex", flexDirection: "column", gap: 1 }}>
        {!incidents && !coreError ? <LoadingNote label="Reading the incidents…" /> : null}
        {incidents && only && picked.length > 0 ? picked.map(card) : null}
        {incidents && only && picked.length === 0 ? <EmptyState title={`No ${only} incidents${at === undefined ? "" : " at that time"}`} /> : null}
        {incidents && !only ? (
          <>
            {faults.length > 0 ? faults.map(card) : (
              <EmptyState
                icon={<CheckCircleOutlineIcon />}
                title="Nothing wrong"
                detail={`No errors or warnings${at === undefined ? "" : " at that time"}.`}
              />
            )}
            {info.length > 0 ? (
              <FoldedSection title={`Information (${info.length}): often by design`} testId="fabric-incidents-info">
                {info.map((incident) => <IncidentCard key={incident.id} incident={incident} defaultOpen={false} />)}
              </FoldedSection>
            ) : null}
            {acknowledged.length > 0 ? (
              <FoldedSection title={`Acknowledged (${acknowledged.length}): known, until a finding joins or it clears`} testId="fabric-incidents-acknowledged">
                {acknowledged.map((incident) => <IncidentCard key={incident.id} incident={incident} defaultOpen={false} />)}
              </FoldedSection>
            ) : null}
          </>
        ) : null}
      </Box>
    </Box>
  );
}
