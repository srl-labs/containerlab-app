import React from "react";
import { Box, Button, ButtonBase, IconButton, Tooltip, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import TuneIcon from "@mui/icons-material/Tune";

import { resolveAppTheme, type AppTheme } from "../../theme/appThemes";
import { customizedColorCount, type CustomTheme } from "../../theme/customThemes";
import { TERMINAL_ANSI_TOKENS, type VarMap } from "../../theme/devTheme";

const SELECTED_RING = "0 0 0 1px var(--clab-ui-button-background, var(--vscode-button-background))";
const SWATCH_TOKENS = [
  "--vscode-button-background",
  TERMINAL_ANSI_TOKENS.red,
  TERMINAL_ANSI_TOKENS.green,
  TERMINAL_ANSI_TOKENS.blue
] as const;

/** A theme's background, sidebar, accent and a few terminal colors at a glance. */
function ThemeSwatch({ vars }: { vars: VarMap }) {
  return (
    <Box
      aria-hidden
      style={{ background: vars["--vscode-editor-background"] }}
      sx={{
        width: 46,
        height: 30,
        flexShrink: 0,
        display: "flex",
        overflow: "hidden",
        borderRadius: 0.75,
        border: "1px solid rgba(128, 128, 128, 0.45)"
      }}
    >
      <Box style={{ background: vars["--vscode-sideBar-background"] }} sx={{ width: 10 }} />
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "3px" }}>
        {SWATCH_TOKENS.map((token) => (
          <Box key={token} style={{ background: vars[token] }} sx={{ width: 4, height: 14, borderRadius: "2px" }} />
        ))}
      </Box>
    </Box>
  );
}

/** Selects a theme, with a button to customize it, or edit it when it is custom. */
export function ThemeCard({
  theme,
  custom,
  selected,
  onSelect,
  onCustomize
}: {
  theme: AppTheme;
  custom: boolean;
  selected: boolean;
  onSelect: () => void;
  onCustomize: () => void;
}) {
  return (
    <Box
      sx={{
        position: "relative",
        "&:hover .theme-card-action, & .theme-card-action:focus-visible": { opacity: 1 },
        "@media (hover: none)": { "& .theme-card-action": { opacity: 1 } }
      }}
    >
      <ButtonBase
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={theme.name}
        data-testid={`theme-card-${theme.id}`}
        sx={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: 1.25,
          py: 0.875,
          pl: 0.875,
          pr: 5,
          textAlign: "left",
          borderRadius: 1.5,
          border: 1,
          borderColor: selected ? "primary.main" : "divider",
          boxShadow: selected ? SELECTED_RING : "none",
          transition: "border-color 120ms, box-shadow 120ms",
          "&:hover": { borderColor: selected ? "primary.main" : "text.secondary" },
          "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 }
        }}
      >
        <ThemeSwatch vars={theme.vars} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: "0.8rem", fontWeight: 550 }}>
            {theme.name}
          </Typography>
          {custom ? (
            <Typography sx={{ fontSize: "0.68rem", lineHeight: 1.3, color: "text.secondary" }}>Custom</Typography>
          ) : null}
        </Box>
        {selected ? <CheckCircleIcon sx={{ fontSize: 16, color: "primary.main" }} /> : null}
      </ButtonBase>
      <Tooltip title={custom ? "Edit" : "Customize"}>
        <IconButton
          className="theme-card-action"
          size="small"
          aria-label={`${custom ? "Edit" : "Customize"} ${theme.name}`}
          onClick={onCustomize}
          data-testid={`theme-card-customize-${theme.id}`}
          sx={{
            position: "absolute",
            top: "50%",
            right: 6,
            transform: "translateY(-50%)",
            opacity: 0,
            transition: "opacity 120ms"
          }}
        >
          {custom ? <EditOutlinedIcon sx={{ fontSize: 16 }} /> : <TuneIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export function CustomThemeRow({
  theme,
  appTheme,
  inUse,
  onEdit,
  onMenu
}: {
  theme: CustomTheme;
  appTheme: AppTheme;
  inUse: boolean;
  onEdit: () => void;
  onMenu: (anchor: HTMLElement) => void;
}) {
  const changes = customizedColorCount(theme);
  const details = [
    theme.mode === "light" ? "Light" : "Dark",
    theme.baseline ? "Imported" : `From ${resolveAppTheme(theme.mode, theme.base).name}`,
    ...(changes > 0 ? [`${changes} ${changes === 1 ? "change" : "changes"}`] : []),
    ...(inUse ? ["In use"] : [])
  ];
  return (
    <Box
      data-testid={`custom-theme-row-${theme.id}`}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 1.5,
        py: 1,
        "&:not(:last-child)": { borderBottom: 1, borderColor: "divider" }
      }}
    >
      <ThemeSwatch vars={appTheme.vars} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: "0.85rem" }}>
          {theme.name}
        </Typography>
        <Typography noWrap sx={{ fontSize: "0.72rem", color: "text.secondary" }}>
          {details.join(" · ")}
        </Typography>
      </Box>
      <Button variant="outlined" size="small" startIcon={<EditOutlinedIcon />} onClick={onEdit}>
        Edit
      </Button>
      <IconButton
        size="small"
        aria-label={`More actions for ${theme.name}`}
        onClick={(event) => onMenu(event.currentTarget)}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
