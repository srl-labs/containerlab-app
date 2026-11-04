// The Kubernetes resources a c9s deploy creates, to read, copy or save.
import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import Typography from "@mui/material/Typography";

import { controlRadius } from "../../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../../theme/typography";
import { copyToClipboard } from "../../../utils/clipboard";
import { DialogTitleWithClose } from "../../ui/dialog/DialogChrome";

export interface ManifestExportDialogProps {
  open: boolean;
  labName: string;
  /** `containerlab deploy --emit-crs`, started by whoever opened the dialog. */
  request: Promise<{ yaml: string }>;
  onClose: () => void;
}

type ExportState = { status: "loading" } | { status: "ready"; yaml: string } | { status: "error"; message: string };

function downloadYaml(fileName: string, yaml: string): void {
  const url = URL.createObjectURL(new Blob([yaml], { type: "application/yaml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const ManifestExportDialog: React.FC<ManifestExportDialogProps> = ({ open, labName, request, onClose }) => {
  const [state, setState] = React.useState<ExportState>({ status: "loading" });
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    request.then(
      ({ yaml }) => {
        if (!cancelled) setState({ status: "ready", yaml });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [request]);

  const yaml = state.status === "ready" ? state.yaml : "";
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth data-testid="manifest-export-dialog">
      <DialogTitleWithClose
        title="Kubernetes manifests"
        onClose={onClose}
        closeButtonTestId="manifest-export-close"
      />
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          The resources <code>containerlab deploy -r c9s</code> creates for {labName || "this lab"}.
        </Typography>
        {state.status === "loading" && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 3, justifyContent: "center" }}>
            <CircularProgress size={18} />
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Rendering the manifests…
            </Typography>
          </Box>
        )}
        {state.status === "error" && (
          <Alert severity="error" variant="outlined" data-testid="manifest-export-error">
            Could not export the manifests: {state.message}
          </Alert>
        )}
        {state.status === "ready" && (
          <Box
            component="pre"
            data-testid="manifest-export-yaml"
            sx={{
              m: 0,
              p: 1.5,
              maxHeight: "60vh",
              overflow: "auto",
              border: 1,
              borderColor: "divider",
              borderRadius: controlRadius,
              fontFamily: MONO_FONT_FAMILY,
              fontSize: 12,
              whiteSpace: "pre"
            }}
          >
            {yaml}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          variant="text"
          size="small"
          disabled={state.status !== "ready"}
          onClick={() => {
            void copyToClipboard(yaml).then(setCopied);
          }}
          data-testid="manifest-export-copy"
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          size="small"
          disabled={state.status !== "ready"}
          onClick={() => downloadYaml(`${labName || "lab"}.k8s.yaml`, yaml)}
          data-testid="manifest-export-download"
        >
          Download
        </Button>
      </DialogActions>
    </Dialog>
  );
};
