/** The small pieces every Fabric view is made of. */
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import React from "react";

import { controlRadius } from "../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../theme/typography";
import { vscodePalette } from "../../theme/vscodePalette";

import type { FabricFindingCounts, FabricSeverity } from "./fabricTypes";

export type FabricTone = "good" | "bad" | "warn" | "info" | "neutral";

const TONE_COLORS: Readonly<Record<FabricTone, string>> = {
  good: vscodePalette.success.main,
  bad: vscodePalette.error.main,
  warn: vscodePalette.warning.main,
  info: vscodePalette.info.main,
  neutral: vscodePalette.text.secondary
};

export const SEVERITY_TONES: Readonly<Record<FabricSeverity, FabricTone>> = {
  error: "bad",
  warning: "warn",
  info: "info"
};

export function toneColor(tone: FabricTone): string {
  return TONE_COLORS[tone];
}

export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

export const MONO_SX = { fontFamily: MONO_FONT_FAMILY, fontSize: "0.95em" } as const;

/** A small state word: the colour is a tint and a dot beside text that stays readable. */
export function Pill({ tone = "neutral", dot = false, title, testId, children }: {
  tone?: FabricTone;
  dot?: boolean;
  title?: string;
  testId?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const color = TONE_COLORS[tone];
  return (
    <Box
      component="span"
      title={title}
      data-testid={testId}
      sx={{
        display: "inline-flex", alignItems: "center", gap: 0.5, height: 20, px: 0.75, flexShrink: 0,
        borderRadius: controlRadius, fontSize: 11, fontWeight: 500, lineHeight: 1, whiteSpace: "nowrap",
        color: "text.primary", bgcolor: tint(color, tone === "neutral" ? 10 : 16),
        border: `1px solid ${tint(color, 28)}`
      }}
    >
      {dot ? <Box component="span" sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} /> : null}
      {children}
    </Box>
  );
}

/** A count of findings on a node or cable: red for errors, amber for warnings. */
export function FindingBadges({ findings }: { findings: FabricFindingCounts | undefined }): React.JSX.Element | null {
  const { error = 0, warning = 0 } = findings ?? {};
  if (error === 0 && warning === 0) return null;
  return (
    <Box component="span" sx={{ display: "inline-flex", gap: 0.5 }}>
      {error > 0 ? <Pill tone="bad" title={`${error} errors`}>{error}</Pill> : null}
      {warning > 0 ? <Pill tone="warn" title={`${warning} warnings`}>{warning}</Pill> : null}
    </Box>
  );
}

/** The title row of a view. */
export function ViewHeader({ title, code, detail, pills, actions }: {
  title: React.ReactNode;
  /** The name the CLI knows it by. */
  code?: string;
  detail?: React.ReactNode;
  pills?: React.ReactNode;
  actions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, px: 2, pt: 1.5, pb: 1, flexShrink: 0, flexWrap: "wrap" }}>
      <Box sx={{ flex: "1 1 240px", minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography component="h2" variant="subtitle1">{title}</Typography>
          {code ? <Typography component="code" variant="caption" sx={{ ...MONO_SX, color: "text.secondary" }}>{code}</Typography> : null}
          {pills}
        </Box>
        {detail ? <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 0.25 }}>{detail}</Typography> : null}
      </Box>
      {actions ? <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>{actions}</Box> : null}
    </Box>
  );
}

export function LoadingNote({ label, sx }: { label: string; sx?: SxProps<Theme> }): React.JSX.Element {
  return (
    <Box role="status" sx={[{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary", py: 1 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <CircularProgress size={14} color="inherit" />
      <Typography variant="body2">{label}</Typography>
    </Box>
  );
}

export function ErrorNote({ children, sx }: { children: React.ReactNode; sx?: SxProps<Theme> }): React.JSX.Element {
  return (
    <Box
      role="alert"
      sx={[{
        display: "flex", alignItems: "flex-start", gap: 1, px: 1.25, py: 1, borderRadius: controlRadius,
        bgcolor: tint(TONE_COLORS.bad, 10), border: `1px solid ${tint(TONE_COLORS.bad, 30)}`
      }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      <ErrorOutlineIcon fontSize="small" sx={{ color: "error.main", mt: "1px" }} />
      <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>{children}</Typography>
    </Box>
  );
}

export function EmptyState({ icon, title, detail, action }: {
  icon?: React.ReactNode;
  title: string;
  detail?: React.ReactNode;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 1, py: 6, px: 2 }}>
      {icon ? <Box sx={{ color: "text.disabled", display: "flex", "& svg": { fontSize: 36 } }}>{icon}</Box> : null}
      <Typography variant="subtitle1">{title}</Typography>
      {detail ? <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 460 }}>{detail}</Typography> : null}
      {action}
    </Box>
  );
}

/** Text that acts on click, in a line of other text. */
export function TextLink({ onClick, title, testId, mono = false, children }: {
  onClick: () => void;
  title?: string;
  testId?: string;
  mono?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      title={title}
      data-testid={testId}
      onClick={(event: React.MouseEvent) => {
        event.stopPropagation();
        onClick();
      }}
      sx={{
        all: "unset", cursor: "pointer", color: "var(--vscode-textLink-foreground)", ...(mono ? MONO_SX : {}),
        "&:hover": { textDecoration: "underline" },
        "&:focus-visible": { outline: "1px solid var(--clab-ui-focus-border, var(--vscode-focusBorder))", outlineOffset: 1 }
      }}
    >
      {children}
    </Box>
  );
}

/** Key and value pairs, in the details of a node or a change. A pair without a value is left out. */
export function FieldList({ fields }: { fields: ReadonlyArray<readonly [string, React.ReactNode]> }): React.JSX.Element {
  const shown = fields.filter(([, value]) => value !== undefined && value !== null && value !== "" && value !== false);
  return (
    <Box
      component="dl"
      sx={{
        display: "grid", gridTemplateColumns: "minmax(72px, max-content) minmax(0, 1fr)", columnGap: 1.5, rowGap: 0.5, m: 0,
        fontSize: 12, "& dt": { color: "text.secondary" }, "& dd": { m: 0, minWidth: 0, overflowWrap: "anywhere" }
      }}
    >
      {shown.map(([name, value]) => (
        <React.Fragment key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </React.Fragment>
      ))}
    </Box>
  );
}

/** A plain table, cheap to draw with many rows: the styles sit on the table, not on every cell. */
export const TABLE_SX = {
  width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12, fontVariantNumeric: "tabular-nums",
  "& thead": { position: "sticky", top: 0, zIndex: 1 },
  "& th": {
    textAlign: "left", fontWeight: 600, color: "text.secondary", bgcolor: "background.default", verticalAlign: "bottom",
    whiteSpace: "nowrap", px: 1, py: 0.5, borderBottom: 1, borderColor: "divider"
  },
  "& td": {
    px: 1, py: 0.5, verticalAlign: "top", borderBottom: `1px solid ${tint(vscodePalette.divider, 55)}`
  },
  "& tbody tr:hover td": { bgcolor: "action.hover" }
} as const;

/** A table without a scroll area of its own, inside a card or a panel. */
export const INLINE_TABLE_SX = {
  ...TABLE_SX,
  "& thead": {},
  "& th": { ...TABLE_SX["& th"], bgcolor: "transparent" }
} as const;

export const SECTION_TITLE_SX = { color: "text.secondary", mt: 1.5, mb: 0.5, display: "block" } as const;
