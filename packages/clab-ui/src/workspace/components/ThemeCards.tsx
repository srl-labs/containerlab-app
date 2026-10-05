import React from "react";
import { Box, Button, ButtonBase, IconButton, Tooltip, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import TuneIcon from "@mui/icons-material/Tune";

import { resolveAppTheme, type AppTheme } from "../../theme/appThemes";
import { customizedColorCount, type CustomTheme } from "../../theme/customThemes";
import type { VarMap } from "../../theme/devTheme";
import { controlRadius, floatingRadius } from "../../theme/surfaces";

const SELECTED_RING = "0 0 0 1px var(--clab-ui-button-background, var(--vscode-button-background))";
const THUMBNAIL_HEIGHT = 72;

const SIDEBAR_ROWS = [
  { width: "62%", selected: true },
  { width: "48%", selected: false },
  { width: "56%", selected: false }
] as const;

const THUMBNAIL_NODES = [
  { left: "24%", top: "40%", status: "testing-iconPassed" },
  { left: "64%", top: "66%", status: "editorError-foreground" }
] as const;

/**
 * A miniature workspace painted from a theme's own colors: sidebar with a selected row,
 * canvas with two nodes and a link, the toolbar and an accent button.
 */
function ThemeThumbnail({ vars }: { vars: VarMap }) {
  const color = (token: string) => vars[`--vscode-${token}`];
  const border = `1px solid ${color("panel-border")}`;
  return (
    <Box
      aria-hidden
      style={{ background: color("editor-background") }}
      sx={{ position: "relative", display: "flex", width: "100%", height: "100%", overflow: "hidden" }}
    >
      <Box
        style={{ background: color("sideBar-background"), borderRight: border }}
        sx={{ width: "28%", flexShrink: 0, display: "flex", flexDirection: "column", gap: "5px", px: "5px", pt: "8px" }}
      >
        <Box style={{ background: color("descriptionForeground") }} sx={{ width: "40%", height: 3, borderRadius: 1, opacity: 0.7 }} />
        {SIDEBAR_ROWS.map((row) => (
          <Box
            key={row.width}
            style={{ background: row.selected ? color("list-inactiveSelectionBackground") : "transparent" }}
            sx={{ display: "flex", alignItems: "center", height: 9, mx: "-3px", px: "3px", borderRadius: "2px" }}
          >
            <Box
              style={{ background: color(row.selected ? "list-inactiveSelectionForeground" : "foreground") }}
              sx={{ width: row.width, height: 3, borderRadius: 1, opacity: row.selected ? 0.9 : 0.45 }}
            />
          </Box>
        ))}
      </Box>
      <Box sx={{ position: "relative", flex: 1 }}>
        <Box
          style={{ background: color("editor-background"), border }}
          sx={{ position: "absolute", top: 6, left: 6, display: "flex", gap: "3px", p: "3px", borderRadius: "3px" }}
        >
          {[0, 1, 2].map((index) => (
            <Box key={index} style={{ background: color("icon-foreground") }} sx={{ width: 4, height: 4, borderRadius: "1px", opacity: 0.6 }} />
          ))}
        </Box>
        <Box
          component="svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        >
          <line
            x1={24}
            y1={40}
            x2={64}
            y2={66}
            stroke={color("descriptionForeground")}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </Box>
        {THUMBNAIL_NODES.map((node) => (
          <Box
            key={node.left}
            style={{ left: node.left, top: node.top, background: color("button-secondaryBackground"), border }}
            sx={{ position: "absolute", width: 14, height: 14, borderRadius: "3px", transform: "translate(-50%, -50%)" }}
          >
            <Box
              style={{ background: color(node.status) }}
              sx={{ position: "absolute", top: -2, right: -2, width: 5, height: 5, borderRadius: "50%" }}
            />
          </Box>
        ))}
        <Box
          style={{ background: color("button-background") }}
          sx={{ position: "absolute", right: 6, bottom: 6, width: 22, height: 8, borderRadius: "2px" }}
        />
      </Box>
    </Box>
  );
}

/** The card thumbnail at half size, for list rows. */
function ThemeThumbnailSmall({ vars }: { vars: VarMap }) {
  return (
    <Box
      sx={{
        width: 56,
        height: 36,
        flexShrink: 0,
        overflow: "hidden",
        borderRadius: "4px",
        border: 1,
        borderColor: "divider"
      }}
    >
      <Box sx={{ width: 112, height: 72, transform: "scale(0.5)", transformOrigin: "top left" }}>
        <ThemeThumbnail vars={vars} />
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
        minWidth: 0,
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
          display: "block",
          textAlign: "left",
          overflow: "hidden",
          borderRadius: floatingRadius,
          border: 1,
          borderColor: selected ? "primary.main" : "divider",
          boxShadow: selected ? SELECTED_RING : "none",
          transition: "border-color 120ms ease, box-shadow 120ms ease",
          "&:hover": {
            borderColor: selected ? "primary.main" : "color-mix(in srgb, var(--vscode-foreground) 30%, transparent)"
          },
          "@media (prefers-reduced-motion: reduce)": { transition: "none" }
        }}
      >
        <Box sx={{ height: THUMBNAIL_HEIGHT, borderBottom: 1, borderColor: "divider" }}>
          <ThemeThumbnail vars={theme.vars} />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minHeight: 36, px: 1.25, py: 0.75 }}>
          <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 500 }}>
            {theme.name}
          </Typography>
          {custom ? (
            <Typography variant="caption" sx={{ color: "text.secondary", flexShrink: 0 }}>
              Custom
            </Typography>
          ) : null}
          {selected ? <CheckCircleIcon sx={{ fontSize: 16, flexShrink: 0, color: "primary.main" }} /> : null}
        </Box>
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
            top: 6,
            right: 6,
            width: 26,
            height: 26,
            opacity: 0,
            bgcolor: "background.paper",
            border: 1,
            borderColor: "divider",
            borderRadius: controlRadius,
            transition: "opacity 120ms ease",
            "&:hover": { bgcolor: "background.paper", borderColor: "text.secondary" },
            "@media (prefers-reduced-motion: reduce)": { transition: "none" }
          }}
        >
          {custom ? <EditOutlinedIcon sx={{ fontSize: 15 }} /> : <TuneIcon sx={{ fontSize: 15 }} />}
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
        py: 1.25,
        "&:not(:last-child)": { borderBottom: 1, borderColor: "divider" }
      }}
    >
      <ThemeThumbnailSmall vars={appTheme.vars} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" noWrap sx={{ fontWeight: 500 }}>
          {theme.name}
        </Typography>
        <Typography variant="body2" noWrap sx={{ color: "text.secondary" }}>
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
        <MoreVertIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </Box>
  );
}
