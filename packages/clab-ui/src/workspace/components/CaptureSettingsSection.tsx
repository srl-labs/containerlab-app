// Capture on a lab host's settings page in the web and desktop apps: which
// capture methods the host lacks, and Edgeshark on Docker and Podman hosts.
import React from "react";
import { Alert, Button, Stack, TextField } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import RefreshIcon from "@mui/icons-material/Refresh";
import UploadIcon from "@mui/icons-material/Upload";

import type { CaptureMethod } from "../../host/captureMethod";
import { NOT_ON_KUBERNETES } from "../../host/labHostSupport";
import { useWorkspaceHost } from "../WorkspaceHost";
import type { EdgeSharkStatusResponse } from "../types";

function formatCaptureStatus(loading: boolean, status: EdgeSharkStatusResponse | null): string {
  if (loading) return "Loading…";
  if (!status) return "Unknown";
  if (!status.running) return "Not running";
  return `Running${status.version ? ` (${status.version})` : ""}`;
}

/** The capture methods a lab host lacks in this app, with why; they show disabled. */
export function unavailableCaptureMethods(
  kubernetes: boolean,
  localWireshark: boolean
): Partial<Record<CaptureMethod, string>> {
  if (!kubernetes) return {};
  return {
    edgeshark: `${NOT_ON_KUBERNETES}: clabernetes captures lab links as one stream.`,
    ...(localWireshark
      ? {}
      : {
          "local-wireshark":
            "The web app cannot start Wireshark on your computer for a Kubernetes lab host; use the desktop app or VS Code."
        })
  };
}

/** Edgeshark's status on the lab host, with Refresh, Install and Uninstall. */
export function EdgesharkControls(props: {
  endpointId: string;
  status: EdgeSharkStatusResponse | null;
  loading: boolean;
  error: string | null;
  action: "install" | "uninstall" | null;
  setAction: (action: "install" | "uninstall" | null) => void;
  setError: (message: string | null) => void;
  refresh: () => Promise<void>;
}) {
  const { installEdgeShark, uninstallEdgeShark } = useWorkspaceHost().api;
  const run = (action: "install" | "uninstall") => {
    props.setAction(action);
    props.setError(null);
    const operation = action === "install" ? installEdgeShark : uninstallEdgeShark;
    void operation(props.endpointId)
      .then(() => props.refresh())
      .catch((error: unknown) => props.setError(error instanceof Error ? error.message : String(error)))
      .finally(() => props.setAction(null));
  };
  const busy = props.loading || props.action !== null;
  return (
    <Stack spacing={1.25} sx={{ width: "100%" }}>
      {props.error ? <Alert severity="error">{props.error}</Alert> : null}
      <TextField
        size="small"
        label="Status"
        value={formatCaptureStatus(props.loading, props.status)}
        fullWidth
        slotProps={{ input: { readOnly: true } }}
        data-testid="standalone-settings-capture-status"
      />
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<RefreshIcon />}
          onClick={() => void props.refresh()}
          disabled={busy}
          data-testid="standalone-settings-capture-refresh"
        >
          Refresh
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<DownloadIcon />}
          onClick={() => run("install")}
          disabled={busy}
          data-testid="standalone-settings-capture-install"
        >
          {props.action === "install" ? "Installing…" : "Install"}
        </Button>
        <Button
          variant="outlined"
          size="small"
          color="warning"
          startIcon={<UploadIcon />}
          onClick={() => run("uninstall")}
          disabled={busy}
          data-testid="standalone-settings-capture-uninstall"
        >
          {props.action === "uninstall" ? "Uninstalling…" : "Uninstall"}
        </Button>
      </Stack>
    </Stack>
  );
}
