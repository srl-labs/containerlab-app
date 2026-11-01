// The lab host of the open lab in the toolbar: its status dot, name and kind,
// as the explorer root shows it. A click opens the host's settings.
import React from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import {
  labHostKindLabel,
  labHostShortLabel,
  labHostStatusWord,
  labHostTagLabel,
  type LabHostIdentity
} from "../../host/labHostIdentity";

const STATUS_COLORS: Record<NonNullable<LabHostIdentity["status"]>, string> = {
  connected: "success.main",
  saved: "text.disabled",
  session_expired: "warning.main",
  offline: "error.main"
};

/** The tooltip: name, kind and runtime, where labs go, status, and what a click does. */
function ChipTooltip(props: { host: LabHostIdentity; clickable: boolean }) {
  const { host } = props;
  const status = labHostStatusWord(host);
  return (
    <Box sx={{ display: "grid", gap: 0.25, py: 0.25 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {host.label}
      </Typography>
      <Typography variant="caption">{labHostKindLabel(host)}</Typography>
      {(host.details ?? []).map((line) => (
        <Typography key={line} variant="caption" sx={{ overflowWrap: "anywhere" }}>
          {line}
        </Typography>
      ))}
      {status ? <Typography variant="caption">{status}</Typography> : null}
      {props.clickable ? (
        <Typography variant="caption" sx={{ opacity: 0.75, mt: 0.25 }}>
          Click for this lab host&apos;s settings
        </Typography>
      ) : null}
    </Box>
  );
}

/**
 * `● c9s-dev · API Server · c9s`: where the open lab runs. Narrow toolbars
 * keep the dot, a shortened name and "API · c9s"; the tiniest the dot and
 * "API · c9s". The tooltip has the rest.
 */
export function LabHostChip(props: {
  host: LabHostIdentity;
  onOpen?: () => void;
  /** The size container of the toolbar, whose width decides what shows. */
  container?: string;
}) {
  const { host, onOpen } = props;
  const narrow = props.container ? `@container ${props.container} (max-width: 640px)` : "@media (max-width: 640px)";
  const tiny = props.container ? `@container ${props.container} (max-width: 420px)` : "@media (max-width: 420px)";
  const status = labHostStatusWord(host);
  const content = (
    <>
      <Box
        aria-hidden="true"
        data-testid="lab-host-chip-dot"
        data-status={host.status ?? "connected"}
        sx={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          flex: "0 0 auto",
          bgcolor: STATUS_COLORS[host.status ?? "connected"]
        }}
      />
      <Typography
        component="span"
        variant="caption"
        noWrap
        sx={{
          fontWeight: 600,
          color: "text.primary",
          maxWidth: 180,
          [narrow]: { maxWidth: 96 },
          [tiny]: { display: "none" }
        }}
      >
        {host.label}
      </Typography>
      <Typography
        component="span"
        variant="caption"
        noWrap
        data-testid="lab-host-chip-kind"
        sx={{ color: "text.secondary", flex: "0 0 auto", [narrow]: { display: "none" } }}
      >
        · {labHostTagLabel(host)}
      </Typography>
      <Typography
        component="span"
        variant="caption"
        noWrap
        data-testid="lab-host-chip-runtime"
        sx={{ display: "none", color: "text.secondary", flex: "0 0 auto", [narrow]: { display: "inline" } }}
      >
        {labHostShortLabel(host)}
      </Typography>
    </>
  );
  const sx = {
    display: "inline-flex",
    alignItems: "center",
    gap: 0.75,
    height: 28,
    px: 1,
    borderRadius: 1,
    minWidth: 0,
    maxWidth: 280,
    border: 1,
    borderColor: "divider",
    "&:hover": onOpen ? { bgcolor: "action.hover" } : undefined
  } as const;
  const label = `Lab host ${host.label}, ${labHostKindLabel(host)}${status ? `, ${status}` : ""}`;
  return (
    <Tooltip title={<ChipTooltip host={host} clickable={onOpen !== undefined} />} placement="bottom-start" enterDelay={300}>
      {onOpen ? (
        <ButtonBase data-testid="lab-host-chip" aria-label={label} onClick={onOpen} sx={sx}>
          {content}
        </ButtonBase>
      ) : (
        <Box data-testid="lab-host-chip" role="note" aria-label={label} sx={sx}>
          {content}
        </Box>
      )}
    </Tooltip>
  );
}
