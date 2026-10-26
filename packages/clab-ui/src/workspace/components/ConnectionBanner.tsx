import React, { useEffect, useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import CloudOffOutlinedIcon from "@mui/icons-material/CloudOffOutlined";
import LockClockOutlinedIcon from "@mui/icons-material/LockClockOutlined";
import SyncProblemOutlinedIcon from "@mui/icons-material/SyncProblemOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { connectionApiLabel, connectionEventsLabel } from "../state/endpointStatus";
import type { EndpointConnectionIssue } from "../types";
import { useNow } from "../useNow";

type Severity = "error" | "warning";

function issueSeverity(issue: EndpointConnectionIssue): Severity {
  return issue.api === "unreachable" ? "error" : "warning";
}

/** Stays the same while a stream retries, so a hidden strip stays hidden until the problem changes. */
function issueKey(issue: EndpointConnectionIssue): string {
  const eventsFailing = issue.events !== undefined && issue.events.state !== "connected";
  return `${issue.endpointId}:${issue.api}:${eventsFailing ? "events" : ""}`;
}

function IssueIcon({ issue }: { issue: EndpointConnectionIssue }) {
  const sx = { fontSize: 18, color: `${issueSeverity(issue)}.main`, flexShrink: 0 };
  if (issue.api === "unreachable") return <CloudOffOutlinedIcon sx={sx} />;
  if (issue.api === "session_expired") return <LockClockOutlinedIcon sx={sx} />;
  return <SyncProblemOutlinedIcon sx={sx} />;
}

function StatusPart({ label, value, healthy }: { label: string; value: string; healthy: boolean }) {
  return (
    <Typography component="span" variant="caption" noWrap sx={{ color: "text.secondary", flexShrink: 0 }}>
      {label}:{" "}
      <Box component="span" sx={{ color: healthy ? "text.secondary" : "text.primary", fontWeight: healthy ? 400 : 600 }}>
        {value}
      </Box>
    </Typography>
  );
}

function ConnectionIssueRow({ issue, now, onDismiss, onRetry, onSignIn }: {
  issue: EndpointConnectionIssue;
  now: number;
  onDismiss: () => void;
  onRetry: (endpointId: string) => void;
  onSignIn: (endpointId: string) => void;
}) {
  const severity = issueSeverity(issue);
  const retrying = issue.events?.state === "connecting";
  return (
    <Box
      data-testid={`connection-banner-${issue.endpointId}`}
      data-severity={severity}
      sx={(theme) => ({
        display: "flex", alignItems: "center", gap: 1, minHeight: 32, px: 1.5, py: 0.25, flexWrap: "wrap",
        borderBottom: 1, borderColor: "divider",
        bgcolor: `color-mix(in srgb, ${theme.palette[severity].main} 12%, ${theme.palette.background.default})`,
        "@media (forced-colors: active)": { bgcolor: "Canvas", borderColor: "CanvasText" }
      })}
    >
      <IssueIcon issue={issue} />
      <Typography component="span" variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0, flexShrink: 1 }}>
        {issue.label}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", minWidth: 0, flex: 1 }}>
        <StatusPart label="API" value={connectionApiLabel(issue.api)} healthy={issue.api === "reachable"} />
        {issue.events ? (
          <Tooltip title={issue.events.error ?? ""} disableHoverListener={!issue.events.error}>
            <span>
              <StatusPart
                label="Live events"
                value={connectionEventsLabel(issue.events, now)}
                healthy={issue.events.state === "connected"}
              />
            </span>
          </Tooltip>
        ) : null}
      </Box>
      {issue.api === "session_expired" ? (
        <Button size="small" variant="text" onClick={() => onSignIn(issue.endpointId)}>Sign in</Button>
      ) : (
        <Button size="small" variant="text" disabled={retrying} onClick={() => onRetry(issue.endpointId)}>
          {retrying ? "Retrying…" : "Retry now"}
        </Button>
      )}
      <IconButton size="small" aria-label={`Hide connection status of ${issue.label}`} onClick={onDismiss} sx={{ p: 0.25 }}>
        <CloseIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  );
}

/** In place of a lab whose lab host does not answer; the lab loads once the host is back. */
export function LabHostUnavailable({ labTitle, hostLabel, needsSignIn, onRetry, onSignIn }: {
  labTitle: string;
  hostLabel: string;
  needsSignIn: boolean;
  onRetry: () => void;
  onSignIn: () => void;
}): React.JSX.Element {
  return (
    <Box
      data-testid="lab-host-unavailable"
      sx={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 1, px: 3, textAlign: "center", bgcolor: "background.default", color: "text.primary", pointerEvents: "auto"
      }}
    >
      {needsSignIn
        ? <LockClockOutlinedIcon sx={{ fontSize: 40, color: "warning.main" }} />
        : <CloudOffOutlinedIcon sx={{ fontSize: 40, color: "error.main" }} />}
      <Typography variant="subtitle1">
        {needsSignIn ? `Sign in to ${hostLabel} again` : `${hostLabel} does not answer`}
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 440 }}>
        {needsSignIn
          ? `${labTitle} opens once you are signed in. Other lab hosts keep working.`
          : `${labTitle} opens as soon as the lab host answers again. Other lab hosts keep working.`}
      </Typography>
      {needsSignIn
        ? <Button variant="contained" onClick={onSignIn} sx={{ mt: 1 }}>Sign in</Button>
        : <Button variant="outlined" onClick={onRetry} sx={{ mt: 1 }}>Retry now</Button>}
    </Box>
  );
}

/**
 * One strip per lab host with a connection problem. The rest of the workspace keeps
 * working; the strip shows the API and the live-events stream separately.
 */
export function ConnectionBanner({ issues, onRetry, onSignIn }: {
  issues: EndpointConnectionIssue[];
  onRetry: (endpointId: string) => void;
  onSignIn: (endpointId: string) => void;
}): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  // Forget hidden problems that resolved, so the next one shows again.
  useEffect(() => {
    const keys = new Set(issues.map(issueKey));
    setDismissed((current) => [...current].every((key) => keys.has(key)) ? current : new Set([...current].filter((key) => keys.has(key))));
  }, [issues]);
  const visible = issues.filter((issue) => !dismissed.has(issueKey(issue)));
  const counting = visible.some((issue) => issue.events?.retryAt !== undefined);
  const now = useNow(counting ? 1000 : null);
  if (visible.length === 0) return null;
  return (
    <Box role="region" aria-label="Lab host connection problems" data-testid="connection-banner" sx={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      {visible.map((issue) => (
        <ConnectionIssueRow
          key={issue.endpointId}
          issue={issue}
          now={now}
          onRetry={onRetry}
          onSignIn={onSignIn}
          onDismiss={() => setDismissed((current) => new Set(current).add(issueKey(issue)))}
        />
      ))}
    </Box>
  );
}
