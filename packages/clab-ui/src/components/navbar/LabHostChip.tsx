// The lab host of the open lab in the toolbar: its status dot, name and runtime.
// A click opens the host's settings.
import React from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import {
  labHostCompactName,
  labHostStatusWord,
  labHostTagLabel,
  type LabHostIdentity
} from "../../host/labHostIdentity";
import { CAP_CENTERED_TEXT_SX } from "../../theme/typography";

import { LabHostRuntimeIcon } from "./LabHostRuntimeIcon";

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
        {labHostCompactName(host)}
      </Typography>
      <Typography variant="caption">{labHostTagLabel(host)}</Typography>
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
 * `● Local [Docker icon]`: where the open lab runs. Narrow toolbars shorten
 * the name; the tiniest keep the dot and the icon. The tooltip has the rest.
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
  const name = labHostCompactName(host);
  const content = (
    <>
      <Box
        aria-hidden="true"
        data-testid="lab-host-chip-dot"
        data-status={host.status ?? "connected"}
        sx={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          flex: "0 0 auto",
          bgcolor: STATUS_COLORS[host.status ?? "connected"]
        }}
      />
      <Typography
        component="span"
        variant="subtitle2"
        noWrap
        sx={{
          ...CAP_CENTERED_TEXT_SX,
          color: "text.primary",
          maxWidth: 180,
          [narrow]: { maxWidth: 96 },
          [tiny]: { display: "none" }
        }}
      >
        {name}
      </Typography>
      <LabHostRuntimeIcon host={host} />
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
  const label = `Lab host ${name}, ${labHostTagLabel(host)}${status ? `, ${status}` : ""}`;
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
