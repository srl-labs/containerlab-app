import React, { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  ListItemIcon,
  Menu,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DownloadIcon from "@mui/icons-material/Download";
import FileCopyOutlinedIcon from "@mui/icons-material/FileCopyOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import SettingsBrightnessOutlinedIcon from "@mui/icons-material/SettingsBrightnessOutlined";
import UploadIcon from "@mui/icons-material/Upload";

import { DialogTitleWithClose } from "../../components/ui/dialog/DialogChrome";
import { SettingsField } from "../../settings/SettingsField";
import { APP_THEMES, resolveAppTheme, type AppTheme, type AppThemeMode } from "../../theme/appThemes";
import {
  createCustomTheme,
  customAppTheme,
  exportCustomThemes,
  themeExportFileName,
  type CustomTheme
} from "../../theme/customThemes";
import { downloadJsonFile } from "../../utils/jsonFile";
import {
  appearanceTheme,
  type StandaloneAppearance,
  type StandaloneThemeMode
} from "../state/themePreferences";
import { CustomThemeRow, ThemeCard } from "./ThemeCards";
import { ThemeEditor, type ThemeExportAction } from "./ThemeEditor";
import { ThemeImportDialog } from "./ThemeImportDialog";


const TOGGLE_GROUP_SX = {
  "& .MuiToggleButton-root": {
    gap: 0.75,
    px: 1.5,
    textTransform: "none",
    color: "text.primary",
    borderColor: "divider"
  },
  "& .MuiToggleButton-root.Mui-selected": {
    bgcolor: "action.selected",
    color: "text.primary",
    borderColor: "text.primary"
  },
  "& .MuiToggleButton-root.Mui-selected:hover": {
    bgcolor: "action.hover"
  }
} as const;

type Notice = { severity: "success" | "error"; text: string };

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <Box>
      <Typography
        component="h3"
        sx={{ fontWeight: 650, fontSize: "calc(0.9rem * var(--settings-font-scale, 1))" }}
      >
        {title}
      </Typography>
      <Typography
        sx={{ mt: 0.25, fontSize: "calc(0.75rem * var(--settings-font-scale, 1))", color: "text.secondary" }}
      >
        {description}
      </Typography>
    </Box>
  );
}

export function AppearanceSettingsContent({
  appearance,
  currentTheme,
  onAppearanceChange
}: {
  appearance: StandaloneAppearance;
  /** Whether the app is light or dark right now, with System resolved. */
  currentTheme: AppThemeMode;
  onAppearanceChange: (next: StandaloneAppearance) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; theme: CustomTheme } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CustomTheme | null>(null);

  const { customThemes } = appearance;
  const customAppThemes = useMemo(() => customThemes.map(customAppTheme), [customThemes]);
  const selectedId = (mode: AppThemeMode) => (mode === "light" ? appearance.lightTheme : appearance.darkTheme);
  const isInUse = (theme: { id: string; mode: AppThemeMode }) => selectedId(theme.mode) === theme.id;

  const update = (patch: Partial<StandaloneAppearance>) => onAppearanceChange({ ...appearance, ...patch });
  const selection = (theme: { id: string; mode: AppThemeMode }) =>
    theme.mode === "light" ? { lightTheme: theme.id } : { darkTheme: theme.id };

  const addThemes = (themes: CustomTheme[]) => {
    const next: StandaloneAppearance = { ...appearance, customThemes: [...customThemes, ...themes] };
    for (const mode of ["light", "dark"] as const) {
      const first = themes.find((theme) => theme.mode === mode);
      if (first) Object.assign(next, selection(first));
    }
    onAppearanceChange(next);
  };

  const customize = (theme: AppTheme) => {
    if (customThemes.some((custom) => custom.id === theme.id)) {
      setEditingId(theme.id);
      return;
    }
    const created = createCustomTheme(theme, customThemes);
    addThemes([created]);
    setEditingId(created.id);
  };

  const saveTheme = (next: CustomTheme) =>
    update({ customThemes: customThemes.map((theme) => (theme.id === next.id ? next : theme)) });

  const deleteTheme = (theme: CustomTheme) => {
    update({
      customThemes: customThemes.filter((custom) => custom.id !== theme.id),
      ...(isInUse(theme) ? selection({ id: theme.base, mode: theme.mode }) : {})
    });
    if (editingId === theme.id) setEditingId(null);
    setNotice({ severity: "success", text: `Deleted ${theme.name}.` });
  };

  const exportThemes = (themes: readonly CustomTheme[], action: ThemeExportAction) => {
    const content = exportCustomThemes(themes);
    const what = themes.length === 1 ? themes[0].name : `${themes.length} themes`;
    if (action === "download") {
      downloadJsonFile(themeExportFileName(themes), content);
      setNotice({ severity: "success", text: `Exported ${what}.` });
      return;
    }
    navigator.clipboard.writeText(content).then(
      () => setNotice({ severity: "success", text: `Copied ${what} as JSON.` }),
      () => setNotice({ severity: "error", text: "The clipboard is not available here. Download the file instead." })
    );
  };

  const deleteDialog = (
    <Dialog
      open={pendingDelete !== null}
      onClose={() => setPendingDelete(null)}
      maxWidth="xs"
      fullWidth
      sx={{ "& .MuiButton-root": { textTransform: "none" } }}
    >
      <DialogTitleWithClose title={`Delete ${pendingDelete?.name ?? "theme"}?`} onClose={() => setPendingDelete(null)} />
      <DialogContent>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {pendingDelete && isInUse(pendingDelete)
            ? `The app switches back to ${resolveAppTheme(pendingDelete.mode, pendingDelete.base).name}. `
            : ""}
          Export the theme first if you want to keep a copy.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={() => setPendingDelete(null)}>
          Cancel
        </Button>
        <Button
          color="error"
          data-testid="theme-delete-confirm"
          onClick={() => {
            if (pendingDelete) deleteTheme(pendingDelete);
            setPendingDelete(null);
          }}
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );

  const editing = customThemes.find((theme) => theme.id === editingId);
  if (editing) {
    return (
      <>
        <ThemeEditor
          theme={editing}
          inUse={isInUse(editing)}
          shownNow={isInUse(editing) && editing.mode === currentTheme}
          onChange={saveTheme}
          onUse={() => update(selection(editing))}
          onBack={() => setEditingId(null)}
          onExport={(action) => exportThemes([editing], action)}
          onDelete={() => setPendingDelete(editing)}
        />
        {deleteDialog}
      </>
    );
  }

  const gallery = (mode: AppThemeMode) => (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 1 }}>
      {[...APP_THEMES, ...customAppThemes]
        .filter((theme) => theme.mode === mode)
        .map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            custom={customThemes.some((custom) => custom.id === theme.id)}
            selected={selectedId(mode) === theme.id}
            onSelect={() => update(selection(theme))}
            onCustomize={() => customize(theme)}
          />
        ))}
    </Box>
  );

  return (
    <>
      <SettingsField
        title="Color mode"
        description="System follows your operating system's light or dark setting."
        compactControl
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          aria-label="Color mode"
          value={appearance.mode}
          onChange={(_event, mode: StandaloneThemeMode | null) => {
            if (mode) update({ mode });
          }}
          sx={TOGGLE_GROUP_SX}
        >
          <ToggleButton value="light" data-testid="standalone-settings-theme-light">
            <LightModeOutlinedIcon fontSize="small" />
            Light
          </ToggleButton>
          <ToggleButton value="system" data-testid="standalone-settings-theme-system">
            <SettingsBrightnessOutlinedIcon fontSize="small" />
            System
          </ToggleButton>
          <ToggleButton value="dark" data-testid="standalone-settings-theme-dark">
            <DarkModeOutlinedIcon fontSize="small" />
            Dark
          </ToggleButton>
        </ToggleButtonGroup>
      </SettingsField>

      <Box component="section" aria-label="Light theme" sx={{ display: "grid", gap: 1.25 }}>
        <SectionHeading
          title="Light theme"
          description="Used while the app is light. Customize any theme to make it your own."
        />
        {gallery("light")}
      </Box>

      <Box component="section" aria-label="Dark theme" sx={{ display: "grid", gap: 1.25 }}>
        <SectionHeading title="Dark theme" description="Used while the app is dark." />
        {gallery("dark")}
      </Box>

      <Box component="section" aria-label="Custom themes" sx={{ display: "grid", gap: 1.25 }}>
        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1, flexWrap: "wrap" }}>
          <Box sx={{ flex: 1, minWidth: 240 }}>
            <SectionHeading
              title="Custom themes"
              description="Edit every color, then share themes as JSON. VS Code color themes import too."
            />
          </Box>
          <Button
            variant="outlined"
            startIcon={<UploadIcon />}
            onClick={() => setImportOpen(true)}
            data-testid="theme-import"
          >
            Import
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            disabled={customThemes.length === 0}
            onClick={() => exportThemes(customThemes, "download")}
          >
            Export all
          </Button>
          <Button
            startIcon={<AddIcon />}
            onClick={() => customize(appearanceTheme(appearance, currentTheme))}
            data-testid="theme-new"
          >
            New theme
          </Button>
        </Box>
        {notice ? (
          <Alert severity={notice.severity} onClose={() => setNotice(null)}>
            {notice.text}
          </Alert>
        ) : null}
        {customThemes.length === 0 ? (
          <Box
            sx={{
              p: 2.5,
              textAlign: "center",
              border: 1,
              borderStyle: "dashed",
              borderColor: "divider",
              borderRadius: 1.5,
              color: "text.secondary",
              fontSize: "0.8rem"
            }}
          >
            No custom themes yet. New theme starts from the one you are using.
          </Box>
        ) : (
          <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5 }}>
            {customThemes.map((theme, index) => (
              <CustomThemeRow
                key={theme.id}
                theme={theme}
                appTheme={customAppThemes[index]}
                inUse={isInUse(theme)}
                onEdit={() => setEditingId(theme.id)}
                onMenu={(anchor) => setMenu({ anchor, theme })}
              />
            ))}
          </Box>
        )}
      </Box>

      <Menu anchorEl={menu?.anchor} open={menu !== null} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            if (menu) {
              const copy = createCustomTheme(customAppTheme(menu.theme), customThemes);
              update({ customThemes: [...customThemes, copy] });
            }
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <FileCopyOutlinedIcon fontSize="small" />
          </ListItemIcon>
          Duplicate
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu) exportThemes([menu.theme], "download");
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          Download JSON file
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu) exportThemes([menu.theme], "copy");
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          Copy JSON
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setPendingDelete(menu?.theme ?? null);
            setMenu(null);
          }}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          Delete
        </MenuItem>
      </Menu>

      <ThemeImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={(themes) => {
          addThemes(themes);
          setNotice({
            severity: "success",
            text: `Imported ${themes.length === 1 ? themes[0].name : `${themes.length} themes`}.`
          });
        }}
      />
      {deleteDialog}
    </>
  );
}
