import React, { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { SettingsLayout } from "./SettingsLayout";
import { filterSettings, type SettingsFilter } from "./settingsFilter";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import { type SettingsNavigationItem } from "./SettingsNavigation";
import { SettingCard } from "./SettingCard";
import type {
  SettingsChange,
  SettingsSnapshot,
  SettingsTarget,
} from "./schema";

const CATEGORIES: SettingsNavigationItem[] = [
  {
    key: "general",
    label: "General & Runtime",
    description: "Your Containerlab environment",
    icon: <SettingsOutlinedIcon fontSize="small" />,
  },
  {
    key: "appearance",
    label: "Appearance",
    description: "Make yourself at home",
    icon: <PaletteOutlinedIcon fontSize="small" />,
  },
  {
    key: "labs",
    label: "Lab Actions",
    description: "Deploy, destroy, and cleanup",
    icon: <ScienceOutlinedIcon fontSize="small" />,
  },
  {
    key: "topology",
    label: "Topology",
    description: "Canvas and node templates",
    icon: <AccountTreeOutlinedIcon fontSize="small" />,
  },
  {
    key: "terminal",
    label: "Terminal",
    description: "Shells, SSH, and node actions",
    icon: <TerminalIcon fontSize="small" />,
  },
  {
    key: "capture",
    label: "Packet Capture",
    description: "Wireshark and Edgeshark",
    icon: <HubOutlinedIcon fontSize="small" />,
  },
  {
    key: "about",
    label: "About",
    description: "Versions and settings details",
    icon: <InfoOutlinedIcon fontSize="small" />,
  },
];
export function SettingsApp({
  initial,
  request,
  subscribe,
}: {
  initial: SettingsSnapshot;
  request: (payload: Record<string, unknown>) => Promise<SettingsSnapshot>;
  subscribe: (listener: (snapshot: SettingsSnapshot) => void) => () => void;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [category, setCategory] = useState("general");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SettingsFilter>("all");
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set());
  const [pendingTarget, setPendingTarget] = useState<SettingsTarget>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(
    () =>
      subscribe((next) =>
        setSnapshot((current) =>
          next.target === current.target ? next : current,
        ),
      ),
    [subscribe],
  );
  const onDirty = useCallback(
    (key: string, dirty: boolean) =>
      setDirtyKeys((current) => {
        if (current.has(key) === dirty) return current;
        const next = new Set(current);
        if (dirty) next.add(key);
        else next.delete(key);
        return next;
      }),
    [],
  );
  const onSave = async (change: SettingsChange) => {
    const next = await request({ action: "change", change });
    setSnapshot(next);
  };
  const refresh = async () => {
    setSnapshot(await request({ action: "read", target: snapshot.target }));
  };
  const action = async (name: string) => {
    try {
      await request({ action: name });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const changeTarget = async (target: SettingsTarget) => {
    setBusy(true);
    setError("");
    try {
      setSnapshot(await request({ action: "read", target }));
      setDirtyKeys(new Set());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      setPendingTarget(undefined);
    }
  };
  const query = search.trim().toLowerCase();
  const definitions = snapshot.definitions;
  const { visible, currentModified, allModified } = filterSettings(
    definitions,
    snapshot.values,
    category,
    search,
    filter,
  );
  const active =
    CATEGORIES.find((item) => item.key === category) ?? CATEGORIES[0];
  const showAllCategories =
    filter === "modified-all" || (query.length > 0 && filter === "all");
  let title = active.label;
  let description = active.description;
  if (query.length > 0) {
    title = "Search results";
    description = `${visible.length} settings match “${search.trim()}”`;
  }
  if (filter === "modified-all") {
    title = "All modified settings";
    description = `${visible.length} overrides across all categories · ${snapshot.target === "user" ? "User" : "Workspace"}`;
  }
  const categories = CATEGORIES.map((item) => ({
    ...item,
    count:
      item.key === "about"
        ? undefined
        : definitions.filter((definition) => definition.category === item.key)
            .length,
  }));
  return (
    <>
      <SettingsLayout
        items={categories}
        active={category}
        onSelect={(key) => {
          setCategory(key);
          setSearch("");
          if (filter === "modified-all") setFilter("modified-view");
        }}
        sectionTitle={title}
        sectionDescription={description}
        headerActions={
          <Button
            variant="text"
            size="small"
            endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
            onClick={() => {
              void action("native");
            }}
            sx={{
              color: "text.secondary",
              fontSize: "calc(0.72rem * var(--settings-font-scale, 1))",
            }}
          >
            VS Code Settings
          </Button>
        }
        toolbar={
          <Stack spacing={1}>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                fullWidth
                placeholder="Search all settings…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                slotProps={{
                  htmlInput: { "aria-label": "Search settings" },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon sx={{ fontSize: 18 }} />
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <TextField
                select
                size="small"
                value={snapshot.target}
                disabled={busy}
                slotProps={{
                  select: { inputProps: { "aria-label": "Save settings to" } },
                }}
                onChange={(event) => {
                  const target = event.target.value as SettingsTarget;
                  if (dirtyKeys.size) setPendingTarget(target);
                  else void changeTarget(target);
                }}
                sx={{ minWidth: 128 }}
              >
                <MenuItem value="user">User</MenuItem>
                <MenuItem
                  value="workspace"
                  disabled={!snapshot.workspaceAvailable}
                >
                  Workspace
                </MenuItem>
              </TextField>
            </Stack>
            <ToggleButtonGroup
              value={filter}
              exclusive
              size="small"
              aria-label="Filter settings"
              onChange={(_, next: SettingsFilter | null) => {
                if (next !== null) setFilter(next);
              }}
              sx={{
                alignSelf: "flex-start",
                maxWidth: "100%",
                "& .MuiToggleButton-root": {
                  px: 1.25,
                  py: 0.4,
                  gap: 0.75,
                  fontSize: "calc(0.7rem * var(--settings-font-scale, 1))",
                  textTransform: "none",
                  color: "text.secondary",
                  borderColor: "divider",
                  lineHeight: 1.5,
                },
                "& .MuiToggleButton-root.Mui-selected": {
                  color: "text.primary",
                  bgcolor: "action.selected",
                },
              }}
            >
              <ToggleButton value="all">All in view</ToggleButton>
              <ToggleButton
                value="modified-view"
                aria-label={`Modified in this view: ${currentModified}`}
              >
                Modified in view{" "}
                <Box
                  component="span"
                  sx={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {currentModified}
                </Box>
              </ToggleButton>
              <ToggleButton
                value="modified-all"
                aria-label={`Modified across all settings: ${allModified}`}
              >
                All modified{" "}
                <Box
                  component="span"
                  sx={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {allModified}
                </Box>
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        }
        sectionActions={
          category === "appearance" && !showAllCategories ? (
            <Button
              size="small"
              variant="text"
              onClick={() => {
                void action("colorTheme");
              }}
            >
              VS Code theme
            </Button>
          ) : undefined
        }
        navigationFooter={
          <Typography
            variant="caption"
            sx={{
              fontSize: "calc(0.65rem * var(--settings-font-scale, 1))",
              color: "text.secondary",
              display: "block",
              overflowWrap: "anywhere",
            }}
          >
            {snapshot.workspaceName ?? "Containerlab"}
            <br />
            {snapshot.remoteName
              ? `Remote · ${snapshot.remoteName}`
              : "Local session"}{" "}
            · v{snapshot.version}
          </Typography>
        }
        footer={
          <>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <CheckCircleOutlineIcon
                sx={{
                  fontSize: 13,
                  color: dirtyKeys.size ? "text.secondary" : "success.main",
                }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                role="status"
              >
                {dirtyKeys.size
                  ? `${dirtyKeys.size} unsaved ${dirtyKeys.size === 1 ? "setting" : "settings"}`
                  : "All changes saved"}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {definitions.length} settings ·{" "}
              {snapshot.target === "user" ? "User" : "Workspace"}
            </Typography>
          </>
        }
      >
        {error && (
          <Alert severity="error" onClose={() => setError("")} sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}
        {snapshot.reloadRequired && (
          <Alert
            severity="info"
            sx={{ mb: 1 }}
            action={
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  void action("reload");
                }}
              >
                Reload window
              </Button>
            }
          >
            Runtime settings changed. Reload VS Code to apply them.
          </Alert>
        )}
        <Box key={snapshot.target}>
          {CATEGORIES.filter((item) => item.key !== "about").map((item) => {
            const categoryDefinitions = definitions.filter(
              (definition) => definition.category === item.key,
            );
            const hasVisible = categoryDefinitions.some((definition) =>
              visible.includes(definition),
            );
            return (
              <Box
                key={item.key}
                hidden={!hasVisible}
                sx={{ mb: showAllCategories ? 2 : 0 }}
              >
                {showAllCategories && (
                  <Typography
                    component="h3"
                    sx={{
                      px: 0.5,
                      mb: 0.75,
                      fontSize: "calc(0.75rem * var(--settings-font-scale, 1))",
                      fontWeight: 600,
                      color: "text.secondary",
                    }}
                  >
                    {item.label}
                  </Typography>
                )}
                <Box
                  sx={{
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1.5,
                    overflow: "hidden",
                    "& > div:last-child > section": { borderBottom: 0 },
                  }}
                >
                  {categoryDefinitions.map((definition) => (
                    <Box
                      key={definition.key}
                      hidden={!visible.includes(definition)}
                    >
                      <SettingCard
                        definition={definition}
                        current={snapshot.values[definition.key]}
                        target={snapshot.target}
                        onSave={onSave}
                        onDirty={onDirty}
                        onRefresh={refresh}
                      />
                    </Box>
                  ))}
                </Box>
              </Box>
            );
          })}
        </Box>
        {!visible.length &&
          (query || category !== "about" || filter !== "all") && (
            <Box sx={{ textAlign: "center", py: 4 }}>
              <Typography variant="subtitle2">No matching settings</Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                Try another search or change the Modified filter.
              </Typography>
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                Clear filters
              </Button>
            </Box>
          )}
        {!query && category === "about" && filter === "all" && (
          <Box
            sx={{ p: 2, border: 1, borderColor: "divider", borderRadius: 1.5 }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Containerlab for VS Code
            </Typography>
            <Stack direction="row" spacing={1} sx={{ my: 1.5 }}>
              <Chip size="small" label={`Extension ${snapshot.version}`} />
              <Chip size="small" label={`VS Code ${snapshot.vscodeVersion}`} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              All {definitions.length} Containerlab settings stay in sync with
              VS Code. User settings apply to this session; Workspace settings
              apply to the open workspace. Reset removes an override so the
              setting inherits again.
            </Typography>
          </Box>
        )}
      </SettingsLayout>
      <Dialog
        open={Boolean(pendingTarget)}
        onClose={() => setPendingTarget(undefined)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Discard unsaved changes?</DialogTitle>
        <DialogContent>
          Your drafts belong to the current settings scope. Save them first or
          discard them to switch.
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setPendingTarget(undefined)}>
            Keep editing
          </Button>
          <Button
            onClick={() => {
              if (pendingTarget) void changeTarget(pendingTarget);
            }}
            disabled={busy}
          >
            Discard and switch
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
