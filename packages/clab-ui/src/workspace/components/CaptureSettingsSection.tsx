// The Capture section of the settings: the default capture method of a lab
// host, and Edgeshark on Docker and Podman lab hosts.
import React from "react";
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import RefreshIcon from "@mui/icons-material/Refresh";
import UploadIcon from "@mui/icons-material/Upload";

import { CAPTURE_METHODS, CAPTURE_METHOD_LABELS, type CaptureMethod } from "../../host/captureMethod";
import { KUBERNETES_LIMITS } from "../../host/kubernetesLimits";
import { NOT_ON_KUBERNETES } from "../../host/labHostSupport";
import { RuntimeLimited } from "../../components/ui/form/RuntimeLimited";
import { SettingsField } from "../../settings/SettingsField";
import { useWorkspaceHost } from "../WorkspaceHost";
import type { EndpointConfig } from "../endpoints";
import type { CapturePreferences } from "../state/runtimeCaptureSettings";
import type { EdgeSharkStatusResponse } from "../types";

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

interface MethodChoice {
  description: string;
  /** Why the method cannot open captures of this lab host; it shows greyed out. */
  unavailable?: string;
}

function automaticDescription(kubernetes: boolean, localWireshark: boolean): string {
  if (!kubernetes) return "Wireshark VNC when the lab host has it, else Edgeshark.";
  if (localWireshark) return "Wireshark on this computer, else Wireshark VNC, else a .pcapng download.";
  return "Wireshark VNC when the lab host has it, else a .pcapng download.";
}

function localWiresharkChoice(kubernetes: boolean, localWireshark: boolean): MethodChoice {
  if (!kubernetes) {
    return {
      description:
        "Opens through Edgeshark: its packetflix link starts Wireshark here, with Edgeshark's Wireshark plugin installed."
    };
  }
  if (localWireshark) return { description: "Wireshark installed here reads the cluster's capture stream." };
  return {
    description: "Wireshark installed on your computer.",
    unavailable:
      "The web app cannot start Wireshark on your computer for a Kubernetes lab host; use the desktop app or VS Code."
  };
}

/** What each method does for the selected lab host in this app, and which it lacks. */
function captureMethodChoices(
  kubernetes: boolean,
  localWireshark: boolean
): Record<CaptureMethod, MethodChoice> {
  return {
    auto: { description: automaticDescription(kubernetes, localWireshark) },
    "local-wireshark": localWiresharkChoice(kubernetes, localWireshark),
    "wireshark-vnc": {
      description: kubernetes
        ? "Wireshark in a browser window, in a container next to the lab host."
        : "Wireshark in a browser window, in a container on the lab host, fed by Edgeshark."
    },
    edgeshark: kubernetes
      ? {
          description: "A packetflix link that Wireshark opens through Edgeshark.",
          unavailable: `${NOT_ON_KUBERNETES}: clabernetes captures lab links as one stream.`
        }
      : { description: "A packetflix link that Wireshark on this computer opens through Edgeshark's plugin." }
  };
}

export function CaptureSettingsSection(props: {
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
  onPreferredCaptureActionChange: (nextAction: CaptureMethod) => void;
  refreshCaptureStatus: () => Promise<void>;
  setCaptureActionLoading: (action: "install" | "uninstall" | null) => void;
  setCaptureEndpointId: (endpointId: string) => void;
  setCaptureError: (message: string | null) => void;
  setCaptureSessionHostname: (hostname: string) => void;
}) {
  const { api, capabilities } = useWorkspaceHost();
  const { installEdgeShark, uninstallEdgeShark } = api;
  const kubernetes = props.captureEndpoint?.runtime === "c9s";
  const choices = captureMethodChoices(kubernetes, capabilities.localWireshark === true);
  const picked = props.capturePreferences.preferredAction;
  const pickedUnavailable = choices[picked].unavailable;
  const noEndpoint = !props.captureEndpoint;
  const edgesharkDisabled = noEndpoint || kubernetes;
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
  const actionsBusy = edgesharkDisabled || props.captureStatusLoading || props.captureActionLoading !== null;

  return (
    <>
      <SettingsField
        title="Capture defaults"
        description="Where a capture opens on the selected lab host. When the lab host lacks your pick, captures open the automatic way and say why."
        wide
      >
        <TextField
          select
          label="Lab host"
          value={props.captureEndpointId}
          onChange={(event) => props.setCaptureEndpointId(event.target.value)}
          fullWidth
          disabled={props.endpoints.length === 0}
          helperText="The default method and Edgeshark below apply to this lab host only."
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
        <RadioGroup
          value={picked}
          onChange={(_event, value) => props.onPreferredCaptureActionChange(value as CaptureMethod)}
          aria-label="Default capture method"
          sx={{ gap: 0.5 }}
        >
          {CAPTURE_METHODS.map((method) => {
            const choice = choices[method];
            return (
              <FormControlLabel
                key={method}
                value={method}
                disabled={noEndpoint || choice.unavailable !== undefined}
                data-testid={`standalone-settings-capture-default-${method}`}
                sx={{ alignItems: "flex-start", mx: 0, gap: 0.5 }}
                control={<Radio size="small" sx={{ p: 0.5 }} />}
                label={
                  <Box sx={{ pt: 0.375 }}>
                    <Typography variant="body2">{CAPTURE_METHOD_LABELS[method]}</Typography>
                    <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
                      {choice.unavailable ?? choice.description}
                    </Typography>
                  </Box>
                }
              />
            );
          })}
        </RadioGroup>
        {pickedUnavailable ? (
          <Alert severity="info" data-testid="standalone-settings-capture-default-fallback">
            {CAPTURE_METHOD_LABELS[picked]} is not available on this lab host, so its captures open the automatic
            way. Pick another method to change that.
          </Alert>
        ) : null}
      </SettingsField>
      <SettingsField
        title="Edgeshark"
        description={
          kubernetes
            ? `${NOT_ON_KUBERNETES}. Captures of a Kubernetes lab host come from clabernetes as one stream.`
            : "Install or uninstall Edgeshark on the selected lab host, and set the host its packetflix links name."
        }
        wide
      >
        {props.captureError && !kubernetes ? <Alert severity="error">{props.captureError}</Alert> : null}
        <RuntimeLimited limit={kubernetes ? KUBERNETES_LIMITS.edgeshark : undefined} note={false}>
          <Stack spacing={1.5}>
            <TextField
              label="Status"
              value={
                kubernetes
                  ? "Not available on Kubernetes (c9s)"
                  : formatCaptureStatus(
                      Boolean(props.captureEndpoint),
                      props.captureStatusLoading,
                      props.captureStatus,
                      props.captureEndpointLabel
                    )
              }
              fullWidth
              disabled={kubernetes}
              slotProps={{ input: { readOnly: true } }}
              data-testid="standalone-settings-capture-status"
            />
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={() => {
                  void props.refreshCaptureStatus();
                }}
                disabled={actionsBusy}
                data-testid="standalone-settings-capture-refresh"
              >
                Refresh
              </Button>
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={() => runCaptureAction("install")}
                disabled={actionsBusy}
                data-testid="standalone-settings-capture-install"
              >
                Install
              </Button>
              <Button
                variant="outlined"
                color="warning"
                startIcon={<UploadIcon />}
                onClick={() => runCaptureAction("uninstall")}
                disabled={actionsBusy}
                data-testid="standalone-settings-capture-uninstall"
              >
                Uninstall
              </Button>
            </Stack>
            <TextField
              label="Session hostname override"
              value={props.captureSessionHostname}
              onChange={(event) => props.setCaptureSessionHostname(event.target.value)}
              fullWidth
              disabled={edgesharkDisabled}
              placeholder="IPv4, IPv6, or DNS hostname"
              helperText={
                kubernetes
                  ? "Only Edgeshark's packetflix links use it."
                  : "The host packetflix links of this lab host name, in this browser session only."
              }
              data-testid="standalone-settings-capture-session-hostname"
            />
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              <Button
                variant="outlined"
                onClick={props.applyCaptureSessionHostname}
                disabled={edgesharkDisabled}
                data-testid="standalone-settings-capture-session-hostname-apply"
              >
                Apply session hostname
              </Button>
              <Button
                variant="outlined"
                onClick={props.clearCaptureSessionHostname}
                disabled={edgesharkDisabled}
                data-testid="standalone-settings-capture-session-hostname-clear"
              >
                Clear override
              </Button>
            </Stack>
          </Stack>
        </RuntimeLimited>
        {kubernetes ? null : (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            The lab host&apos;s environment sets the Wireshark VNC image and pull policy, and the packetflix host and
            port of its links.
          </Typography>
        )}
      </SettingsField>
    </>
  );
}
