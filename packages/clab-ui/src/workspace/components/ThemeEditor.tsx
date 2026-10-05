import React, { useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DownloadIcon from "@mui/icons-material/Download";
import RestartAltIcon from "@mui/icons-material/RestartAlt";

import { APP_THEMES } from "../../theme/appThemes";
import {
  ANSI_ROLES,
  THEME_COLOR_TOKENS,
  THEME_ROLE_GROUPS,
  colorIdToken,
  customThemeVars,
  customizedColorCount,
  roleColor,
  themeRoleLabel,
  tokenColorId,
  withRoleColor,
  withTokenColor,
  type CustomTheme,
  type ThemeRole
} from "../../theme/customThemes";
import { ThemeColorInput } from "./ThemeColorInput";
import { ThemePreview } from "./ThemePreview";

export type ThemeExportAction = "download" | "copy";

const LABEL_SX = { fontWeight: 600, fontSize: "calc(0.8rem * var(--settings-font-scale, 1))" } as const;
const HINT_SX = {
  fontSize: "calc(0.72rem * var(--settings-font-scale, 1))",
  color: "text.secondary",
  lineHeight: 1.45
} as const;
const ROW_DIVIDER_SX = { "&:not(:last-child)": { borderBottom: 1, borderColor: "divider" } } as const;

function CustomizedMark() {
  return (
    <Box
      component="span"
      title="Customized"
      sx={{ width: 6, height: 6, flexShrink: 0, borderRadius: "50%", bgcolor: "primary.main" }}
    />
  );
}

function ResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip title="Use the theme's color">
      <IconButton size="small" aria-label={`Reset ${label}`} onClick={onClick}>
        <RestartAltIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

function EditorGroup({
  title,
  description,
  action,
  children
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Box component="section" aria-label={title} sx={{ border: 1, borderColor: "divider", borderRadius: 1.5 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 1,
          ...(children === undefined ? {} : { borderBottom: 1, borderColor: "divider" })
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h3" sx={{ ...LABEL_SX, fontSize: "calc(0.85rem * var(--settings-font-scale, 1))" }}>
            {title}
          </Typography>
          {description === undefined ? null : <Typography sx={HINT_SX}>{description}</Typography>}
        </Box>
        {action}
      </Box>
      {children === undefined ? null : <Box sx={{ px: 1.5, py: 0.5 }}>{children}</Box>}
    </Box>
  );
}

function RoleRow({
  role,
  theme,
  vars,
  onChange
}: {
  role: ThemeRole;
  theme: CustomTheme;
  vars: Record<string, string>;
  onChange: (theme: CustomTheme) => void;
}) {
  const customized = theme.colors[role.key] !== undefined;
  return (
    <Box
      data-role-row={role.key}
      sx={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        columnGap: 1.5,
        py: 1,
        mx: -1,
        px: 1,
        borderRadius: 1,
        ...ROW_DIVIDER_SX
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Typography sx={LABEL_SX}>{role.label}</Typography>
          {customized ? <CustomizedMark /> : null}
        </Box>
        {role.description === undefined ? null : <Typography sx={HINT_SX}>{role.description}</Typography>}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        {customized ? (
          <ResetButton label={role.label} onClick={() => onChange(withRoleColor(theme, role.key, undefined))} />
        ) : null}
        <ThemeColorInput
          label={role.label}
          value={roleColor(vars, role)}
          onChange={(color) => onChange(withRoleColor(theme, role.key, color))}
          testId={`theme-color-${role.key}`}
        />
      </Box>
    </Box>
  );
}

function TerminalColors({
  theme,
  vars,
  onChange
}: {
  theme: CustomTheme;
  vars: Record<string, string>;
  onChange: (theme: CustomTheme) => void;
}) {
  const customized = ANSI_ROLES.filter((role) => theme.colors[role.key] !== undefined);
  return (
    <Box sx={{ py: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={LABEL_SX}>Terminal colors</Typography>
          <Typography sx={HINT_SX}>The 16 ANSI colors. Click a swatch to change it.</Typography>
        </Box>
        {customized.length > 0 ? (
          <Button
            size="small"
            variant="text"
            startIcon={<RestartAltIcon fontSize="small" />}
            onClick={() =>
              onChange(customized.reduce((next, role) => withRoleColor(next, role.key, undefined), theme))
            }
          >
            Reset
          </Button>
        ) : null}
      </Box>
      {(["Normal", "Bright"] as const).map((row, rowIndex) => (
        <Box key={row} sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 1 }}>
          <Typography sx={{ ...HINT_SX, width: 48, flexShrink: 0 }}>{row}</Typography>
          {ANSI_ROLES.slice(rowIndex * 8, rowIndex * 8 + 8).map((role) => {
            const color = roleColor(vars, role);
            const custom = theme.colors[role.key] !== undefined;
            return (
              <Tooltip key={role.key} title={`${role.label} ${color}${custom ? " (customized)" : ""}`}>
                <Box
                  component="label"
                  data-role-row={role.key}
                  sx={{
                    position: "relative",
                    width: 28,
                    height: 28,
                    flexShrink: 0,
                    borderRadius: 1,
                    cursor: "pointer",
                    border: 2,
                    borderColor: custom ? "primary.main" : "divider",
                    "&:focus-within": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 1 }
                  }}
                  style={{ background: color }}
                >
                  <Box
                    component="input"
                    type="color"
                    aria-label={`Terminal ${role.label.toLowerCase()}`}
                    value={color}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      onChange(withRoleColor(theme, role.key, event.target.value))
                    }
                    sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
                  />
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

function TokenOverrides({
  theme,
  vars,
  onChange
}: {
  theme: CustomTheme;
  vars: Record<string, string>;
  onChange: (theme: CustomTheme) => void;
}) {
  const [open, setOpen] = useState(Object.keys(theme.tokens).length > 0);
  const [query, setQuery] = useState("");
  const overrides = Object.keys(theme.tokens).length;
  const needle = query.trim().toLowerCase();
  const rows = THEME_COLOR_TOKENS.map(tokenColorId).filter((id) => id.toLowerCase().includes(needle));
  return (
    <EditorGroup
      title="All tokens"
      description={`Override any single color the app uses${overrides > 0 ? ` (${overrides} overridden)` : ""}. Accepts hex, #rrggbbaa and rgba().`}
      action={
        <Button size="small" variant="text" onClick={() => setOpen(!open)} data-testid="theme-editor-tokens-toggle">
          {open ? "Hide" : `Show ${THEME_COLOR_TOKENS.length}`}
        </Button>
      }
    >
      {open ? (
        <>
          <TextField
            size="small"
            fullWidth
            placeholder="Filter tokens, e.g. button or terminal"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            slotProps={{ htmlInput: { "aria-label": "Filter tokens" } }}
            sx={{ my: 1 }}
          />
          <Box sx={{ maxHeight: 420, overflow: "auto", mx: -1.5, px: 1.5 }}>
            {rows.map((id) => {
              const overridden = Object.hasOwn(theme.tokens, id);
              return (
                <Box
                  key={id}
                  sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.5, ...ROW_DIVIDER_SX }}
                >
                  <Typography
                    title={id}
                    noWrap
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                      fontSize: "0.75rem",
                      fontWeight: overridden ? 600 : 400
                    }}
                  >
                    {id}
                  </Typography>
                  {overridden ? <ResetButton label={id} onClick={() => onChange(withTokenColor(theme, id, undefined))} /> : null}
                  <ThemeColorInput
                    allowAlpha
                    label={id}
                    value={vars[colorIdToken(id)]}
                    onChange={(value) => onChange(withTokenColor(theme, id, value))}
                  />
                </Box>
              );
            })}
            {rows.length === 0 ? <Typography sx={{ ...HINT_SX, py: 1 }}>No token matches.</Typography> : null}
          </Box>
        </>
      ) : null}
    </EditorGroup>
  );
}

export function ThemeEditor({
  theme,
  inUse,
  shownNow,
  onChange,
  onUse,
  onBack,
  onExport,
  onDelete
}: {
  theme: CustomTheme;
  /** Selected for its mode. */
  inUse: boolean;
  /** Selected and the app is in its mode right now. */
  shownNow: boolean;
  onChange: (theme: CustomTheme) => void;
  onUse: () => void;
  onBack: () => void;
  onExport: (action: ThemeExportAction) => void;
  onDelete: () => void;
}) {
  const vars = useMemo(() => customThemeVars(theme), [theme]);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [hoveredRole, setHoveredRole] = useState<string | null>(null);
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const changes = customizedColorCount(theme);
  const bases = APP_THEMES.filter((candidate) => candidate.mode === theme.mode);
  let caption = `Preview only. Use it for ${theme.mode} mode to see it across the app.`;
  if (shownNow) caption = "The app shows your changes as you make them.";
  else if (inUse) caption = `The app uses this theme while it is ${theme.mode}.`;
  const hoveredLabel = hoveredRole === null ? undefined : themeRoleLabel(hoveredRole);

  /** Scrolls to the field for `role`, focuses it and flashes it so the eye finds it. */
  const revealRole = (role: string) => {
    const row = controlsRef.current?.querySelector<HTMLElement>(`[data-role-row="${CSS.escape(role)}"]`);
    if (!row) return;
    const input =
      row.querySelector<HTMLInputElement>('input:not([type="color"])') ?? row.querySelector<HTMLInputElement>("input");
    input?.focus({ preventScroll: true });
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    const highlight =
      getComputedStyle(document.documentElement).getPropertyValue("--vscode-list-inactiveSelectionBackground").trim() ||
      "rgba(128, 128, 128, 0.3)";
    row.animate(
      role.startsWith("ansi.")
        ? [{ boxShadow: `0 0 0 5px ${highlight}` }, { boxShadow: "0 0 0 0 transparent" }]
        : [{ backgroundColor: highlight }, { backgroundColor: "transparent" }],
      { duration: 1600, easing: "ease-out" }
    );
  };

  return (
    <Box sx={{ display: "grid", gap: 2, minWidth: 0 }} data-testid="theme-editor">
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Button variant="text" startIcon={<ArrowBackIcon />} onClick={onBack} data-testid="theme-editor-back">
          All themes
        </Button>
        <Box sx={{ flex: 1 }} />
        {inUse ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "text.secondary", fontSize: "0.8rem" }}>
            <CheckCircleIcon sx={{ fontSize: 16, color: "primary.main" }} />
            In use for {theme.mode} mode
          </Box>
        ) : (
          <Button variant="outlined" onClick={onUse} data-testid="theme-editor-use">
            Use for {theme.mode} mode
          </Button>
        )}
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          endIcon={<ArrowDropDownIcon />}
          onClick={(event) => setExportAnchor(event.currentTarget)}
          data-testid="theme-editor-export"
        >
          Export
        </Button>
        <Menu anchorEl={exportAnchor} open={exportAnchor !== null} onClose={() => setExportAnchor(null)}>
          <MenuItem
            onClick={() => {
              setExportAnchor(null);
              onExport("download");
            }}
          >
            <DownloadIcon fontSize="small" sx={{ mr: 1 }} />
            Download JSON file
          </MenuItem>
          <MenuItem
            onClick={() => {
              setExportAnchor(null);
              onExport("copy");
            }}
          >
            <ContentCopyIcon fontSize="small" sx={{ mr: 1 }} />
            Copy JSON
          </MenuItem>
        </Menu>
        <Tooltip title="Delete theme">
          <IconButton aria-label="Delete theme" onClick={onDelete} data-testid="theme-editor-delete">
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box
        sx={{
          display: "grid",
          gap: 3,
          gridTemplateColumns: "minmax(0, 1fr)",
          "@container settings-content (min-width: 860px)": {
            gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 0.9fr)"
          }
        }}
      >
        <Box ref={controlsRef} sx={{ display: "grid", gap: 2, alignContent: "start", minWidth: 0 }}>
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <TextField
              size="small"
              label="Name"
              value={theme.name}
              onChange={(event) => onChange({ ...theme, name: event.target.value.slice(0, 60) })}
              onBlur={() => {
                if (!theme.name.trim()) onChange({ ...theme, name: "Untitled theme" });
              }}
              slotProps={{ htmlInput: { "data-testid": "theme-editor-name" } }}
            />
            {theme.baseline ? (
              <TextField size="small" label="Starts from" value="Imported colors" disabled />
            ) : (
              <TextField
                select
                size="small"
                label="Starts from"
                value={theme.base}
                onChange={(event) => onChange({ ...theme, base: event.target.value })}
              >
                {bases.map((base) => (
                  <MenuItem key={base.id} value={base.id}>
                    {base.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Box>
          {THEME_ROLE_GROUPS.map((group, index) => (
            <EditorGroup key={group.label} title={group.label}>
              {group.roles.map((role) => (
                <RoleRow key={role.key} role={role} theme={theme} vars={vars} onChange={onChange} />
              ))}
              {index === THEME_ROLE_GROUPS.length - 1 ? (
                <TerminalColors theme={theme} vars={vars} onChange={onChange} />
              ) : null}
            </EditorGroup>
          ))}
          <TokenOverrides theme={theme} vars={vars} onChange={onChange} />
        </Box>

        <Box
          sx={{
            order: -1,
            alignSelf: "start",
            display: "grid",
            gap: 1,
            minWidth: 0,
            "@container settings-content (min-width: 860px)": { order: 0, position: "sticky", top: 0 }
          }}
        >
          <ThemePreview vars={vars} height={360} onPick={revealRole} onHover={setHoveredRole} />
          <Typography sx={HINT_SX} aria-live="polite">
            {hoveredLabel === undefined ? (
              <>
                {caption} Click any part of the preview to edit its color.
              </>
            ) : (
              <>
                <Box component="strong" sx={{ color: "text.primary" }}>
                  {hoveredLabel}
                </Box>
                : click to edit
              </>
            )}
          </Typography>
          {changes > 0 ? (
            <Button
              size="small"
              variant="text"
              startIcon={<RestartAltIcon fontSize="small" />}
              onClick={() => onChange({ ...theme, colors: {}, tokens: {} })}
              sx={{ justifySelf: "start" }}
              data-testid="theme-editor-reset"
            >
              Reset {changes} {changes === 1 ? "change" : "changes"}
            </Button>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}
