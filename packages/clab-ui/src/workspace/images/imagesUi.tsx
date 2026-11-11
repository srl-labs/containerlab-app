// Small building blocks shared by the Images view panes, in the look of the labs
// overview and the image manager: quiet status dots, tone-tinted chips, overline
// section titles and centered empty states.
import React from "react";
import BlockOutlinedIcon from "@mui/icons-material/BlockOutlined";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";

import { MONO_FONT_FAMILY } from "../../theme/typography";
import type { ImagesUnavailableInfo } from "./types";

export type Tone = "success" | "warning" | "error" | "info" | "accent" | "default";

function toneColor(theme: Theme, tone: Tone): string {
  if (tone === "default") return theme.palette.text.secondary;
  if (tone === "accent") return theme.palette.primary.main;
  return theme.palette[tone].main;
}

export const MONO_SX = { fontFamily: MONO_FONT_FAMILY, overflowWrap: "anywhere" } as const;

/** Why Pull is off for an entry that has no buildable kind. */
export const NOT_BUILDABLE_REASON = "No vrnetlab kind exists for this entry, so it cannot be pulled or built here. It is listed so it can be found.";

const RECORD_TONES: Record<string, Tone> = { built: "success", cached: "info", available: "default" };
const RECORD_LABELS: Record<string, string> = {
  built: "Built",
  cached: "Cached",
  available: "Available",
  unbuildable: "Not buildable",
  "missing-file": "File missing",
  noop: "Already built"
};
const RECORD_HINTS: Record<string, string> = {
  built: "The image is built and on this host.",
  cached: "The source file is on this host; it is not built yet.",
  available: "On LabHub; pulling downloads and builds it.",
  unbuildable: NOT_BUILDABLE_REASON
};

export const recordTone = (status: string): Tone => RECORD_TONES[status] ?? "warning";
export const recordStatusLabel = (status: string): string => RECORD_LABELS[status] ?? status;
export const recordStatusHint = (status: string): string | undefined => RECORD_HINTS[status];

/** An 8 px dot in the tone's color, with its meaning for screen readers. */
export function StatusDot({ tone, label, testId }: { tone: Tone; label: string; testId?: string }): React.JSX.Element {
  return (
    <Box
      role="img"
      aria-label={label}
      data-testid={testId}
      sx={(theme) => ({ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, bgcolor: toneColor(theme, tone) })}
    />
  );
}

/** A dot followed by its label, in one line. */
export function StatusLabel({ tone, label, title }: { tone: Tone; label: string; title?: string }): React.JSX.Element {
  return (
    <Box component="span" title={title} sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
      <StatusDot tone={tone} label={label} />
      <Typography component="span" variant="body2" noWrap>{label}</Typography>
    </Box>
  );
}

/** The overline title of a pane section, with an optional count and actions on the right. */
export function PaneTitle({ title, count, actions, id }: {
  title: string;
  count?: number;
  actions?: React.ReactNode;
  id?: string;
}): React.JSX.Element {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minHeight: 32, px: 1.5, flexShrink: 0 }}>
      <Typography id={id} component="h2" variant="overline" sx={{ color: "text.secondary", lineHeight: 1.5 }}>{title}</Typography>
      {count !== undefined ? <Typography component="span" variant="caption" sx={{ color: "text.secondary" }}>{count}</Typography> : null}
      <Box sx={{ flex: 1 }} />
      {actions}
    </Box>
  );
}

/** A label and its value in the details pane. */
export function Field({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }): React.JSX.Element {
  return (
    <>
      <Typography component="dt" variant="caption" sx={{ color: "text.secondary", pt: "2px" }}>{label}</Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, minWidth: 0, ...(mono ? MONO_SX : { overflowWrap: "anywhere" }) }}>
        {children}
      </Typography>
    </>
  );
}

export function EmptyMessage({ icon, title, detail, action, testId }: {
  icon: React.ReactNode;
  title: string;
  detail?: React.ReactNode;
  action?: React.ReactNode;
  testId?: string;
}): React.JSX.Element {
  return (
    <Box
      data-testid={testId}
      sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 1, py: 6, px: 2 }}
    >
      <Box sx={{ color: "text.disabled", display: "flex", "& svg": { fontSize: 36 } }}>{icon}</Box>
      <Typography variant="subtitle1">{title}</Typography>
      {detail ? <Typography variant="body2" component="div" sx={{ color: "text.secondary", maxWidth: 440 }}>{detail}</Typography> : null}
      {action}
    </Box>
  );
}

/** Why the view does nothing for this lab host, with the settings that turn it on. */
export function UnavailablePanel({ info }: { info: ImagesUnavailableInfo }): React.JSX.Element {
  const keys = info.configKeys ?? [];
  const notConfigured = keys.length > 0;
  return (
    <Box
      data-testid="images-unavailable"
      sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, px: 3, textAlign: "center" }}
    >
      <BlockOutlinedIcon sx={{ fontSize: 40, color: "text.disabled" }} />
      <Typography variant="subtitle1">
        {notConfigured ? "The image manager is not configured" : "Images are not available here"}
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 480 }}>{info.detail}</Typography>
      {notConfigured ? (
        <Box sx={{ mt: 1.5, textAlign: "left", border: 1, borderColor: "divider", borderRadius: "6px", bgcolor: "background.paper", px: 2, py: 1.25, minWidth: 320 }}>
          <Typography variant="caption" component="p" sx={{ color: "text.secondary", mb: 0.75 }}>
            Set these on the app server, then restart it:
          </Typography>
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "grid", gap: 0.5 }}>
            {keys.map((key) => (
              <Typography key={key} component="li" variant="body2" data-testid="images-config-key" sx={MONO_SX}>{key}</Typography>
            ))}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
