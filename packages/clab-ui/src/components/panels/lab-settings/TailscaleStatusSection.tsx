// Tailscale devices of the running lab, read from the lab host.
import React, { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";

import { SettingsField } from "../../../settings/SettingsField";
import { useClabUiHost } from "../../../host/runtimeContext";
import type { TailscaleDevice, TailscaleStatus } from "../../../host/tailscaleStatus";
import { useDeploymentState } from "../../../stores/topoViewerStore";
import { MONO_FONT_FAMILY } from "../../../theme/typography";

type StatusState =
  | { status: "loading" }
  | { status: "ready"; result: TailscaleStatus }
  | { status: "unsupported" }
  | { status: "error"; message: string };

function describeRole(device: TailscaleDevice): string {
  if (device.role === "proxy") return "Lab proxy";
  if (device.role === "sidecar") return `Sidecar of ${device.nodeName ?? "a node"}`;
  if (device.role === "node") return `Node ${device.nodeName ?? ""}`.trim();
  return device.role;
}

function describeState(device: TailscaleDevice): { label: string; ok: boolean } {
  if (device.error !== undefined) return { label: "Unknown", ok: false };
  if (device.state !== "running") return { label: device.state || "Not running", ok: false };
  if (device.backendState === "Running") {
    return { label: device.online ? "Connected" : "Offline", ok: device.online };
  }
  if (device.backendState === "NeedsLogin") return { label: "Needs login", ok: false };
  return { label: device.backendState ?? "Starting", ok: false };
}

const DeviceRow: React.FC<{ device: TailscaleDevice; index: number }> = ({ device, index }) => {
  const state = describeState(device);
  const address = [device.dnsName, ...(device.tailscaleIps ?? [])].filter(Boolean).join(" · ");
  return (
    <Box
      data-testid="lab-settings-tailscale-device"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        px: 1.5,
        py: 1,
        borderTop: index > 0 ? 1 : 0,
        borderColor: "divider"
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            flexShrink: 0,
            bgcolor: state.ok ? "success.main" : "warning.main"
          }}
        />
        <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 0 }} noWrap>
          {device.hostName ?? device.containerName}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", flexShrink: 0 }}>
          {describeRole(device)}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ flexShrink: 0 }}>
          {state.label}
        </Typography>
        {device.authUrl !== undefined ? (
          <Button
            size="small"
            variant="outlined"
            href={device.authUrl}
            target="_blank"
            rel="noopener noreferrer"
            endIcon={<OpenInNewIcon />}
          >
            Log in
          </Button>
        ) : null}
      </Box>
      {address !== "" ? (
        <Typography
          variant="caption"
          sx={{ color: "text.secondary", fontFamily: MONO_FONT_FAMILY }}
          noWrap
        >
          {address}
        </Typography>
      ) : null}
      {(device.forwards ?? []).map((forward) => (
        <Typography
          key={forward.listenPort}
          variant="caption"
          sx={{ color: "text.secondary", fontFamily: MONO_FONT_FAMILY }}
        >
          :{forward.listenPort} → {forward.nodeName ?? forward.target}
          {forward.nodeName !== undefined ? ` (${forward.target})` : ""}
        </Typography>
      ))}
      {device.error !== undefined ? (
        <Typography variant="caption" sx={{ color: "error.main" }}>
          {device.error}
        </Typography>
      ) : null}
    </Box>
  );
};

const StatusBody: React.FC<{ state: StatusState }> = ({ state }) => {
  if (state.status === "loading") {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        Reading the Tailscale status…
      </Typography>
    );
  }
  if (state.status === "error") {
    return (
      <Typography variant="body2" sx={{ color: "error.main" }}>
        {state.message}
      </Typography>
    );
  }
  if (state.status !== "ready") return null;
  const { devices } = state.result;
  if (devices.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        No Tailscale devices run for this lab. Redeploy it after changing the Tailscale
        settings.
      </Typography>
    );
  }
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
      {devices.map((device, index) => (
        <DeviceRow key={device.containerName} device={device} index={index} />
      ))}
    </Box>
  );
};

/** Shown in the Management tab while a lab that joins Tailscale is deployed. */
export const TailscaleStatusSection: React.FC = () => {
  const { topoViewer } = useClabUiHost();
  const deployed = useDeploymentState() === "deployed";
  const [state, setState] = useState<StatusState>({ status: "loading" });

  const refresh = useCallback(() => {
    if (!topoViewer.tailscaleStatus) return;
    setState({ status: "loading" });
    topoViewer.tailscaleStatus().then(
      (result) => setState(result ? { status: "ready", result } : { status: "unsupported" }),
      (error: unknown) =>
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        })
    );
  }, [topoViewer]);

  useEffect(() => {
    if (deployed) refresh();
  }, [deployed, refresh]);

  if (!deployed || !topoViewer.tailscaleStatus || state.status === "unsupported") return null;

  return (
    <SettingsField
      title="Tailscale status"
      description="Devices this lab runs in the tailnet. Open the login link to authenticate the lab proxy."
      wide
      actions={
        <Tooltip title="Refresh">
          <span>
            <IconButton
              size="small"
              aria-label="Refresh Tailscale status"
              onClick={refresh}
              disabled={state.status === "loading"}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      }
    >
      <Box data-testid="lab-settings-tailscale-status">
        <StatusBody state={state} />
      </Box>
    </SettingsField>
  );
};
