import { useWorkspaceHost } from "../WorkspaceHost";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DnsRoundedIcon from "@mui/icons-material/DnsRounded";
import DownloadIcon from "@mui/icons-material/Download";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LinkIcon from "@mui/icons-material/Link";
import LogoutIcon from "@mui/icons-material/Logout";
import RefreshIcon from "@mui/icons-material/Refresh";
import SettingsIcon from "@mui/icons-material/Settings";
import TerminalIcon from "@mui/icons-material/Terminal";
import UploadIcon from "@mui/icons-material/Upload";

import { subscribeEndpointUiAction, type EndpointUiAction } from "../state/endpointActions";
import type { EdgeSharkStatusResponse } from "../types";
import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_PRESETS,
  type TerminalPreferences
} from "../state/runtimeTerminalSettings";
import {
  getSessionHostnameOverride,
  loadCapturePreferences,
  persistCapturePreferences,
  setSessionHostnameOverride,
  type CapturePreferences,
  type CapturePreferredAction
} from "../state/runtimeCaptureSettings";
import {
  type EndpointConfig,
  type EndpointImportResult,
  type EndpointSessionDuration
} from "../endpoints";
import { SettingsLayout } from "../../settings/SettingsLayout";
import { SettingsField } from "../../settings/SettingsField";
import { ColorSchemePicker } from "../../settings/ColorSchemePicker";
import { AboutSettingsContent } from "./AboutSettingsContent";
import { EndpointManager } from "./EndpointManager";

type SettingsSectionKey = "endpoints" | "general" | "terminal" | "capture" | "about";

interface SettingsOverlayProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
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
  onExportEndpoints: () => string;
  onImportEndpoints: (content: string) => EndpointImportResult | Promise<EndpointImportResult>;
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
    icon: (
      <LinkIcon
        sx={{
          fontSize: "small"
        }}
      />
    )
  },
  {
    key: "about",
    label: "About",
    description: "Version and diagnostics entrypoints",
    icon: <InfoOutlinedIcon fontSize="small" />
  }
];

function SectionCard(props: {
  title: string;
  description: string;
  tone?: "info" | "success" | "warning" | "error";
  children: React.ReactNode;
}) {
  return (
    <SettingsField title={props.title} description={props.description} wide>
      {props.children}
    </SettingsField>
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

function primarySettingsEndpoint(endpoints: EndpointConfig[]): EndpointConfig | null {
  return endpoints.find((endpoint) => endpoint.status === "connected") ?? endpoints[0] ?? null;
}

function captureSettingsEndpoint(
  endpoints: EndpointConfig[],
  captureEndpointId: string
): EndpointConfig | null {
  return endpoints.find((endpoint) => endpoint.id === captureEndpointId) ?? null;
}

function captureSettingsEndpointLabel(endpoint: EndpointConfig | null): string {
  return endpoint?.label || endpoint?.url || endpoint?.id || "selected endpoint";
}

function CaptureSettingsSection(props: {
  applyCaptureSessionHostname: () => void;
  captureActionLoading: "install" | "uninstall" | null;
  captureEndpoint: EndpointConfig | null;
  captureEndpointId: string;
  captureEndpointLabel: string;
  captureError: string | null;
  capturePreferences: CapturePreferences;
  captureSessionHostname: string;
  captureStatus: EdgeSharkStatusResponse | null;
  captureStatusLoading: boolean;
  clearCaptureSessionHostname: () => void;
  endpoints: EndpointConfig[];
  handlePreferredCaptureActionChange: (
    event: React.MouseEvent<HTMLElement>,
    nextAction: CapturePreferredAction | null
  ) => void;
  refreshCaptureStatus: () => Promise<void>;
  setCaptureActionLoading: (action: "install" | "uninstall" | null) => void;
  setCaptureEndpointId: (endpointId: string) => void;
  setCaptureError: (message: string | null) => void;
  setCaptureSessionHostname: (hostname: string) => void;
}) {
  const { installEdgeShark, uninstallEdgeShark } = useWorkspaceHost().api;
  const runCaptureAction = (action: "install" | "uninstall") => {
    props.setCaptureActionLoading(action);
    props.setCaptureError(null);
    const operation = action === "install" ? installEdgeShark : uninstallEdgeShark;
    void operation(props.captureEndpoint?.id)
      .then(() => props.refreshCaptureStatus())
      .catch((error) =>
        props.setCaptureError(error instanceof Error ? error.message : String(error))
      )
      .finally(() => props.setCaptureActionLoading(null));
  };

  return (
    <Stack spacing={1.5}>
      <SectionCard
        title="Edgeshark"
        description="Install or uninstall Edgeshark on the selected endpoint host."
        tone={props.captureEndpoint && props.captureStatus?.running ? "success" : "warning"}
      >
        {props.captureError ? (
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
            {props.captureError}
          </Alert>
        ) : null}
        <TextField
          select
          label="Endpoint"
          value={props.captureEndpointId}
          onChange={(event) => props.setCaptureEndpointId(event.target.value)}
          fullWidth
          disabled={props.endpoints.length === 0}
          helperText="Capture status/actions and defaults are scoped to this endpoint."
          data-testid="standalone-settings-capture-endpoint"
        >
          {props.endpoints.length === 0 ? (
            <MenuItem value="">No endpoints configured</MenuItem>
          ) : (
            props.endpoints.map((endpoint) => (
              <MenuItem key={endpoint.id} value={endpoint.id}>
                {endpoint.label} ({endpoint.status})
              </MenuItem>
            ))
          )}
        </TextField>
        <TextField
          label="Status"
          value={formatCaptureStatus(
            Boolean(props.captureEndpoint),
            props.captureStatusLoading,
            props.captureStatus,
            props.captureEndpointLabel
          )}
          fullWidth
          slotProps={{ input: { readOnly: true } }}
          data-testid="standalone-settings-capture-status"
        />
        <Stack
          direction="row"
          spacing={1.25}
          sx={{
            flexWrap: "wrap"
          }}
        >
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => {
              void props.refreshCaptureStatus();
            }}
            disabled={
              !props.captureEndpoint ||
              props.captureStatusLoading ||
              props.captureActionLoading !== null
            }
            data-testid="standalone-settings-capture-refresh"
          >
            Refresh
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={() => runCaptureAction("install")}
            disabled={
              !props.captureEndpoint ||
              props.captureStatusLoading ||
              props.captureActionLoading !== null
            }
            data-testid="standalone-settings-capture-install"
          >
            Install
          </Button>
          <Button
            variant="outlined"
            color="warning"
            startIcon={<UploadIcon />}
            onClick={() => runCaptureAction("uninstall")}
            disabled={
              !props.captureEndpoint ||
              props.captureStatusLoading ||
              props.captureActionLoading !== null
            }
            data-testid="standalone-settings-capture-uninstall"
          >
            Uninstall
          </Button>
        </Stack>
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary"
          }}
        >
          Capture defaults (image, pull policy, packetflix host/port) are controlled on the API
          server via environment variables.
        </Typography>
      </SectionCard>
      <SectionCard
        title="Capture Defaults"
        description="Set per-endpoint defaults for generic capture commands and optional session hostname override."
        tone="info"
      >
        <ToggleButtonGroup
          exclusive
          value={props.capturePreferences.preferredAction}
          onChange={props.handlePreferredCaptureActionChange}
          disabled={!props.captureEndpoint}
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
          <ToggleButton
            value="edgeshark"
            data-testid="standalone-settings-capture-default-edgeshark"
          >
            Edgeshark
          </ToggleButton>
        </ToggleButtonGroup>
        <TextField
          label="Session Hostname Override"
          value={props.captureSessionHostname}
          onChange={(event) => props.setCaptureSessionHostname(event.target.value)}
          fullWidth
          placeholder="IPv4, IPv6, or DNS hostname"
          helperText="Used for packetflix URI generation on the selected endpoint in this browser session only."
          data-testid="standalone-settings-capture-session-hostname"
        />
        <Stack
          direction="row"
          spacing={1.25}
          sx={{
            flexWrap: "wrap"
          }}
        >
          <Button
            variant="outlined"
            onClick={props.applyCaptureSessionHostname}
            disabled={!props.captureEndpoint}
            data-testid="standalone-settings-capture-session-hostname-apply"
          >
            Apply Session Hostname
          </Button>
          <Button
            variant="outlined"
            color="warning"
            onClick={props.clearCaptureSessionHostname}
            disabled={!props.captureEndpoint}
            data-testid="standalone-settings-capture-session-hostname-clear"
          >
            Clear Override
          </Button>
        </Stack>
      </SectionCard>
    </Stack>
  );
}

export function SettingsOverlay({
  open,
  onOpen,
  onClose,
  currentTheme,
  defaultApiUrl,
  endpoints,
  onAddEndpoint,
  onExportEndpoints,
  onImportEndpoints,
  onLogout,
  onReconnectEndpoint,
  onRemoveEndpoint,
  onUpdateEndpoint,
  onSetEndpointSessionDuration,
  onSaveTerminalPreferences,
  onThemeChange,
  terminalPreferences
}: SettingsOverlayProps) {
  const { fetchEdgeSharkStatus, fetchVersionCheck, fetchVersionInfo } = useWorkspaceHost().api;
  const { capabilities } = useWorkspaceHost();
  const dialogOpen = open;
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>("general");
  const [requestedEndpointAction, setRequestedEndpointAction] = useState<EndpointUiAction | null>(
    null
  );
  const [sshUserMappingText, setSshUserMappingText] = useState("");
  const [telnetPortText, setTelnetPortText] = useState("");
  const [fontSizeText, setFontSizeText] = useState("");
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionInfo, setVersionInfo] = useState("");
  const [versionCheck, setVersionCheck] = useState("");
  const [captureStatusLoading, setCaptureStatusLoading] = useState(false);
  const [captureActionLoading, setCaptureActionLoading] = useState<"install" | "uninstall" | null>(
    null
  );
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<EdgeSharkStatusResponse | null>(null);
  const [capturePreferences, setCapturePreferences] = useState<CapturePreferences>(() =>
    loadCapturePreferences()
  );
  const [captureEndpointId, setCaptureEndpointId] = useState("");
  const [captureSessionHostname, setCaptureSessionHostname] = useState(
    () => getSessionHostnameOverride() ?? ""
  );

  const primaryEndpoint = primarySettingsEndpoint(endpoints);
  const captureEndpoint = captureSettingsEndpoint(endpoints, captureEndpointId);
  const captureEndpointLabel = captureSettingsEndpointLabel(captureEndpoint);

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
      onOpen();
      setActiveSection("endpoints");
      if (action.action === "add") {
        setRequestedEndpointAction(null);
        return;
      }
      setRequestedEndpointAction(action);
    });
    return unsubscribe;
  }, [onOpen]);

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
  }, [activeSection, dialogOpen, primaryEndpoint?.id, fetchVersionInfo, fetchVersionCheck]);

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
  }, [captureEndpoint?.id, fetchEdgeSharkStatus]);

  useEffect(() => {
    if (!dialogOpen || activeSection !== "capture") {
      return;
    }
    setCapturePreferences(loadCapturePreferences(captureEndpoint?.id));
    setCaptureSessionHostname(getSessionHostnameOverride(captureEndpoint?.id) ?? "");
    void refreshCaptureStatus();
  }, [activeSection, captureEndpoint?.id, dialogOpen, refreshCaptureStatus]);

  const handlePreferredCaptureActionChange = useCallback(
    (_event: React.MouseEvent<HTMLElement>, nextAction: CapturePreferredAction | null) => {
      if (!nextAction) {
        return;
      }
      const persisted = persistCapturePreferences(
        {
          ...capturePreferences,
          preferredAction: nextAction
        },
        captureEndpoint?.id
      );
      setCapturePreferences(persisted);
    },
    [captureEndpoint?.id, capturePreferences]
  );

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

  const handleCloseDialog = useCallback(() => {
    onClose();
    setRequestedEndpointAction(null);
  }, [onClose]);

  const handleLogoutClick = useCallback(() => {
    onClose();
    onLogout();
  }, [onClose, onLogout]);

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
          <Stack spacing={1.5}>
            <EndpointManager
              defaultApiUrl={defaultApiUrl}
              endpoints={endpoints}
              healthStatsEnabled={dialogOpen && activeSection === "endpoints"}
              onAddEndpoint={onAddEndpoint}
              onExportEndpoints={onExportEndpoints}
              onImportEndpoints={onImportEndpoints}
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
          <Stack spacing={1.5}>
            <SectionCard title="Color Theme" description="Choose the color scheme for the app.">
              <ColorSchemePicker
                value={currentTheme}
                onChange={(nextTheme) => {
                  if (nextTheme !== "vscode") onThemeChange(nextTheme);
                }}
                testIdPrefix="standalone-settings-theme-"
              />
            </SectionCard>
          </Stack>
        );
      case "terminal":
        return (
          <Stack spacing={1.5}>
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
                minRows={5}
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
                slotProps={{
                  htmlInput: { inputMode: "numeric", pattern: "[0-9]*" }
                }}
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
              <Stack
                direction="row"
                spacing={0.75}
                useFlexGap
                sx={{
                  flexWrap: "wrap"
                }}
              >
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
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary"
                }}
              >
                Font size is global for all terminals. In terminal windows, use Actions or Alt+Up,
                Alt+Down, Alt+0 for quick adjustment.
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
          <AboutSettingsContent
            showHeading={false}
            versionCheck={versionCheck}
            versionError={versionError}
            versionInfo={versionInfo}
            versionLoading={versionLoading}
          />
        );
      case "capture":
        return (
          <CaptureSettingsSection
            applyCaptureSessionHostname={applyCaptureSessionHostname}
            captureActionLoading={captureActionLoading}
            captureEndpoint={captureEndpoint}
            captureEndpointId={captureEndpointId}
            captureEndpointLabel={captureEndpointLabel}
            captureError={captureError}
            capturePreferences={capturePreferences}
            captureSessionHostname={captureSessionHostname}
            captureStatus={captureStatus}
            captureStatusLoading={captureStatusLoading}
            clearCaptureSessionHostname={clearCaptureSessionHostname}
            endpoints={endpoints}
            handlePreferredCaptureActionChange={handlePreferredCaptureActionChange}
            refreshCaptureStatus={refreshCaptureStatus}
            setCaptureActionLoading={setCaptureActionLoading}
            setCaptureEndpointId={setCaptureEndpointId}
            setCaptureError={setCaptureError}
            setCaptureSessionHostname={setCaptureSessionHostname}
          />
        );
      default:
        return null;
    }
  };

  const sections = SETTINGS_SECTIONS.filter(
    (section) =>
      (section.key !== "endpoints" || capabilities.endpoints) &&
      (!["terminal", "capture"].includes(section.key) || capabilities.lifecycle)
  );
  const active = sections.find((section) => section.key === activeSection) ?? sections[0];
  return (
    <Dialog
      open={dialogOpen}
      onClose={handleCloseDialog}
      fullWidth
      maxWidth="lg"
      aria-labelledby="containerlab-settings-title"
      data-testid="standalone-settings-dialog"
      slotProps={{
        paper: {
          sx: {
            minHeight: { xs: "calc(100vh - 32px)", md: 560 },
            height: { xs: "calc(100vh - 32px)", md: "76vh" },
            borderRadius: 2,
            overflow: "hidden"
          }
        }
      }}
    >
      <SettingsLayout
        items={sections}
        active={activeSection}
        onSelect={(key) => setActiveSection(key as SettingsSectionKey)}
        navigationTestIdPrefix="standalone-settings-nav-"
        sectionTitle={active.label}
        sectionDescription={active.description}
        headerActions={
          <IconButton
            size="small"
            onClick={handleCloseDialog}
            data-testid="standalone-settings-close"
            aria-label="Close standalone settings"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        }
        footer={
          <>
            {capabilities.endpoints ? (
              <Button
                size="small"
                variant="text"
                color="error"
                startIcon={<LogoutIcon />}
                onClick={handleLogoutClick}
              >
                Disconnect Sessions
              </Button>
            ) : (
              <span />
            )}
            <Button size="small" onClick={handleCloseDialog}>
              Close
            </Button>
          </>
        }
      >
        {renderSectionContent()}
      </SettingsLayout>
    </Dialog>
  );
}
