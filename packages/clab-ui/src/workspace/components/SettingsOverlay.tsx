import { useWorkspaceHost } from "../WorkspaceHost";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Switch,
  Typography
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";

import { subscribeEndpointUiAction, type EndpointUiAction } from "../state/endpointActions";
import type { EdgeSharkStatusResponse, LabHostSetupProps } from "../types";
import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_PRESETS,
  type TerminalPreferences
} from "../state/runtimeTerminalSettings";
import {
  type EndpointConfig,
  type EndpointImportResult,
  type EndpointSessionDuration,
  type LocalEndpointOffer
} from "../endpoints";
import { SettingsLayout } from "../../settings/SettingsLayout";
import { SettingsField } from "../../settings/SettingsField";
import { floatingSurfaceSx, overlayShadow } from "../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../theme/typography";
import { AboutSettingsContent } from "./AboutSettingsContent";
import { AppearanceSettingsContent } from "./AppearanceSettingsContent";
import { labHostSettingAccess } from "../../host/labHostSettings";
import {
  ADD_HOST_PAGE,
  hostPageId,
  hostPageKey,
  labHostNavigationItems,
  labHostSettingsSubject
} from "../../settings/labHostEntries";
import type { SettingsNavigationItem } from "../../settings/SettingsNavigation";
import { LAB_HOST_KIND_LABELS, labHostKind } from "../endpoints";
import { LabHostPage } from "./LabHostPage";
import { EndpointManager } from "./EndpointManager";
import {
  persistAutoOpenPalette,
  persistAutoOpenPaletteOnSelect,
  persistDefaultLabLocked,
  persistHoverCards,
  readPersistedAutoOpenPalette,
  readPersistedAutoOpenPaletteOnSelect,
  readPersistedDefaultLabLocked,
  readPersistedHoverCards,
  type StandaloneAppearance,
  type TabOrientation
} from "../state/themePreferences";

/** A page of the settings: the app's own, a lab host's (`host:<id>`), or "Add lab host". */
type SettingsSectionKey = string;

interface SettingsOverlayProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  appearance: StandaloneAppearance;
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
  onAppearanceChange: (next: StandaloneAppearance) => void;
  /** Offered when the host can run labs on this machine. */
  localEndpoint?: LocalEndpointOffer;
  /** More local lab hosts, such as Kubernetes clusters. */
  extraLocalEndpoints?: readonly LocalEndpointOffer[];
  /** How the app adds clusters, checks lab hosts, and why some kinds are not offered. */
  labHostSetup?: LabHostSetupProps;
  tabOrientation?: TabOrientation;
  onTabOrientationChange?: (orientation: TabOrientation) => void;
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

const APP_SECTIONS: SettingsNavigationItem[] = [
  {
    key: "general",
    label: "General",
    description: "Workspace behavior",
    icon: <SettingsOutlinedIcon fontSize="small" />,
    group: "App"
  },
  {
    key: "appearance",
    label: "Appearance",
    description: "Color mode, themes and custom colors",
    icon: <PaletteOutlinedIcon fontSize="small" />,
    group: "App"
  },
  {
    key: "terminal",
    label: "Terminal",
    description: "SSH mapping, telnet, and font defaults",
    icon: <TerminalIcon fontSize="small" />,
    group: "App"
  }
];

const ABOUT_SECTION: SettingsNavigationItem = {
  key: "about",
  label: "About",
  description: "Version and diagnostics entrypoints",
  icon: <InfoOutlinedIcon fontSize="small" />,
  group: "Other"
};

function SectionCard(props: {
  title: string;
  description: string;
  tone?: "info" | "success" | "warning" | "error";
  wide?: boolean;
  /** Sizes the control to its content (switches) instead of the shared field width. */
  compactControl?: boolean;
  children: React.ReactNode;
}) {
  return (
    <SettingsField
      title={props.title}
      description={props.description}
      wide={props.wide ?? true}
      compactControl={props.compactControl}
    >
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

export function SettingsOverlay({
  open,
  onOpen,
  onClose,
  appearance,
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
  onAppearanceChange,
  localEndpoint,
  extraLocalEndpoints,
  labHostSetup,
  tabOrientation = "horizontal",
  onTabOrientationChange,
  terminalPreferences
}: SettingsOverlayProps) {
  const [autoOpenPalette, setAutoOpenPalette] = useState(readPersistedAutoOpenPalette);
  const [autoOpenPaletteOnSelect, setAutoOpenPaletteOnSelect] = useState(readPersistedAutoOpenPaletteOnSelect);
  const [defaultLabLocked, setDefaultLabLocked] = useState(readPersistedDefaultLabLocked);
  const [hoverCards, setHoverCards] = useState(readPersistedHoverCards);
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
  const primaryEndpoint = primarySettingsEndpoint(endpoints);
  const hostId = hostPageId(activeSection);
  const hostEndpoint = hostId === undefined ? null : (endpoints.find((endpoint) => endpoint.id === hostId) ?? null);

  useEffect(() => {
    setSshUserMappingText(JSON.stringify(terminalPreferences.sshUserMapping, null, 2));
    setTelnetPortText(String(terminalPreferences.telnetPort));
    setFontSizeText(String(terminalPreferences.fontSize));
  }, [terminalPreferences]);

  // A removed lab host's page goes; "Add lab host" takes its place.
  useEffect(() => {
    if (hostId !== undefined && hostEndpoint === null) setActiveSection(ADD_HOST_PAGE);
  }, [hostEndpoint, hostId]);

  useEffect(() => {
    const unsubscribe = subscribeEndpointUiAction((action) => {
      onOpen();
      if (action.action === "add") {
        setActiveSection(ADD_HOST_PAGE);
        setRequestedEndpointAction(null);
        return;
      }
      // Sign in, remove and the toolbar chip open the lab host's page.
      setActiveSection(hostPageKey(action.endpointId));
      setRequestedEndpointAction(action.action === "settings" ? null : action);
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

  const edgesharkHost =
    hostEndpoint !== null && hostEndpoint.status === "connected" && labHostSettingAccess("edgeshark", labHostSettingsSubject(hostEndpoint)).access === "edit"
      ? hostEndpoint.id
      : undefined;
  const refreshCaptureStatus = useCallback(async () => {
    if (edgesharkHost === undefined) {
      setCaptureStatus(null);
      setCaptureError(null);
      setCaptureStatusLoading(false);
      return;
    }
    setCaptureStatusLoading(true);
    setCaptureError(null);
    setCaptureStatus(null);
    try {
      setCaptureStatus(await fetchEdgeSharkStatus(edgesharkHost));
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : String(error));
    } finally {
      setCaptureStatusLoading(false);
    }
  }, [edgesharkHost, fetchEdgeSharkStatus]);

  useEffect(() => {
    if (!dialogOpen || edgesharkHost === undefined) return;
    void refreshCaptureStatus();
  }, [dialogOpen, edgesharkHost, refreshCaptureStatus]);

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

  const endpointManagerProps = {
    defaultApiUrl,
    onAddEndpoint,
    onExportEndpoints,
    onImportEndpoints,
    onReconnectEndpoint,
    onRemoveEndpoint,
    onUpdateEndpoint,
    onSetEndpointSessionDuration,
    ...(localEndpoint ? { localEndpoint } : {}),
    ...(extraLocalEndpoints ? { extraLocalEndpoints } : {}),
    ...labHostSetup,
    onRequestedActionHandled: () => setRequestedEndpointAction(null),
    requestedAction: requestedEndpointAction
  };

  const renderSectionContent = () => {
    if (hostEndpoint !== null) {
      return (
        <LabHostPage
          key={hostEndpoint.id}
          endpoint={hostEndpoint}
          manager={{ ...endpointManagerProps, healthStatsEnabled: dialogOpen }}
          localWireshark={capabilities.localWireshark === true}
          edgeshark={{
            status: captureStatus,
            loading: captureStatusLoading,
            error: captureError,
            action: captureActionLoading,
            setAction: setCaptureActionLoading,
            setError: setCaptureError,
            refresh: refreshCaptureStatus
          }}
        />
      );
    }
    switch (activeSection) {
      case ADD_HOST_PAGE:
        return <EndpointManager {...endpointManagerProps} endpoints={endpoints} show="add" />;
      case "general":
        return (
          <>
            {onTabOrientationChange ? (
              <SectionCard
                title="Open tabs"
                description="Horizontal tabs sit above the editor. Vertical tabs sit in the workspace rail."
                wide={false}
              >
                <TextField
                  select
                  size="small"
                  value={tabOrientation}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next === "horizontal" || next === "vertical") onTabOrientationChange(next);
                  }}
                >
                  <MenuItem value="horizontal" data-testid="standalone-settings-tabs-horizontal">
                    Horizontal
                  </MenuItem>
                  <MenuItem value="vertical" data-testid="standalone-settings-tabs-vertical">
                    Vertical
                  </MenuItem>
                </TextField>
              </SectionCard>
            ) : null}
            <SectionCard
              title="Automatically open palette"
              description="Open the node palette when you open an empty lab."
              wide={false}
              compactControl
            >
              <Switch
                size="small"
                checked={autoOpenPalette}
                onChange={(event) => {
                  const next = event.target.checked;
                  setAutoOpenPalette(next);
                  persistAutoOpenPalette(next);
                }}
                slotProps={{ input: { "aria-label": "Automatically open palette" } }}
              />
            </SectionCard>
            <SectionCard
              title="Open palette on node click"
              description="Open the side panel when you click a node or link."
              wide={false}
              compactControl
            >
              <Switch
                size="small"
                checked={autoOpenPaletteOnSelect}
                onChange={(event) => {
                  const next = event.target.checked;
                  setAutoOpenPaletteOnSelect(next);
                  persistAutoOpenPaletteOnSelect(next);
                }}
                slotProps={{ input: { "aria-label": "Open palette on node click" } }}
              />
            </SectionCard>
            <SectionCard
              title="Lock labs by default"
              description="Labs open locked until you unlock them."
              wide={false}
              compactControl
            >
              <Switch
                size="small"
                checked={defaultLabLocked}
                onChange={(event) => {
                  const next = event.target.checked;
                  setDefaultLabLocked(next);
                  persistDefaultLabLocked(next);
                }}
                slotProps={{ input: { "aria-label": "Lock labs by default" } }}
              />
            </SectionCard>
            <SectionCard
              title="Details on hover"
              description="Show a card with a node's or link's details when the pointer rests on it."
              wide={false}
              compactControl
            >
              <Switch
                size="small"
                checked={hoverCards}
                onChange={(event) => {
                  const next = event.target.checked;
                  setHoverCards(next);
                  persistHoverCards(next);
                }}
                slotProps={{ input: { "aria-label": "Details on hover" } }}
              />
            </SectionCard>
          </>
        );
      case "appearance":
        return (
          <AppearanceSettingsContent
            appearance={appearance}
            currentTheme={currentTheme}
            onAppearanceChange={onAppearanceChange}
          />
        );
      case "terminal":
        return (
            <SectionCard
              title="Terminal defaults"
              description="Defaults for SSH usernames, telnet and font size."
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
                    : "JSON object mapping kinds to default SSH usernames."
                }
                data-testid="standalone-settings-ssh-mapping"
                sx={{ "& textarea": { fontFamily: MONO_FONT_FAMILY, fontSize: 12 } }}
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
                    : "Telnet port for terminal actions."
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
                    : `Font size for all terminal windows (${MIN_TERMINAL_FONT_SIZE}-${MAX_TERMINAL_FONT_SIZE}).`
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
                Applies to all terminals. In a terminal window, use Actions or Alt+Up, Alt+Down and Alt+0 to adjust it.
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                <Button
                  onClick={handleSaveTerminalSettings}
                  disabled={terminalDraft.error !== null}
                  data-testid="standalone-settings-save-terminal"
                >
                  Save terminal settings
                </Button>
                {terminalDraft.error === null ? (
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Saved in this browser.
                  </Typography>
                ) : null}
              </Box>
            </SectionCard>
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
      default:
        return null;
    }
  };

  const sections: SettingsNavigationItem[] = [
    ...APP_SECTIONS.filter((section) => section.key !== "terminal" || capabilities.lifecycle),
    ...(capabilities.endpoints ? labHostNavigationItems(endpoints) : []),
    ABOUT_SECTION
  ];
  const active = sections.find((section) => section.key === activeSection) ?? sections[0];
  const sectionDescription = hostEndpoint
    ? `${LAB_HOST_KIND_LABELS[labHostKind(hostEndpoint)]} · settings for labs on this lab host`
    : active.description;
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
            ...floatingSurfaceSx,
            boxShadow: overlayShadow,
            minHeight: { xs: "calc(100vh - 32px)", md: 560 },
            height: { xs: "calc(100vh - 32px)", md: "76vh" },
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
        sectionDescription={sectionDescription}
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
                variant="text"
                color="error"
                startIcon={<LogoutIcon />}
                onClick={handleLogoutClick}
              >
                Disconnect sessions
              </Button>
            ) : (
              <span />
            )}
            <Button variant="outlined" onClick={handleCloseDialog}>
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
