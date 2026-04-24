import React, { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
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
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import {
  Close as CloseIcon,
  Download as DownloadIcon,
  DarkMode as DarkModeIcon,
  DnsRounded as DnsRoundedIcon,
  InfoOutlined as InfoOutlinedIcon,
  Link as LinkIcon,
  LightMode as LightModeIcon,
  Logout as LogoutIcon,
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
  Upload as UploadIcon,
  Terminal as TerminalIcon
} from "@mui/icons-material";

import { subscribeEndpointUiAction, type EndpointUiAction } from "../endpointActions";
import {
  fetchEdgeSharkStatus,
  fetchVersionCheck,
  fetchVersionInfo,
  installEdgeShark,
  uninstallEdgeShark,
  type EdgeSharkStatusResponse
} from "../runtimeApi";
import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_PRESETS,
  type TerminalPreferences
} from "../runtimeTerminalSettings";
import {
  getSessionHostnameOverride,
  loadCapturePreferences,
  persistCapturePreferences,
  setSessionHostnameOverride,
  type CapturePreferences,
  type CapturePreferredAction
} from "../runtimeCaptureSettings";
import {
  type EndpointConfig,
  type EndpointSessionDuration
} from "../stores/endpointStore";
import { EndpointManager } from "./EndpointManager";

type SettingsSectionKey = "endpoints" | "general" | "terminal" | "capture" | "about";

interface SettingsOverlayProps {
  currentTheme: "light" | "dark";
  defaultApiUrl: string;
  endpoints: EndpointConfig[];
  onAddEndpoint: (input: {
    label?: string;
    password: string;
    sessionDuration: EndpointSessionDuration;
    url: string;
    username: string;
  }) => Promise<void>;
  onLogout: () => void;
  onReconnectEndpoint: (input: {
    endpointId: string;
    password: string;
    username: string;
  }) => Promise<void>;
  onRemoveEndpoint: (endpointId: string) => Promise<void>;
  onUpdateEndpoint: (input: {
    endpointId: string;
    label: string;
    sessionDuration: EndpointSessionDuration;
    url: string;
    username: string;
  }) => Promise<void>;
  onSetEndpointSessionDuration: (
    endpointId: string,
    sessionDuration: EndpointSessionDuration
  ) => void;
  onSaveTerminalPreferences: (
    next: TerminalPreferences,
    options?: {
      notify?: boolean;
    }
  ) => void;
  onThemeChange: (nextTheme: "light" | "dark") => void;
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
      field: "ssh" | "telnet" | "fontSize";
    };

function formatCaptureStatus(
  hasEndpoint: boolean,
  loading: boolean,
  status: EdgeSharkStatusResponse | null,
  endpointLabel: string
): string {
  if (!hasEndpoint) {
    return "No endpoint selected";
  }
  if (loading) {
    return `Loading status for ${endpointLabel}...`;
  }
  if (!status) {
    return `Unknown on ${endpointLabel}`;
  }
  if (!status.running) {
    return `Not running on ${endpointLabel}`;
  }
  return `Running on ${endpointLabel}${status.version ? ` (${status.version})` : ""}`;
}

const SETTINGS_SECTIONS: Array<{
  key: SettingsSectionKey;
  label: string;
  description: string;
  icon: React.ReactElement;
}> = [
  {
    key: "endpoints",
    label: "Endpoints",
    description: "Connection management and credentials",
    icon: <DnsRoundedIcon fontSize="small" />
  },
  {
    key: "general",
    label: "General",
    description: "Theme and workspace behavior",
    icon: <SettingsIcon fontSize="small" />
  },
  {
    key: "terminal",
    label: "Terminal",
    description: "SSH mapping, telnet, and font defaults",
    icon: <TerminalIcon fontSize="small" />
  },
  {
    key: "capture",
    label: "Capture",
    description: "Edgeshark and packet capture helpers",
    icon: <LinkIcon fontSize="small" />
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

function parseTerminalPreferencesDraft(
  sshUserMappingText: string,
  telnetPortText: string,
  fontSizeText: string
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

  const fontSize = Number(fontSizeText.trim());
  if (
    !Number.isInteger(fontSize) ||
    fontSize < MIN_TERMINAL_FONT_SIZE ||
    fontSize > MAX_TERMINAL_FONT_SIZE
  ) {
    return {
      error: `Terminal font size must be an integer between ${MIN_TERMINAL_FONT_SIZE} and ${MAX_TERMINAL_FONT_SIZE}.`,
      field: "fontSize"
    };
  }

  return {
    error: null,
    field: null,
    preferences: {
      sshUserMapping: normalizedMapping,
      telnetPort,
      fontSize
    }
  };
}

export function SettingsOverlay({
  currentTheme,
  defaultApiUrl,
  endpoints,
  onAddEndpoint,
  onLogout,
  onReconnectEndpoint,
  onRemoveEndpoint,
  onUpdateEndpoint,
  onSetEndpointSessionDuration,
  onSaveTerminalPreferences,
  onThemeChange,
  terminalPreferences
}: SettingsOverlayProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>("endpoints");
  const [requestedEndpointAction, setRequestedEndpointAction] = useState<EndpointUiAction | null>(null);
  const [sshUserMappingText, setSshUserMappingText] = useState("");
  const [telnetPortText, setTelnetPortText] = useState("");
  const [fontSizeText, setFontSizeText] = useState("");
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionInfo, setVersionInfo] = useState("");
  const [versionCheck, setVersionCheck] = useState("");
  const [captureStatusLoading, setCaptureStatusLoading] = useState(false);
  const [captureActionLoading, setCaptureActionLoading] = useState<"install" | "uninstall" | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<EdgeSharkStatusResponse | null>(null);
  const [capturePreferences, setCapturePreferences] = useState<CapturePreferences>(() =>
    loadCapturePreferences()
  );
  const [captureEndpointId, setCaptureEndpointId] = useState("");
  const [captureSessionHostname, setCaptureSessionHostname] = useState(
    () => getSessionHostnameOverride() ?? ""
  );

  const primaryEndpoint =
    endpoints.find((endpoint) => endpoint.status === "connected") ?? endpoints[0] ?? null;
  const captureEndpoint =
    endpoints.find((endpoint) => endpoint.id === captureEndpointId) ?? null;
  const captureEndpointLabel =
    captureEndpoint?.label || captureEndpoint?.url || captureEndpoint?.id || "selected endpoint";

  useEffect(() => {
    setSshUserMappingText(JSON.stringify(terminalPreferences.sshUserMapping, null, 2));
    setTelnetPortText(String(terminalPreferences.telnetPort));
    setFontSizeText(String(terminalPreferences.fontSize));
  }, [terminalPreferences]);

  useEffect(() => {
    const selectedStillExists = endpoints.some((endpoint) => endpoint.id === captureEndpointId);
    if (selectedStillExists) {
      return;
    }
    setCaptureEndpointId(primaryEndpoint?.id ?? "");
  }, [captureEndpointId, endpoints, primaryEndpoint?.id]);

  useEffect(() => {
    const unsubscribe = subscribeEndpointUiAction((action) => {
      setPanelOpen(false);
      setDialogOpen(true);
      setActiveSection("endpoints");
      setRequestedEndpointAction(action);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!dialogOpen || activeSection !== "about") {
      return;
    }

    let cancelled = false;
    setVersionLoading(true);
    setVersionError(null);

    void (async () => {
      try {
        const [version, check] = await Promise.all([
          fetchVersionInfo(primaryEndpoint?.id),
          fetchVersionCheck(primaryEndpoint?.id)
        ]);
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
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSection, dialogOpen, primaryEndpoint?.id]);

  const refreshCaptureStatus = useCallback(async () => {
    if (!captureEndpoint?.id) {
      setCaptureStatus(null);
      setCaptureError(null);
      setCaptureStatusLoading(false);
      return;
    }
    setCaptureStatusLoading(true);
    setCaptureError(null);
    setCaptureStatus(null);
    try {
      const status = await fetchEdgeSharkStatus(captureEndpoint.id);
      setCaptureStatus(status);
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : String(error));
    } finally {
      setCaptureStatusLoading(false);
    }
  }, [captureEndpoint?.id]);

  useEffect(() => {
    if (!dialogOpen || activeSection !== "capture") {
      return;
    }
    setCapturePreferences(loadCapturePreferences(captureEndpoint?.id));
    setCaptureSessionHostname(getSessionHostnameOverride(captureEndpoint?.id) ?? "");
    void refreshCaptureStatus();
  }, [activeSection, captureEndpoint?.id, dialogOpen, refreshCaptureStatus]);

  const handlePreferredCaptureActionChange = useCallback((
    _event: React.MouseEvent<HTMLElement>,
    nextAction: CapturePreferredAction | null
  ) => {
    if (!nextAction) {
      return;
    }
    const persisted = persistCapturePreferences({
      ...capturePreferences,
      preferredAction: nextAction
    }, captureEndpoint?.id);
    setCapturePreferences(persisted);
  }, [captureEndpoint?.id, capturePreferences]);

  const applyCaptureSessionHostname = useCallback(() => {
    const next = setSessionHostnameOverride(captureSessionHostname, captureEndpoint?.id);
    setCaptureSessionHostname(next ?? "");
  }, [captureEndpoint?.id, captureSessionHostname]);

  const clearCaptureSessionHostname = useCallback(() => {
    setSessionHostnameOverride(undefined, captureEndpoint?.id);
    setCaptureSessionHostname("");
  }, [captureEndpoint?.id]);

  const terminalDraft = useMemo(
    () => parseTerminalPreferencesDraft(sshUserMappingText, telnetPortText, fontSizeText),
    [fontSizeText, sshUserMappingText, telnetPortText]
  );

  const handleTogglePanel = useCallback(() => setPanelOpen((prev) => !prev), []);
  const handleClosePanel = useCallback(() => setPanelOpen(false), []);
  const handleOpenDialog = useCallback(
    (section: SettingsSectionKey = "endpoints") => {
      setPanelOpen(false);
      setActiveSection(section);
      setDialogOpen(true);
    },
    []
  );
  const handleCloseDialog = useCallback(() => {
    setDialogOpen(false);
    setRequestedEndpointAction(null);
  }, []);

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
      case "endpoints":
        return (
          <Stack spacing={3}>
            <Box>
              <Typography variant="h6">Endpoints</Typography>
              <Typography variant="body2" color="text.secondary">
                Configure every `clab-api-server` session that should appear in the explorer. The
                selected target endpoint is resolved per action from endpoint context or a picker.
              </Typography>
            </Box>
            <EndpointManager
              defaultApiUrl={defaultApiUrl}
              endpoints={endpoints}
              healthStatsEnabled={dialogOpen && activeSection === "endpoints"}
              onAddEndpoint={onAddEndpoint}
              onReconnectEndpoint={onReconnectEndpoint}
              onRemoveEndpoint={onRemoveEndpoint}
              onUpdateEndpoint={onUpdateEndpoint}
              onSetEndpointSessionDuration={onSetEndpointSessionDuration}
              onRequestedActionHandled={() => setRequestedEndpointAction(null)}
              requestedAction={requestedEndpointAction}
            />
          </Stack>
        );
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
                Configure standalone defaults for SSH username resolution, telnet access, and terminal font sizing.
              </Typography>
            </Box>
            <SectionCard
              title="Terminal Defaults"
              description="Configure standalone defaults for SSH username resolution, telnet access, and font sizing."
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
              <TextField
                label="Terminal Font Size"
                value={fontSizeText}
                onChange={(event) => setFontSizeText(event.target.value)}
                fullWidth
                error={terminalDraft.field === "fontSize"}
                helperText={
                  terminalDraft.field === "fontSize"
                    ? terminalDraft.error
                    : `Global xterm font size applied to open/new windows (${MIN_TERMINAL_FONT_SIZE}-${MAX_TERMINAL_FONT_SIZE}).`
                }
                slotProps={{
                  htmlInput: {
                    inputMode: "numeric",
                    pattern: "[0-9]*",
                    min: MIN_TERMINAL_FONT_SIZE,
                    max: MAX_TERMINAL_FONT_SIZE
                  }
                }}
                data-testid="standalone-settings-font-size"
              />
              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                {TERMINAL_FONT_SIZE_PRESETS.map((preset) => (
                  <Chip
                    key={preset}
                    size="small"
                    label={`${preset}px`}
                    onClick={() => setFontSizeText(String(preset))}
                    variant={Number(fontSizeText.trim()) === preset ? "filled" : "outlined"}
                    color={Number(fontSizeText.trim()) === preset ? "primary" : "default"}
                    data-testid={`standalone-settings-font-size-preset-${preset}`}
                  />
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Font size is global for all terminals. In terminal windows, use Actions or Alt+Up, Alt+Down,
                Alt+0 for quick adjustment.
              </Typography>
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
      case "capture":
        return (
          <Stack spacing={3}>
            <Box>
              <Typography variant="h6">Capture</Typography>
              <Typography variant="body2" color="text.secondary">
                Manage Edgeshark availability for packet capture and Wireshark noVNC sessions.
              </Typography>
            </Box>
            <SectionCard
              title="Edgeshark"
              description="Install or uninstall Edgeshark on the selected endpoint host."
              tone={captureEndpoint && captureStatus?.running ? "success" : "warning"}
            >
              {captureError ? (
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
                  {captureError}
                </Alert>
              ) : null}
              <TextField
                select
                label="Endpoint"
                value={captureEndpointId}
                onChange={(event) => setCaptureEndpointId(event.target.value)}
                fullWidth
                disabled={endpoints.length === 0}
                helperText="Capture status/actions and defaults are scoped to this endpoint."
                data-testid="standalone-settings-capture-endpoint"
              >
                {endpoints.length === 0 ? (
                  <MenuItem value="">No endpoints configured</MenuItem>
                ) : (
                  endpoints.map((endpoint) => (
                    <MenuItem key={endpoint.id} value={endpoint.id}>
                      {endpoint.label} ({endpoint.status})
                    </MenuItem>
                  ))
                )}
              </TextField>
              <TextField
                label="Status"
                value={formatCaptureStatus(Boolean(captureEndpoint), captureStatusLoading, captureStatus, captureEndpointLabel)}
                fullWidth
                slotProps={{ input: { readOnly: true } }}
                data-testid="standalone-settings-capture-status"
              />
              <Stack direction="row" spacing={1.25} flexWrap="wrap">
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={() => {
                    void refreshCaptureStatus();
                  }}
                  disabled={!captureEndpoint || captureStatusLoading || captureActionLoading !== null}
                  data-testid="standalone-settings-capture-refresh"
                >
                  Refresh
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={() => {
                    setCaptureActionLoading("install");
                    setCaptureError(null);
                    void installEdgeShark(captureEndpoint?.id)
                      .then(() => refreshCaptureStatus())
                      .catch((error) =>
                        setCaptureError(error instanceof Error ? error.message : String(error))
                      )
                      .finally(() => setCaptureActionLoading(null));
                  }}
                  disabled={!captureEndpoint || captureStatusLoading || captureActionLoading !== null}
                  data-testid="standalone-settings-capture-install"
                >
                  Install
                </Button>
                <Button
                  variant="outlined"
                  color="warning"
                  startIcon={<UploadIcon />}
                  onClick={() => {
                    setCaptureActionLoading("uninstall");
                    setCaptureError(null);
                    void uninstallEdgeShark(captureEndpoint?.id)
                      .then(() => refreshCaptureStatus())
                      .catch((error) =>
                        setCaptureError(error instanceof Error ? error.message : String(error))
                      )
                      .finally(() => setCaptureActionLoading(null));
                  }}
                  disabled={!captureEndpoint || captureStatusLoading || captureActionLoading !== null}
                  data-testid="standalone-settings-capture-uninstall"
                >
                  Uninstall
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Capture defaults (image, pull policy, packetflix host/port) are controlled on the
                API server via environment variables.
              </Typography>
            </SectionCard>
            <SectionCard
              title="Capture Defaults"
              description="Set per-endpoint defaults for generic capture commands and optional session hostname override."
              tone="info"
            >
              <ToggleButtonGroup
                exclusive
                value={capturePreferences.preferredAction}
                onChange={handlePreferredCaptureActionChange}
                disabled={!captureEndpoint}
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
                <ToggleButton value="wireshark-vnc" data-testid="standalone-settings-capture-default-vnc">
                  Wireshark VNC
                </ToggleButton>
                <ToggleButton value="edgeshark" data-testid="standalone-settings-capture-default-edgeshark">
                  Edgeshark
                </ToggleButton>
              </ToggleButtonGroup>
              <TextField
                label="Session Hostname Override"
                value={captureSessionHostname}
                onChange={(event) => setCaptureSessionHostname(event.target.value)}
                fullWidth
                placeholder="IPv4, IPv6, or DNS hostname"
                helperText="Used for packetflix URI generation on the selected endpoint in this browser session only."
                data-testid="standalone-settings-capture-session-hostname"
              />
              <Stack direction="row" spacing={1.25} flexWrap="wrap">
                <Button
                  variant="outlined"
                  onClick={applyCaptureSessionHostname}
                  disabled={!captureEndpoint}
                  data-testid="standalone-settings-capture-session-hostname-apply"
                >
                  Apply Session Hostname
                </Button>
                <Button
                  variant="outlined"
                  color="warning"
                  onClick={clearCaptureSessionHostname}
                  disabled={!captureEndpoint}
                  data-testid="standalone-settings-capture-session-hostname-clear"
                >
                  Clear Override
                </Button>
              </Stack>
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
            width: 340,
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
            <Stack spacing={1.5}>
              <Button
                variant="outlined"
                onClick={() => handleOpenDialog("general")}
                data-testid="standalone-settings-open-dialog"
              >
                General Settings
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<LogoutIcon />}
                onClick={handleLogoutClick}
              >
                Disconnect Sessions
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
              <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 860 }}>{renderSectionContent()}</Box>
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
