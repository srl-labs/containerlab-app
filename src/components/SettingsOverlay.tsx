import React, { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import type { Theme } from "@mui/material/styles";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  Close as CloseIcon,
  DarkMode as DarkModeIcon,
  InfoOutlined as InfoOutlinedIcon,
  LightMode as LightModeIcon,
  Logout as LogoutIcon,
  Settings as SettingsIcon,
  Terminal as TerminalIcon
} from "@mui/icons-material";

import { fetchVersionCheck, fetchVersionInfo } from "../runtimeApi";
import type { TerminalPreferences } from "../runtimeTerminalSettings";

type SettingsSectionKey = "general" | "terminal" | "about";

interface SettingsOverlayProps {
  currentTheme: "light" | "dark";
  onThemeChange: (nextTheme: "light" | "dark") => void;
  onLogout: () => void;
  onSaveTerminalPreferences: (next: TerminalPreferences) => void;
  apiUrl: string;
  connected: boolean;
  terminalPreferences: TerminalPreferences;
}

type TerminalDraftResult =
  | {
      error: null;
      field: null;
      preferences: TerminalPreferences;
    }
  | {
      error: string;
      field: "ssh" | "telnet";
    };

const SETTINGS_SECTIONS: Array<{
  key: SettingsSectionKey;
  label: string;
  description: string;
  icon: React.ReactElement;
}> = [
  {
    key: "general",
    label: "General",
    description: "Theme and workspace behavior",
    icon: <SettingsIcon fontSize="small" />
  },
  {
    key: "terminal",
    label: "Terminal",
    description: "SSH mapping and telnet defaults",
    icon: <TerminalIcon fontSize="small" />
  },
  {
    key: "about",
    label: "About",
    description: "Version and diagnostics entrypoints",
    icon: <InfoOutlinedIcon fontSize="small" />
  }
];

function accentSx(theme: Theme, color: "info" | "success" | "warning" | "error") {
  return {
    borderColor: `${color}.main`,
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(255,255,255,0.03)"
        : "rgba(0,0,0,0.015)",
    boxShadow: "none"
  };
}

function SectionCard(props: {
  title: string;
  description: string;
  tone?: "info" | "success" | "warning" | "error";
  children: React.ReactNode;
}) {
  const { title, description, tone = "info", children } = props;

  return (
    <Paper
      variant="outlined"
      sx={(theme) => ({
        p: 3,
        ...accentSx(theme, tone)
      })}
    >
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        </Box>
        {children}
      </Stack>
    </Paper>
  );
}

function StatusPill(props: { connected: boolean }) {
  const { connected } = props;
  const color = connected ? "success.main" : "warning.main";

  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        px: 1.25,
        py: 0.5,
        borderRadius: 999,
        border: 1,
        borderColor: color,
        bgcolor: "background.paper",
        color
      }}
    >
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          bgcolor: color,
          flexShrink: 0
        }}
      />
      <Typography variant="caption" fontWeight={700} sx={{ color: "inherit" }}>
        {connected ? "Connected" : "Disconnected"}
      </Typography>
    </Box>
  );
}

function parseTerminalPreferencesDraft(
  sshUserMappingText: string,
  telnetPortText: string
): TerminalDraftResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sshUserMappingText);
  } catch {
    return {
      error: "SSH user mapping must be valid JSON.",
      field: "ssh"
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      error: "SSH user mapping must be a JSON object.",
      field: "ssh"
    };
  }

  const normalizedMapping: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const normalizedKey = key.trim();
    const normalizedValue = typeof value === "string" ? value.trim() : "";
    if (!normalizedKey || !normalizedValue) {
      return {
        error: "SSH user mapping keys and values must be non-empty strings.",
        field: "ssh"
      };
    }
    normalizedMapping[normalizedKey] = normalizedValue;
  }

  const telnetPort = Number(telnetPortText.trim());
  if (!Number.isInteger(telnetPort) || telnetPort <= 0 || telnetPort > 65535) {
    return {
      error: "Telnet port must be an integer between 1 and 65535.",
      field: "telnet"
    };
  }

  return {
    error: null,
    field: null,
    preferences: {
      sshUserMapping: normalizedMapping,
      telnetPort
    }
  };
}

export function SettingsOverlay({
  currentTheme,
  onThemeChange,
  onLogout,
  onSaveTerminalPreferences,
  apiUrl,
  connected,
  terminalPreferences
}: SettingsOverlayProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>("general");
  const [sshUserMappingText, setSshUserMappingText] = useState("");
  const [telnetPortText, setTelnetPortText] = useState("");
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionInfo, setVersionInfo] = useState("");
  const [versionCheck, setVersionCheck] = useState("");

  useEffect(() => {
    setSshUserMappingText(JSON.stringify(terminalPreferences.sshUserMapping, null, 2));
    setTelnetPortText(String(terminalPreferences.telnetPort));
  }, [terminalPreferences]);

  useEffect(() => {
    if (dialogOpen) {
      setActiveSection("general");
    }
  }, [dialogOpen]);

  useEffect(() => {
    if (!dialogOpen || activeSection !== "about") {
      return;
    }

    let cancelled = false;
    setVersionLoading(true);
    setVersionError(null);

    const load = async () => {
      try {
        const [version, check] = await Promise.all([fetchVersionInfo(), fetchVersionCheck()]);
        if (cancelled) {
          return;
        }
        setVersionInfo(version.versionInfo);
        setVersionCheck(check.checkResult);
      } catch (error) {
        if (!cancelled) {
          setVersionError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setVersionLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeSection, dialogOpen]);

  const terminalDraft = useMemo(
    () => parseTerminalPreferencesDraft(sshUserMappingText, telnetPortText),
    [sshUserMappingText, telnetPortText]
  );

  const handleTogglePanel = useCallback(() => setPanelOpen((prev) => !prev), []);
  const handleClosePanel = useCallback(() => setPanelOpen(false), []);
  const handleOpenDialog = useCallback(() => {
    setPanelOpen(false);
    setDialogOpen(true);
  }, []);
  const handleCloseDialog = useCallback(() => setDialogOpen(false), []);

  const handleLogoutClick = useCallback(() => {
    setPanelOpen(false);
    setDialogOpen(false);
    onLogout();
  }, [onLogout]);

  const handleSaveTerminalSettings = useCallback(() => {
    if (terminalDraft.error || !("preferences" in terminalDraft)) {
      return;
    }
    onSaveTerminalPreferences(terminalDraft.preferences);
  }, [onSaveTerminalPreferences, terminalDraft]);

  const renderSectionContent = () => {
    switch (activeSection) {
      case "general":
        return (
          <Stack spacing={3}>
            <Box>
              <Typography variant="h6">General</Typography>
              <Typography variant="body2" color="text.secondary">
                Standalone preferences live here so lab editing settings can stay in their own
                dedicated flow.
              </Typography>
            </Box>
            <SectionCard
              title="Color Theme"
              description="Theme changes apply immediately and persist in local browser storage."
            >
                <ToggleButtonGroup
                  exclusive
                  value={currentTheme}
                  onChange={(_event, nextTheme: "light" | "dark" | null) => {
                    if (nextTheme) {
                      onThemeChange(nextTheme);
                    }
                  }}
                  sx={{
                    alignSelf: "flex-start",
                    "& .MuiToggleButton-root": {
                      px: 1.75,
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
                  }}
                >
                  <ToggleButton value="dark" data-testid="standalone-settings-theme-dark">
                    <Stack direction="row" spacing={1} alignItems="center">
                      <DarkModeIcon fontSize="small" />
                      <span>Dark</span>
                    </Stack>
                  </ToggleButton>
                  <ToggleButton value="light" data-testid="standalone-settings-theme-light">
                    <Stack direction="row" spacing={1} alignItems="center">
                      <LightModeIcon fontSize="small" />
                      <span>Light</span>
                    </Stack>
                  </ToggleButton>
                </ToggleButtonGroup>
            </SectionCard>
          </Stack>
        );
      case "terminal":
        return (
          <Stack spacing={3}>
            <Box>
              <Typography variant="h6">Terminal</Typography>
              <Typography variant="body2" color="text.secondary">
                Configure standalone defaults for SSH username resolution and telnet access.
              </Typography>
            </Box>
            <SectionCard
              title="Terminal Defaults"
              description="Configure standalone defaults for SSH username resolution and telnet access."
              tone="info"
            >
                <TextField
                  label="SSH User Mapping JSON"
                  value={sshUserMappingText}
                  onChange={(event) => setSshUserMappingText(event.target.value)}
                  fullWidth
                  multiline
                  minRows={12}
                  error={terminalDraft.field === "ssh"}
                  helperText={
                    terminalDraft.field === "ssh"
                      ? terminalDraft.error
                      : "JSON object mapping container kinds to default SSH usernames."
                  }
                  data-testid="standalone-settings-ssh-mapping"
                  sx={{
                    "& textarea": {
                      fontFamily: "monospace",
                      fontSize: "0.85rem"
                    }
                  }}
                />
                <TextField
                  label="Telnet Port"
                  value={telnetPortText}
                  onChange={(event) => setTelnetPortText(event.target.value)}
                  fullWidth
                  error={terminalDraft.field === "telnet"}
                  helperText={
                    terminalDraft.field === "telnet"
                      ? terminalDraft.error
                      : "Default telnet port used by standalone terminal actions."
                  }
                  slotProps={{ htmlInput: { inputMode: "numeric", pattern: "[0-9]*" } }}
                  data-testid="standalone-settings-telnet-port"
                />
                {terminalDraft.error === null ? (
                  <Alert
                    severity="info"
                    variant="outlined"
                    sx={{
                      color: "text.primary",
                      borderColor: "info.main",
                      bgcolor: "background.paper",
                      "& .MuiAlert-icon": {
                        color: "info.main"
                      }
                    }}
                  >
                    Saving writes normalized terminal preferences to local browser storage.
                  </Alert>
                ) : null}
                <Box>
                  <Button
                    variant="outlined"
                    onClick={handleSaveTerminalSettings}
                    disabled={terminalDraft.error !== null}
                    data-testid="standalone-settings-save-terminal"
                  >
                    Save Terminal Settings
                  </Button>
                </Box>
            </SectionCard>
          </Stack>
        );
      case "about":
        return (
          <Stack spacing={3}>
            <Box>
              <Typography variant="h6">About</Typography>
              <Typography variant="body2" color="text.secondary">
                Runtime version details and standalone diagnostics entrypoints.
              </Typography>
            </Box>
            <SectionCard
              title="Version & Updates"
              description="Version details and update status are shown directly here."
              tone="info"
            >
              {versionError ? (
                <Alert
                  severity="error"
                  variant="outlined"
                  sx={{
                    color: "text.primary",
                    borderColor: "error.main",
                    bgcolor: "background.paper",
                    "& .MuiAlert-icon": {
                      color: "error.main"
                    }
                  }}
                >
                  {versionError}
                </Alert>
              ) : null}
              <TextField
                label="Containerlab Version"
                value={versionLoading ? "Loading..." : versionInfo}
                fullWidth
                multiline
                minRows={4}
                slotProps={{ input: { readOnly: true } }}
                data-testid="standalone-settings-version-info"
              />
              <TextField
                label="Update Check"
                value={versionLoading ? "Loading..." : versionCheck}
                fullWidth
                multiline
                minRows={4}
                slotProps={{ input: { readOnly: true } }}
                data-testid="standalone-settings-version-check"
              />
            </SectionCard>
          </Stack>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <Tooltip title="Settings" placement="left">
        <IconButton
          onClick={handleTogglePanel}
          size="small"
          data-testid="standalone-settings-button"
          aria-label="Open standalone settings"
          sx={{
            position: "fixed",
            top: 8,
            right: 8,
            zIndex: 1200,
            bgcolor: "background.paper",
            color: "action.active",
            border: 1,
            borderColor: "divider",
            boxShadow: 2,
            "&:hover": {
              bgcolor: "action.hover"
            }
          }}
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {panelOpen ? (
        <Paper
          elevation={10}
          data-testid="standalone-settings-panel"
          sx={{
            position: "fixed",
            top: 8,
            right: 48,
            zIndex: 1200,
            width: 320,
            maxWidth: "calc(100vw - 64px)",
            p: 2,
            border: 1,
            borderColor: "divider",
            bgcolor: "background.paper"
          }}
        >
          <Stack spacing={1.5}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="subtitle2">Quick Settings</Typography>
              <IconButton size="small" onClick={handleClosePanel} aria-label="Close quick settings">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
            <Divider />
            <Stack spacing={1}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">
                    API Server
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: "monospace",
                      fontSize: "0.76rem",
                      wordBreak: "break-all"
                    }}
                  >
                    {apiUrl}
                  </Typography>
                </Box>
                <StatusPill connected={connected} />
              </Stack>
              <Button variant="outlined" onClick={handleOpenDialog} data-testid="standalone-settings-open-dialog">
                Open Preferences
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<LogoutIcon />}
                onClick={handleLogoutClick}
              >
                Logout
              </Button>
            </Stack>
          </Stack>
        </Paper>
      ) : null}

      <Dialog
        open={dialogOpen}
        onClose={handleCloseDialog}
        fullWidth
        maxWidth="lg"
        data-testid="standalone-settings-dialog"
        slotProps={{
          paper: {
            sx: {
              minHeight: { xs: "calc(100vh - 32px)", md: 600 },
              height: { xs: "calc(100vh - 32px)", md: "76vh" }
            }
          }
        }}
      >
        <DialogTitle
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            py: 1.5
          }}
        >
          Settings
          <IconButton
            size="small"
            onClick={handleCloseDialog}
            data-testid="standalone-settings-close"
            aria-label="Close standalone settings"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0, overflow: "hidden" }}>
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", md: "row" },
              minHeight: 0,
              height: "100%"
            }}
          >
            <Box
              sx={{
                width: { xs: "100%", md: 260 },
                flexShrink: 0,
                borderRight: { xs: 0, md: 1 },
                borderBottom: { xs: 1, md: 0 },
                borderColor: "divider",
                bgcolor: "background.default"
              }}
            >
              <List disablePadding>
                {SETTINGS_SECTIONS.map((section, index) => (
                  <React.Fragment key={section.key}>
                    {index > 0 ? <Divider /> : null}
                    <ListItemButton
                      selected={section.key === activeSection}
                      onClick={() => setActiveSection(section.key)}
                      data-testid={`standalone-settings-nav-${section.key}`}
                      sx={{
                        alignItems: "flex-start",
                        py: 1.5,
                        "&.Mui-selected": {
                          bgcolor: "action.selected",
                          color: "text.primary"
                        },
                        "&.Mui-selected:hover": {
                          bgcolor: "action.hover"
                        }
                      }}
                    >
                      <ListItemIcon
                        sx={{
                          minWidth: 36,
                          mt: 0.25,
                          color: section.key === activeSection ? "text.primary" : "text.secondary"
                        }}
                      >
                        {section.icon}
                      </ListItemIcon>
                      <ListItemText
                        primary={section.label}
                        secondary={section.description}
                        primaryTypographyProps={{ fontWeight: 600, color: "inherit" }}
                        secondaryTypographyProps={{ sx: { mt: 0.25, color: "text.secondary" } }}
                      />
                    </ListItemButton>
                  </React.Fragment>
                ))}
              </List>
            </Box>
            <Box sx={{ flex: 1, minWidth: 0, overflow: "auto" }}>
              <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 840 }}>{renderSectionContent()}</Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
